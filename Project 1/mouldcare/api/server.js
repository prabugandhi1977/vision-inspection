import http from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { db, ROOT, DATA_DIR, id, now, one, all, run, transaction } from './db.js';
import { authenticate, hashPassword, verifyPassword, tokenFor, canCompany, canManageCompany, canTicket, isCustomer, isInternal, isPlatform, isProvider } from './security.js';
import { HttpError, bad, deny, missing, required, choice, integer, date, array, currency, timezone, email, stringArray } from './validate.js';
import { ingestReading, latestReading } from './iot.js';

const json=(res,status,value)=>{ res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}); res.end(JSON.stringify(value)); };
const audit=(u,action,type,entityId,companyId,detail={})=>run('INSERT INTO audit_events VALUES (?,?,?,?,?,?,?,?)',id(),u.id,companyId,action,type,entityId,JSON.stringify(detail),now());
const byId=(table,key)=>one(`SELECT * FROM ${table} WHERE id=?`,key);
const getTicket=(u,key)=>{ const t=byId('tickets',key); if (!t) missing(); if (!canTicket(u,t)) deny(); return t; };
const getEquipment=(u,key)=>{ const e=byId('equipment',key); if (!e) missing(); if (!canCompany(u,e.company_id)) deny(); return e; };
const scope=(u,table)=>{
  if (isPlatform(u)||u.role==='dispatcher') return all(`SELECT * FROM ${table} ORDER BY created_at DESC`);
  if (isCustomer(u)) return all(`SELECT * FROM ${table} WHERE company_id=? ORDER BY created_at DESC`,u.company_id);
  return [];
};
const route=(method,path,re)=>method===re[0] && path.match(re[1]);
function visibleTickets(u) {
  if (isPlatform(u)||u.role==='dispatcher') return all('SELECT * FROM tickets ORDER BY created_at DESC');
  if (isCustomer(u)) return all('SELECT * FROM tickets WHERE company_id=? ORDER BY created_at DESC',u.company_id);
  if (u.role==='engineer') return all('SELECT * FROM tickets WHERE assigned_user_id=? ORDER BY created_at DESC',u.id);
  if (isProvider(u)) return all('SELECT * FROM tickets WHERE assigned_provider_id=? ORDER BY created_at DESC',u.provider_id);
  return [];
}
function assignmentCandidate(t,kind,key) {
  const plant=byId('plants',t.plant_id), asset=byId('equipment',t.equipment_id);
  if (kind==='engineer') {
    const person=byId('users',key);
    if (!person || person.role!=='engineer' || !person.active || !JSON.parse(person.service_areas).includes(plant.service_area) || !JSON.parse(person.skills).includes(asset.machine_type)) bad('Engineer is unavailable for this area and machine type');
    return {assigned_user_id:key,assigned_provider_id:null,label:person.name};
  }
  if (kind==='provider') {
    const p=byId('providers',key);
    if (!p || !p.approved || !JSON.parse(p.service_areas).includes(plant.service_area) || !JSON.parse(p.skills).includes(asset.machine_type)) bad('Provider is not approved for this area and machine type');
    return {assigned_user_id:null,assigned_provider_id:key,label:p.name};
  }
  bad('assigneeType must be engineer or provider');
}
function ticketDetail(u,key) {
  const ticket=getTicket(u,key);
  const asset=one('SELECT id,machine_type,make,model,serial_number,location,qr_code FROM equipment WHERE id=?',ticket.equipment_id);
  const plant=one('SELECT id,name,country,service_area,timezone FROM plants WHERE id=?',ticket.plant_id);
  return {...ticket,asset,plant,events:all('SELECT e.*,u.name actor_name FROM ticket_events e JOIN users u ON u.id=e.actor_id WHERE e.ticket_id=? ORDER BY e.created_at',key),checklist:all('SELECT * FROM checklist_entries WHERE ticket_id=?',key),workLogs:all('SELECT * FROM work_logs WHERE ticket_id=? ORDER BY created_at',key),parts:all('SELECT * FROM parts_requests WHERE ticket_id=?',key),signoff:one('SELECT * FROM signoffs WHERE ticket_id=?',key)||null,attachments:all("SELECT id,entity_type,entity_id,kind,filename,mime,size_bytes,created_at FROM attachments WHERE company_id=? AND ((entity_type='ticket' AND entity_id=?) OR (entity_type='work_log' AND entity_id IN (SELECT id FROM work_logs WHERE ticket_id=?)))",ticket.company_id,key,key)};
}
function canService(u,t) { return isPlatform(u)||u.role==='dispatcher'||(u.role==='engineer'&&t.assigned_user_id===u.id)||(isProvider(u)&&t.assigned_provider_id===u.provider_id); }
function serviceAction(u,t,body) {
  if (!canService(u,t)) deny();
  const status=choice(body.status,'status',['accepted','in_progress','escalated','completed']);
  if (!({assigned:['accepted','escalated'],accepted:['in_progress','escalated'],in_progress:['escalated','completed'],escalated:['in_progress','completed']}[t.status]||[]).includes(status)) bad(`Cannot move ${t.status} to ${status}`);
  if (status==='completed' && !one('SELECT 1 FROM work_logs WHERE ticket_id=?',t.id)) bad('A work log is required before completion');
  const stamp=now();
  run('UPDATE tickets SET status=?,first_response_at=COALESCE(first_response_at,?),completed_at=CASE WHEN ?=\'completed\' THEN ? ELSE completed_at END,downtime_minutes=? WHERE id=?',status,status==='accepted'?stamp:null,status,stamp,body.downtimeMinutes==null?t.downtime_minutes:integer(body.downtimeMinutes,'downtimeMinutes'),t.id);
  run('INSERT INTO ticket_events VALUES (?,?,?,?,?,?)',id(),t.id,u.id,status,typeof body.note==='string'?body.note.slice(0,2000):'',stamp);
  audit(u,'ticket.status','ticket',t.id,t.company_id,{status});
  return ticketDetail(u,t.id);
}
function createAttachment(u,body) {
  const type=choice(body.entityType,'entityType',['equipment','ticket','work_log']); let companyId;
  if (type==='equipment') companyId=getEquipment(u,body.entityId).company_id;
  else if (type==='ticket') companyId=getTicket(u,body.entityId).company_id;
  else { const log=byId('work_logs',body.entityId); if (!log) missing(); const t=getTicket(u,log.ticket_id); companyId=t.company_id; }
  const kind=choice(body.kind,'kind',['manual','photo','evidence']);
  if (type==='equipment' && !canManageCompany(u,companyId) && !isInternal(u)) deny();
  if (type!=='equipment' && kind==='manual') bad('Manuals attach to equipment');
  const filename=required(body.filename,'filename',160), mime=choice(body.mime,'mime',['application/pdf','image/png','image/jpeg','image/webp']);
  if (typeof body.base64!=='string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.base64)) bad('base64 content required');
  const bytes=Buffer.from(body.base64,'base64'); if (!bytes.length || bytes.length>5*1024*1024) bad('File must be 1 byte to 5 MB');
  const signatures={'application/pdf':'25504446','image/png':'89504e47','image/jpeg':'ffd8ff','image/webp':'52494646'};
  if (!bytes.subarray(0,4).toString('hex').startsWith(signatures[mime])) bad('File signature does not match MIME type');
  const fileId=id(), storage=randomBytes(20).toString('hex'); mkdirSync(join(DATA_DIR,'uploads'),{recursive:true}); writeFileSync(join(DATA_DIR,'uploads',storage),bytes,{flag:'wx'});
  run('INSERT INTO attachments VALUES (?,?,?,?,?,?,?,?,?,?,?)',fileId,companyId,type,body.entityId,kind,filename,mime,bytes.length,storage,u.id,now());
  audit(u,'attachment.create',type,body.entityId,companyId,{attachmentId:fileId});
  return {id:fileId,filename,mime,sizeBytes:bytes.length};
}
async function bodyOf(req) { let chunks=[],size=0; for await (const chunk of req) { size+=chunk.length; if (size>8*1024*1024) throw new HttpError(413,'Request too large'); chunks.push(chunk); } if (!size) return {}; try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { bad('Invalid JSON'); } }
async function api(req,res,path) {
  const method=req.method, body=['POST','PATCH','PUT'].includes(method)?await bodyOf(req):{};
  if (method==='GET' && path==='/api/health') return json(res,200,{ok:true,time:now()});
  if (method==='POST' && path==='/api/auth/login') { const address=email(body.email), password=required(body.password,'password',200); const u=one('SELECT * FROM users WHERE email=? AND active=1',address); if (!u || !verifyPassword(password,u.password_hash)) throw new HttpError(401,'Invalid credentials'); return json(res,200,{token:tokenFor(u),user:{id:u.id,name:u.name,email:u.email,role:u.role,companyId:u.company_id,providerId:u.provider_id}}); }
  if (method==='POST' && path==='/api/integrations/mock/readings') { const expected=process.env.MOULDCARE_INTEGRATION_KEY,actual=req.headers['x-integration-key']; if (!expected || typeof actual!=='string' || Buffer.byteLength(expected)!==Buffer.byteLength(actual) || !timingSafeEqual(Buffer.from(expected),Buffer.from(actual))) throw new HttpError(401,'Integration key required'); return json(res,201,ingestReading(body)); }
  const u=authenticate(req); if (!u) throw new HttpError(401,'Authentication required');
  const clientActionId=req.headers['x-client-action-id'];
  const isOfflineMutation=method==='POST' && (/^\/api\/tickets\/[^/]+\/(status|checklist|work-logs)$/.test(path)||path==='/api/attachments');
  const requestHash=isOfflineMutation?createHash('sha256').update(JSON.stringify(body)).digest('hex'):null;
  if (isOfflineMutation && clientActionId) {
    if (typeof clientActionId!=='string'||!/^[a-f0-9-]{36}$/.test(clientActionId)) bad('Invalid client action ID');
    const previous=one('SELECT result_json FROM offline_actions WHERE user_id=? AND client_action_id=?',u.id,clientActionId);
    if (previous) { const saved=JSON.parse(previous.result_json); if (saved.path!==path||saved.hash!==requestHash) throw new HttpError(409,'Client action ID already used for another request'); return json(res,200,saved.result); }
  }
  const offlineReply=(makeResult,status=201)=>{const result=transaction(()=>{const value=makeResult();if(isOfflineMutation&&clientActionId)run('INSERT INTO offline_actions VALUES (?,?,?,?)',u.id,clientActionId,JSON.stringify({path,hash:requestHash,result:value}),now());return value;});return json(res,status,result);};
  if (method==='GET' && path==='/api/me') return json(res,200,{id:u.id,name:u.name,email:u.email,role:u.role,companyId:u.company_id,providerId:u.provider_id});
  if (method==='GET' && path==='/api/dashboard') {
    const tickets=visibleTickets(u), ids=new Set(tickets.map(t=>t.id)), open=tickets.filter(t=>t.status!=='completed');
    const response=tickets.filter(t=>t.first_response_at).map(t=>(Date.parse(t.first_response_at)-Date.parse(t.created_at))/60000);
    const repeat={}; for (const t of tickets) repeat[t.equipment_id]=(repeat[t.equipment_id]||0)+1;
    const companyIds=isCustomer(u)?[u.company_id]:isProvider(u)?[]:all('SELECT id FROM companies').map(c=>c.id);
    const visits=companyIds.flatMap(c=>all("SELECT v.*,e.make,e.model FROM visits v JOIN equipment e ON e.id=v.equipment_id WHERE v.company_id=? AND v.status='scheduled' AND v.due_at>=? ORDER BY v.due_at LIMIT 10",c,now()));
    return json(res,200,{openTickets:open.length,byPriority:Object.fromEntries(['low','medium','high','critical'].map(p=>[p,open.filter(t=>t.priority===p).length])),averageResponseMinutes:response.length?Math.round(response.reduce((a,b)=>a+b,0)/response.length):null,downtimeMinutes:tickets.reduce((n,t)=>n+t.downtime_minutes,0),repeatFaultAssets:Object.entries(repeat).filter(([,n])=>n>1).length,upcomingMaintenance:visits,tickets:open.slice(0,8)});
  }
  if (method==='GET' && path==='/api/companies') return json(res,200,isPlatform(u)||u.role==='dispatcher'?all('SELECT * FROM companies'):isCustomer(u)?[byId('companies',u.company_id)]:[]);
  if (method==='POST' && path==='/api/companies') { if (!isPlatform(u)) deny(); const key=id(); run('INSERT INTO companies VALUES (?,?,?,?,?,?,?)',key,required(body.name,'name',160),timezone(body.timezone),currency(body.currency),choice(body.units,'units',['metric','imperial']),required(body.locale,'locale',12),now()); audit(u,'company.create','company',key,key); return json(res,201,byId('companies',key)); }
  if (method==='GET' && path==='/api/providers') return json(res,200,isInternal(u)?all('SELECT id,name,approved,service_areas,skills FROM providers'):isProvider(u)?[one('SELECT id,name,approved,service_areas,skills FROM providers WHERE id=?',u.provider_id)]:[]);
  if (method==='POST' && path==='/api/providers') { if (!isPlatform(u)) deny(); const key=id(); run('INSERT INTO providers VALUES (?,?,?,?,?,?)',key,required(body.name,'name',160),0,JSON.stringify(stringArray(body.serviceAreas,'serviceAreas')),JSON.stringify(stringArray(body.skills,'skills',['injection','blow','extrusion','mould','auxiliary'])),now()); audit(u,'provider.create','provider',key,null); return json(res,201,byId('providers',key)); }
  let m;
  if ((m=route(method,path,['PATCH',/^\/api\/providers\/([^/]+)\/approval$/]))) { if (!isPlatform(u)) deny(); const p=byId('providers',m[1]); if (!p) missing(); run('UPDATE providers SET approved=? WHERE id=?',body.approved===true?1:0,p.id); audit(u,'provider.approval','provider',p.id,null,{approved:body.approved===true}); return json(res,200,byId('providers',p.id)); }
  if (method==='GET' && path==='/api/users') return json(res,200,isPlatform(u)?all('SELECT id,company_id,provider_id,name,email,role,active FROM users'):isCustomer(u)?all('SELECT id,company_id,name,email,role,active FROM users WHERE company_id=?',u.company_id):isProvider(u)?all('SELECT id,provider_id,name,email,role,active FROM users WHERE provider_id=?',u.provider_id):[]);
  if (method==='POST' && path==='/api/users') { const companyId=body.companyId||null,providerId=body.providerId||null,role=choice(body.role,'role',['customer_admin','plant_manager','maintenance','dispatcher','engineer','provider_admin','provider_engineer']); if (!(isPlatform(u)||(u.role==='customer_admin'&&companyId===u.company_id&&['plant_manager','maintenance'].includes(role))||(u.role==='provider_admin'&&providerId===u.provider_id&&role==='provider_engineer'))) deny(); if (companyId&&!byId('companies',companyId)) bad('Unknown company'); if (providerId&&!byId('providers',providerId)) bad('Unknown provider'); if (role.startsWith('provider_')?!providerId:role==='dispatcher'||role==='engineer'?!!companyId:!companyId) bad('Role and organisation do not match'); const key=id(),address=email(body.email),password=required(body.password,'password',200); if (password.length<12) bad('Password must have at least 12 characters'); const areas=stringArray(body.serviceAreas||[],'serviceAreas'),skills=stringArray(body.skills||[],'skills',['injection','blow','extrusion','mould','auxiliary']); run('INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?,?,?)',key,companyId,providerId,required(body.name,'name',160),address,hashPassword(password),role,1,JSON.stringify(areas),JSON.stringify(skills),now()); audit(u,'user.create','user',key,companyId); return json(res,201,{id:key,email:address,role}); }
  if (method==='GET' && path==='/api/plants') return json(res,200,scope(u,'plants'));
  if (method==='POST' && path==='/api/plants') { const companyId=required(body.companyId,'companyId'); if (!canManageCompany(u,companyId)) deny(); if (!byId('companies',companyId)) bad('Unknown company'); const key=id(); run('INSERT INTO plants VALUES (?,?,?,?,?,?,?,?)',key,companyId,required(body.name,'name',160),String(body.address||''),required(body.country,'country',2),required(body.serviceArea,'serviceArea',80),timezone(body.timezone),now()); audit(u,'plant.create','plant',key,companyId); return json(res,201,byId('plants',key)); }
  if (method==='GET' && path==='/api/equipment') return json(res,200,scope(u,'equipment'));
  if (method==='GET' && path==='/api/equipment/lookup') { const qr=new URL(req.url,'http://localhost').searchParams.get('qr'); if (!qr) bad('qr is required'); const e=one('SELECT * FROM equipment WHERE qr_code=?',qr); if (!e) missing(); const assigned=visibleTickets(u).filter(t=>t.equipment_id===e.id); if (!canCompany(u,e.company_id)&&!assigned.length) deny(); return json(res,200,{id:e.id,qrCode:e.qr_code,machineType:e.machine_type,make:e.make,model:e.model,serialNumber:e.serial_number,location:e.location,ticketIds:assigned.map(t=>t.id)}); }
  if (method==='POST' && path==='/api/equipment') { const plant=byId('plants',body.plantId); if (!plant) bad('Unknown plant'); if (!canManageCompany(u,plant.company_id)) deny(); const key=id(); run('INSERT INTO equipment VALUES (?,?,?,?,?,?,?,?,?,?)',key,plant.company_id,plant.id,choice(body.machineType,'machineType',['injection','blow','extrusion','mould','auxiliary']),required(body.make,'make',100),required(body.model,'model',100),required(body.serialNumber,'serialNumber',100),required(body.location,'location',160),`MC:${randomBytes(6).toString('hex')}`,now()); audit(u,'equipment.create','equipment',key,plant.company_id); return json(res,201,byId('equipment',key)); }
  if ((m=route(method,path,['GET',/^\/api\/equipment\/([^/]+)$/]))) { const e=getEquipment(u,m[1]); return json(res,200,{...e,attachments:all("SELECT id,kind,filename,mime,size_bytes FROM attachments WHERE entity_type='equipment' AND entity_id=?",e.id),telemetry:latestReading(e.id)}); }
  if ((m=route(method,path,['GET',/^\/api\/equipment\/([^/]+)\/readings$/]))) { const e=getEquipment(u,m[1]); return json(res,200,{equipmentId:e.id,...latestReading(e.id)}); }
  if (method==='GET' && path==='/api/contracts') return json(res,200,scope(u,'contracts').map(c=>({...c,equipmentIds:all('SELECT equipment_id FROM contract_equipment WHERE contract_id=?',c.id).map(x=>x.equipment_id),visits:all('SELECT * FROM visits WHERE contract_id=?',c.id)})));
  if (method==='POST' && path==='/api/contracts') { const companyId=required(body.companyId,'companyId'); if (!canManageCompany(u,companyId)&&u.role!=='dispatcher') deny(); const equipmentIds=array(body.equipmentIds,'equipmentIds'); if (!equipmentIds.length) bad('At least one covered asset is required'); for (const key of equipmentIds) { const e=byId('equipment',key); if (!e||e.company_id!==companyId) bad('Covered asset belongs to another company'); } const startsAt=date(body.startsAt,'startsAt'),renewsAt=date(body.renewsAt,'renewsAt'); if (renewsAt<=startsAt) bad('Renewal must be after start'); const visits=array(body.visits||[],'visits'); for (const v of visits) { if (!equipmentIds.includes(v.equipmentId)) bad('Visit asset must be covered'); const dueAt=date(v.dueAt,'dueAt'); if (dueAt<startsAt||dueAt>=renewsAt) bad('Visit must be within the contract period'); } const key=id(); transaction(()=>{ run('INSERT INTO contracts VALUES (?,?,?,?,?,?,?,?,?)',key,companyId,required(body.title,'title',160),startsAt,renewsAt,required(body.commitments,'commitments',2000),required(body.exclusions,'exclusions',2000),'active',now()); for (const e of equipmentIds) run('INSERT INTO contract_equipment VALUES (?,?)',key,e); for (const v of visits) run('INSERT INTO visits VALUES (?,?,?,?,?,?,?)',id(),key,companyId,v.equipmentId,date(v.dueAt,'dueAt'),'scheduled',String(v.notes||'')); }); audit(u,'contract.create','contract',key,companyId); return json(res,201,byId('contracts',key)); }
  if ((m=route(method,path,['PATCH',/^\/api\/visits\/([^/]+)$/]))) { const visit=byId('visits',m[1]); if (!visit) missing(); if (!canManageCompany(u,visit.company_id)&&u.role!=='dispatcher') deny(); const status=choice(body.status,'status',['scheduled','completed','cancelled']); run('UPDATE visits SET status=?,notes=? WHERE id=?',status,String(body.notes??visit.notes).slice(0,1000),visit.id); audit(u,'visit.update','visit',visit.id,visit.company_id,{status}); return json(res,200,byId('visits',visit.id)); }
  if (method==='GET' && path==='/api/tickets') return json(res,200,visibleTickets(u));
  if (method==='POST' && path==='/api/tickets') { const e=getEquipment(u,body.equipmentId); if (!isCustomer(u)&&!isInternal(u)) deny(); const key=id(); run('INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',key,e.company_id,e.plant_id,e.id,required(body.title,'title',160),choice(body.priority,'priority',['low','medium','high','critical']),required(body.symptoms,'symptoms',3000),String(body.errorCodes||'').slice(0,500),required(body.productionImpact,'productionImpact',1000),'open',null,null,u.id,now(),null,null,0); audit(u,'ticket.create','ticket',key,e.company_id); return json(res,201,ticketDetail(u,key)); }
  if ((m=route(method,path,['GET',/^\/api\/tickets\/([^/]+)$/]))) return json(res,200,ticketDetail(u,m[1]));
  if ((m=route(method,path,['POST',/^\/api\/tickets\/([^/]+)\/assign$/]))) { if (!isPlatform(u)&&u.role!=='dispatcher') deny(); const t=getTicket(u,m[1]),target=assignmentCandidate(t,body.assigneeType,body.assigneeId); if (t.status==='completed') bad('Completed ticket cannot be assigned'); run('UPDATE tickets SET assigned_user_id=?,assigned_provider_id=?,status=? WHERE id=?',target.assigned_user_id,target.assigned_provider_id,'assigned',t.id); run('INSERT INTO ticket_events VALUES (?,?,?,?,?,?)',id(),t.id,u.id,'assigned',`Assigned to ${target.label}`,now()); audit(u,'ticket.assign','ticket',t.id,t.company_id,{assigneeType:body.assigneeType,assigneeId:body.assigneeId}); return json(res,200,ticketDetail(u,t.id)); }
  if ((m=route(method,path,['POST',/^\/api\/tickets\/([^/]+)\/status$/]))) return offlineReply(()=>serviceAction(u,getTicket(u,m[1]),body),200);
  if ((m=route(method,path,['POST',/^\/api\/tickets\/([^/]+)\/checklist$/]))) return offlineReply(()=>{ const t=getTicket(u,m[1]); if (!canService(u,t)) deny(); const key=id(); run('INSERT INTO checklist_entries VALUES (?,?,?,?,?,?,?)',key,t.id,required(body.item,'item',300),body.done===true?1:0,String(body.note||'').slice(0,1000),u.id,now()); audit(u,'checklist.add','ticket',t.id,t.company_id,{itemId:key}); return byId('checklist_entries',key); });
  if ((m=route(method,path,['PATCH',/^\/api\/checklist\/([^/]+)$/]))) { const entry=byId('checklist_entries',m[1]); if (!entry) missing(); const t=getTicket(u,entry.ticket_id); if (!canService(u,t)) deny(); run('UPDATE checklist_entries SET done=?,note=?,updated_by=?,updated_at=? WHERE id=?',body.done===true?1:0,String(body.note||'').slice(0,1000),u.id,now(),entry.id); audit(u,'checklist.update','ticket',t.id,t.company_id,{itemId:entry.id}); return json(res,200,byId('checklist_entries',entry.id)); }
  if ((m=route(method,path,['POST',/^\/api\/tickets\/([^/]+)\/work-logs$/]))) return offlineReply(()=>{ const t=getTicket(u,m[1]); if (!canService(u,t)) deny(); const key=id(); run('INSERT INTO work_logs VALUES (?,?,?,?,?,?,?)',key,t.id,u.id,required(body.description,'description',3000),integer(body.minutes,'minutes',1,10080),String(body.partsUsed||'').slice(0,1000),now()); audit(u,'work_log.create','ticket',t.id,t.company_id,{workLogId:key}); return byId('work_logs',key); });
  if ((m=route(method,path,['POST',/^\/api\/tickets\/([^/]+)\/signoff$/]))) { const t=getTicket(u,m[1]); if (!isCustomer(u)||u.company_id!==t.company_id||t.status!=='completed') deny(); run('INSERT INTO signoffs VALUES (?,?,?,?)',t.id,u.id,required(body.signerName,'signerName',160),now()); audit(u,'ticket.signoff','ticket',t.id,t.company_id); return json(res,201,one('SELECT * FROM signoffs WHERE ticket_id=?',t.id)); }
  if (method==='GET' && path==='/api/parts') { const tickets=visibleTickets(u); return json(res,200,tickets.flatMap(t=>all('SELECT * FROM parts_requests WHERE ticket_id=?',t.id))); }
  if ((m=route(method,path,['POST',/^\/api\/tickets\/([^/]+)\/parts$/]))) { const t=getTicket(u,m[1]); if (!canService(u,t)&&!isCustomer(u)) deny(); const key=id(); run('INSERT INTO parts_requests VALUES (?,?,?,?,?,?,?)',key,t.company_id,t.id,required(body.item,'item',300),integer(body.quantity,'quantity',1,100000),'requested',now()); audit(u,'parts.request','parts_request',key,t.company_id); return json(res,201,byId('parts_requests',key)); }
  if ((m=route(method,path,['POST',/^\/api\/parts\/([^/]+)\/quote$/]))) { const p=byId('parts_requests',m[1]); if (!p) missing(); const t=getTicket(u,p.ticket_id); if (!isInternal(u)) deny(); const key=id(); run('INSERT INTO quotations VALUES (?,?,?,?,?,?,?,?,?)',key,p.id,p.company_id,integer(body.amountMinor,'amountMinor',1),currency(body.currency),integer(body.leadDays,'leadDays',0,365),'pending',null,now()); run("UPDATE parts_requests SET status='quoted' WHERE id=?",p.id); audit(u,'quote.create','quotation',key,p.company_id); return json(res,201,byId('quotations',key)); }
  if ((m=route(method,path,['GET',/^\/api\/parts\/([^/]+)\/quotes$/]))) { const p=byId('parts_requests',m[1]); if (!p) missing(); getTicket(u,p.ticket_id); return json(res,200,all('SELECT * FROM quotations WHERE request_id=?',p.id)); }
  if ((m=route(method,path,['POST',/^\/api\/quotes\/([^/]+)\/decision$/]))) { const q=byId('quotations',m[1]); if (!q) missing(); if (!isCustomer(u)||u.company_id!==q.company_id||!['customer_admin','plant_manager'].includes(u.role)) deny(); if (q.status!=='pending') bad('Quotation already decided'); const status=choice(body.decision,'decision',['approved','rejected']); run('UPDATE quotations SET status=?,approved_by=? WHERE id=?',status,u.id,q.id); run('UPDATE parts_requests SET status=? WHERE id=?',status==='approved'?'approved':'rejected',q.request_id); audit(u,'quote.decision','quotation',q.id,q.company_id,{status}); return json(res,200,byId('quotations',q.id)); }
  if ((m=route(method,path,['POST',/^\/api\/parts\/([^/]+)\/fulfil$/]))) { const p=byId('parts_requests',m[1]); if (!p) missing(); getTicket(u,p.ticket_id); if (!isInternal(u)||p.status!=='approved') deny(); run("UPDATE parts_requests SET status='fulfilled' WHERE id=?",p.id); audit(u,'parts.fulfil','parts_request',p.id,p.company_id); return json(res,200,byId('parts_requests',p.id)); }
  if (method==='POST' && path==='/api/attachments') return offlineReply(()=>createAttachment(u,body));
  if ((m=route(method,path,['GET',/^\/api\/attachments\/([^/]+)$/]))) { const a=byId('attachments',m[1]); if (!a) missing(); if (a.entity_type==='equipment') getEquipment(u,a.entity_id); else if (a.entity_type==='ticket') getTicket(u,a.entity_id); else { const log=byId('work_logs',a.entity_id); if (!log) missing(); getTicket(u,log.ticket_id); } const bytes=readFileSync(join(DATA_DIR,'uploads',a.storage_name)); res.writeHead(200,{'content-type':a.mime,'content-disposition':`attachment; filename="${a.filename.replace(/["\\\r\n]/g,'_')}"`,'x-content-type-options':'nosniff','cache-control':'private, no-store'}); return res.end(bytes); }
  if (method==='GET' && path==='/api/audit') { if (!isPlatform(u)&&u.role!=='customer_admin') deny(); return json(res,200,isPlatform(u)?all('SELECT * FROM audit_events ORDER BY created_at DESC LIMIT 100'):all('SELECT * FROM audit_events WHERE company_id=? ORDER BY created_at DESC LIMIT 100',u.company_id)); }
  throw new HttpError(404,'Endpoint not found');
}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
export function createServer() { return http.createServer(async(req,res)=>{ try { const path=new URL(req.url,'http://localhost').pathname; if (path.startsWith('/api/')) return await api(req,res,path); if (req.method!=='GET') throw new HttpError(405,'Method not allowed'); const safe=path==='/'?'index.html':path.endsWith('/')?path.slice(1)+'index.html':path.slice(1); if (!/^[\w./-]+$/.test(safe)||safe.includes('..')) throw new HttpError(404,'Not found'); const file=join(ROOT,'web',safe); if (!existsSync(file)) throw new HttpError(404,'Not found'); res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream','x-content-type-options':'nosniff'}); res.end(readFileSync(file)); } catch(e) { if (e instanceof HttpError) return json(res,e.status,{error:e.message}); if (String(e.message).includes('UNIQUE constraint failed')) return json(res,409,{error:'Record already exists'}); console.error(e); json(res,500,{error:'Internal server error'}); } }); }
if (process.argv[1] && process.argv[1].endsWith('server.js')) { const port=Number(process.env.PORT||3000); createServer().listen(port,()=>console.log(`MouldCare demo: http://localhost:${port}`)); }

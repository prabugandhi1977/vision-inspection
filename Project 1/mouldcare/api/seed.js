import { db, id, now, one, run } from './db.js';
import { hashPassword } from './security.js';

const stamp=now();
function company(key,name,currency,timezone) { run('INSERT INTO companies VALUES (?,?,?,?,?,?,?)',key,name,timezone,currency,'metric','en',stamp); }
function provider(key,name,areas,skills) { run('INSERT INTO providers VALUES (?,?,?,?,?,?)',key,name,1,JSON.stringify(areas),JSON.stringify(skills),stamp); }
function user(key,name,email,role,companyId=null,providerId=null,areas=[],skills=[]) { run('INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?,?,?)',key,companyId,providerId,name,email,hashPassword('DemoPass123!'),role,1,JSON.stringify(areas),JSON.stringify(skills),stamp); }
if (one('SELECT 1 FROM companies LIMIT 1')) { console.log('Seed already present'); process.exit(0); }
db.exec('BEGIN IMMEDIATE');
try {
  company('c-acme','Acme Plastics','USD','America/Chicago'); company('c-nova','Nova Polymers','EUR','Europe/Berlin');
  provider('p-atlas','Atlas Field Service',['US-MW'],['injection','mould','auxiliary']); provider('p-euro','EuroTech Service',['DE-NW'],['blow','extrusion','auxiliary']);
  user('u-admin','Platform Admin','admin@demo.test','platform_admin'); user('u-dispatch','Maya Dispatch','dispatch@demo.test','dispatcher');
  user('u-engineer','Alex Engineer','engineer@demo.test','engineer',null,null,['US-MW'],['injection','mould']);
  user('u-acme','Sam Acme','acme@demo.test','customer_admin','c-acme'); user('u-acme-maint','Lee Maintenance','maint@demo.test','maintenance','c-acme');
  user('u-nova','Nora Nova','nova@demo.test','customer_admin','c-nova');
  user('u-atlas','Ari Atlas','atlas@demo.test','provider_engineer',null,'p-atlas',['US-MW'],['injection','mould']);
  user('u-euro','Emil Euro','euro@demo.test','provider_engineer',null,'p-euro',['DE-NW'],['blow','extrusion']);
  run('INSERT INTO plants VALUES (?,?,?,?,?,?,?,?)','plant-a','c-acme','Chicago Plant','1200 Industrial Way','US','US-MW','America/Chicago',stamp);
  run('INSERT INTO plants VALUES (?,?,?,?,?,?,?,?)','plant-n','c-nova','Cologne Plant','Werkstrasse 8','DE','DE-NW','Europe/Berlin',stamp);
  run('INSERT INTO equipment VALUES (?,?,?,?,?,?,?,?,?,?)','eq-a','c-acme','plant-a','injection','Arburg','Allrounder 570','ARB-570-001','Bay 4','MC:eq-a',stamp);
  run('INSERT INTO equipment VALUES (?,?,?,?,?,?,?,?,?,?)','eq-b','c-acme','plant-a','mould','Husky','Hot Runner 24','HSK-2409','Tool Room','MC:eq-b',stamp);
  run('INSERT INTO equipment VALUES (?,?,?,?,?,?,?,?,?,?)','eq-n','c-nova','plant-n','extrusion','Coperion','ZSK 58','COP-58-811','Line 2','MC:eq-n',stamp);
  run('INSERT INTO contracts VALUES (?,?,?,?,?,?,?,?,?)','contract-a','c-acme','Annual care 2026','2026-01-01T00:00:00.000Z','2027-01-01T00:00:00.000Z','4 preventive visits; 8-hour response','Consumables and tooling', 'active',stamp);
  run('INSERT INTO contract_equipment VALUES (?,?)','contract-a','eq-a');
  run('INSERT INTO visits VALUES (?,?,?,?,?,?,?)','visit-a','contract-a','c-acme','eq-a','2026-11-15T14:00:00.000Z','scheduled','Quarterly inspection');
  run('INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)','ticket-a','c-acme','plant-a','eq-a','Hydraulic pressure drops','high','Pressure falls after warm-up','E-204','Line stopped','assigned','u-engineer',null,'u-acme',stamp,null,null,120);
  run('INSERT INTO tickets VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)','ticket-n','c-nova','plant-n','eq-n','Extruder temperature alarm','critical','Zone 3 overheats','T-302','Reduced output','assigned',null,'p-euro','u-nova',stamp,null,null,45);
  run('INSERT INTO ticket_events VALUES (?,?,?,?,?,?)',id(),'ticket-a','u-dispatch','assigned','Assigned to Alex Engineer',stamp);
  run('INSERT INTO ticket_events VALUES (?,?,?,?,?,?)',id(),'ticket-n','u-dispatch','assigned','Assigned to EuroTech Service',stamp);
  run('INSERT INTO device_mappings VALUES (?,?,?,?,?)','map-a','demo-device-a','c-acme','eq-a',stamp);
  run('INSERT INTO device_mappings VALUES (?,?,?,?,?)','map-n','demo-device-n','c-nova','eq-n',stamp);
  db.exec('COMMIT'); console.log('Seeded two customers, two providers, sample equipment and tickets. Password: DemoPass123!');
} catch(e) { db.exec('ROLLBACK'); throw e; }

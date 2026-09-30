import { id, now, one, run } from './db.js';
import { bad, date, required } from './validate.js';

export const mockSamples = [
  {deviceId:'demo-device-a',observedAt:new Date().toISOString(),runningHours:4120.5,cycleCount:124820,temperatureC:38.2,alarmCode:null},
  {deviceId:'demo-device-n',observedAt:new Date(Date.now()-2*60*60*1000).toISOString(),runningHours:9120,cycleCount:330120,temperatureC:88.1,alarmCode:'T-302'}
];
export function ingestReading(input) {
  const deviceId=required(input.deviceId,'deviceId',100), observedAt=date(input.observedAt,'observedAt');
  if (Date.parse(observedAt)>Date.now()+5*60*1000) bad('observedAt is in the future');
  const mapping=one('SELECT * FROM device_mappings WHERE external_device_id=?',deviceId);
  if (!mapping) bad('Unknown deviceId');
  for (const field of ['runningHours','temperatureC']) if (input[field]!=null && (!Number.isFinite(input[field]) || input[field]<0)) bad(`${field} must be non-negative`);
  if (input.cycleCount!=null && (!Number.isSafeInteger(input.cycleCount) || input.cycleCount<0)) bad('cycleCount must be a non-negative integer');
  if (input.alarmCode!=null && (typeof input.alarmCode!=='string' || input.alarmCode.length>100)) bad('alarmCode is invalid');
  const readingId=id();
  run('INSERT INTO readings VALUES (?,?,?,?,?,?,?,?,?,?,?)',readingId,mapping.company_id,mapping.equipment_id,deviceId,observedAt,now(),input.runningHours??null,input.cycleCount??null,input.temperatureC??null,input.alarmCode??null,JSON.stringify(input));
  return {id:readingId,equipmentId:mapping.equipment_id};
}
export function latestReading(equipmentId) {
  const mapping=one('SELECT * FROM device_mappings WHERE equipment_id=?',equipmentId);
  if (!mapping) return {status:'unmapped',reading:null};
  const reading=one('SELECT observed_at,running_hours,cycle_count,temperature_c,alarm_code FROM readings WHERE equipment_id=? ORDER BY observed_at DESC LIMIT 1',equipmentId);
  if (!reading) return {status:'missing',reading:null};
  return {status:Date.now()-Date.parse(reading.observed_at)>30*60*1000?'stale':'current',reading};
}

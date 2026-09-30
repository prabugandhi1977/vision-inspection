export class HttpError extends Error { constructor(status,message) { super(message); this.status=status; } }
export const bad = m => { throw new HttpError(400,m); };
export const deny = () => { throw new HttpError(403,'Forbidden'); };
export const missing = () => { throw new HttpError(404,'Not found'); };
export function required(v,name,max=500) { if (typeof v!=='string' || !v.trim() || v.length>max) bad(`${name} must be 1-${max} characters`); return v.trim(); }
export function choice(v,name,options) { if (!options.includes(v)) bad(`${name} must be one of: ${options.join(', ')}`); return v; }
export function integer(v,name,min=0,max=10000000) { if (!Number.isInteger(v) || v<min || v>max) bad(`${name} must be an integer from ${min} to ${max}`); return v; }
export function date(v,name) { if (typeof v!=='string' || !/^\d{4}-\d\d-\d\d/.test(v) || !Number.isFinite(Date.parse(v))) bad(`${name} must be an ISO date`); return new Date(v).toISOString(); }
export function array(v,name) { if (!Array.isArray(v)) bad(`${name} must be an array`); return v; }
export function currency(v) { if (typeof v!=='string'||!/^[A-Z]{3}$/.test(v)) bad('currency must be an ISO 4217 code'); try { new Intl.NumberFormat('en',{style:'currency',currency:v}); } catch { bad('Unsupported currency code'); } return v; }
export function timezone(v) { required(v,'timezone',80); try { new Intl.DateTimeFormat('en',{timeZone:v}); } catch { bad('Unknown IANA timezone'); } return v; }
export function email(v) { const value=required(v,'email',200).toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) bad('Invalid email'); return value; }
export function stringArray(v,name,options) { array(v,name); if (v.length>50||v.some(x=>typeof x!=='string'||!x.trim()||x.length>80||(options&&!options.includes(x)))) bad(`${name} contains invalid values`); return [...new Set(v.map(x=>x.trim()))]; }

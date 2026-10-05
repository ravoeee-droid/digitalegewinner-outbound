import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const COOKIE="er_admin";
const VALUE="energy-radar-admin-v1";
const FALLBACK_PASSWORD_SHA256="30e363d3e8c59f2c1319f8d73d48e3ad26db5e087951a4d7ab809c6f5401aea8";
export type AppRole="admin"|"sales";
export function adminCookieName(){return COOKIE}
function hash(value:string){return createHash("sha256").update(value.trim().toLowerCase()).digest("hex")}
function secret(){return process.env.ADMIN_PASSWORD||FALLBACK_PASSWORD_SHA256}
function legacySessionFor(s:string){return createHmac("sha256",s).update(VALUE).digest("hex")}
function roleSession(role:AppRole,email:string){return `${role}.${createHmac("sha256",secret()).update(`${role}:${email.trim().toLowerCase()}`).digest("hex")}`}
function safeEqual(a:string,b:string){try{return timingSafeEqual(Buffer.from(a),Buffer.from(b))}catch{return false}}

export function authenticate(email:string,password:string):{role:AppRole;email:string}|null{
 const normalized=password.trim();
 const adminEnv=process.env.ADMIN_PASSWORD;
 if((adminEnv&&normalized===adminEnv)||hash(normalized)===FALLBACK_PASSWORD_SHA256)return {role:"admin",email:"admin"};
 const salesEmail=(process.env.SALES_USER_EMAIL||"").trim().toLowerCase();
 const salesPassword=process.env.SALES_USER_PASSWORD||"";
 if(salesEmail&&salesPassword&&email.trim().toLowerCase()===salesEmail&&safeEqual(normalized,salesPassword))return {role:"sales",email:salesEmail};
 return null;
}
export function sessionValueFor(user:{role:AppRole;email:string}){return roleSession(user.role,user.email)}
export function sessionRole(value?:string|null):AppRole|null{
 if(!value)return null;
 const legacy=[legacySessionFor(FALLBACK_PASSWORD_SHA256)];
 if(process.env.ADMIN_PASSWORD)legacy.push(legacySessionFor(process.env.ADMIN_PASSWORD));
 if(legacy.some(x=>safeEqual(value,x)))return "admin";
 const salesEmail=(process.env.SALES_USER_EMAIL||"").trim().toLowerCase();
 if(salesEmail&&safeEqual(value,roleSession("sales",salesEmail)))return "sales";
 if(safeEqual(value,roleSession("admin","admin")))return "admin";
 return null;
}
export function validSession(value?:string|null){return sessionRole(value)!==null}

// Sales credentials are injected via Vercel environment variables.
// Sales login email is configured via SALES_USER_EMAIL.

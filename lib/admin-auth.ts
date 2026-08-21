import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const COOKIE="er_admin";
const VALUE="energy-radar-admin-v1";
const FALLBACK_PASSWORD_SHA256="30e363d3e8c59f2c1319f8d73d48e3ad26db5e087951a4d7ab809c6f5401aea8";

export function adminCookieName(){return COOKIE}

function normalize(value:string){
 return value.trim().toLowerCase();
}

function hash(value:string){
 return createHash("sha256").update(normalize(value)).digest("hex");
}

function sessionFor(secret:string){
 return createHmac("sha256",secret).update(VALUE).digest("hex");
}

export function passwordIsValid(password:string){
 const normalized=normalize(password);
 const env=process.env.ADMIN_PASSWORD;
 if(env&&normalized===normalize(env))return true;
 return hash(normalized)===FALLBACK_PASSWORD_SHA256;
}

export function sessionValue(password?:string){
 if(password&&hash(password)===FALLBACK_PASSWORD_SHA256)return sessionFor(FALLBACK_PASSWORD_SHA256);
 const secret=process.env.ADMIN_PASSWORD;
 if(secret)return sessionFor(secret);
 return sessionFor(FALLBACK_PASSWORD_SHA256);
}

export function validSession(value?:string|null){
 if(!value)return false;
 const expected=[sessionFor(FALLBACK_PASSWORD_SHA256)];
 if(process.env.ADMIN_PASSWORD)expected.push(sessionFor(process.env.ADMIN_PASSWORD));
 for(const candidate of expected){
  try{if(timingSafeEqual(Buffer.from(value),Buffer.from(candidate)))return true}catch{}
 }
 return false;
}

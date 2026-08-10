import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE="er_admin";
const VALUE="energy-radar-admin-v1";

export function adminCookieName(){return COOKIE}
export function sessionValue(){
 const secret=process.env.ADMIN_PASSWORD;
 if(!secret)throw new Error("ADMIN_PASSWORD fehlt.");
 return createHmac("sha256",secret).update(VALUE).digest("hex");
}
export function validSession(value?:string|null){
 if(!value||!process.env.ADMIN_PASSWORD)return false;
 const expected=sessionValue();
 try{return timingSafeEqual(Buffer.from(value),Buffer.from(expected))}catch{return false}
}

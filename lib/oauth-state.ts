import { createHmac, timingSafeEqual } from "node:crypto";

type OAuthState={provider:"google"|"microsoft";mailboxId:string;name?:string;ts:number};
function secret(){const s=process.env.ADMIN_PASSWORD;if(!s)throw new Error("ADMIN_PASSWORD fehlt.");return s}
export function encodeOAuthState(input:Omit<OAuthState,"ts">){
 const payload=Buffer.from(JSON.stringify({...input,ts:Date.now()})).toString("base64url");
 const sig=createHmac("sha256",secret()).update(payload).digest("base64url");
 return `${payload}.${sig}`;
}
export function decodeOAuthState(value:string):OAuthState{
 const [payload,sig]=value.split(".");if(!payload||!sig)throw new Error("OAuth State ungültig.");
 const expected=createHmac("sha256",secret()).update(payload).digest("base64url");
 if(!timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))throw new Error("OAuth State Signatur ungültig.");
 const parsed=JSON.parse(Buffer.from(payload,"base64url").toString("utf8")) as OAuthState;
 if(Date.now()-parsed.ts>15*60*1000)throw new Error("OAuth State abgelaufen.");
 return parsed;
}

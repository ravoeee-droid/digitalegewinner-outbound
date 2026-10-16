import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { query } from "@/lib/db";
import { d1Enabled } from "./cloudflare-d1";
import { readD1Secret, writeD1Secret, deleteD1Secret, listD1Secrets } from "./cloudflare-store";

function key(){
 const source=process.env.APP_ENCRYPTION_KEY||process.env.ADMIN_PASSWORD;
 if(!source)throw new Error("APP_ENCRYPTION_KEY oder ADMIN_PASSWORD fehlt.");
 return createHash("sha256").update(source).digest();
}
export function encryptSecretValue(value:string){
 const iv=randomBytes(12);const cipher=createCipheriv("aes-256-gcm",key(),iv);const data=Buffer.concat([cipher.update(value,"utf8"),cipher.final()]);const tag=cipher.getAuthTag();return Buffer.concat([iv,tag,data]).toString("base64url");
}
export function decryptSecretValue(value:string){
 const raw=Buffer.from(value,"base64url");const iv=raw.subarray(0,12);const tag=raw.subarray(12,28);const data=raw.subarray(28);const decipher=createDecipheriv("aes-256-gcm",key(),iv);decipher.setAuthTag(tag);return Buffer.concat([decipher.update(data),decipher.final()]).toString("utf8");
}
export async function setSecret(name:string,value:string){
 const encoded=encryptSecretValue(value);
 if(d1Enabled()){await writeD1Secret(name,encoded);return;}
 await query(`insert into er_secrets(workspace,key,encrypted_value) values('default',$1,$2) on conflict(workspace,key) do update set encrypted_value=excluded.encrypted_value,updated_at=now()`,[name,encoded]);
}
export async function deleteSecret(name:string){if(d1Enabled()){await deleteD1Secret(name);return;}await query("delete from er_secrets where workspace='default' and key=$1",[name])}
export async function getSecret(name:string){
 if(d1Enabled()){const encoded=await readD1Secret(name);return encoded?decryptSecretValue(encoded):"";}
 const rows=await query<{encrypted_value:string}>("select encrypted_value from er_secrets where workspace='default' and key=$1",[name]);
 if(!rows[0])return "";return decryptSecretValue(rows[0].encrypted_value);
}
export async function secretStatus(){
 if(d1Enabled()){return (await listD1Secrets()).map(r=>({key:r.key,configured:true,updatedAt:r.updated_at}));}
 const rows=await query<{key:string;updated_at:string}>("select key,updated_at from er_secrets where workspace='default' order by key");
 return rows.map(r=>({key:r.key,configured:true,updatedAt:r.updated_at}));
}

import { getSecret } from "@/lib/secrets";
import type { MailboxConfig } from "@/lib/mailer";

export type StoredMailboxCredential=MailboxConfig&{id:string};

function parse(raw:string){
 if(!raw)return [] as StoredMailboxCredential[];
 const value=JSON.parse(raw) as unknown;
 if(!Array.isArray(value))throw new Error("Mailbox Credentials JSON ist ungültig.");
 return value.filter((item):item is StoredMailboxCredential=>Boolean(item&&typeof item==="object"&&"id" in item&&"provider" in item&&"email" in item));
}

export async function loadMailboxCredentials(){
 const env=parse(process.env.MAILBOX_CREDENTIALS_JSON||"");
 const storedRaw=await getSecret("mailbox_credentials_json").catch(()=>"");
 const stored=parse(storedRaw||"");
 const merged=new Map<string,StoredMailboxCredential>();
 for(const item of env)merged.set(item.id,item);
 for(const item of stored)merged.set(item.id,{...(merged.get(item.id)||{}),...item} as StoredMailboxCredential);
 return [...merged.values()];
}

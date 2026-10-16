import { getSecret, setSecret, encryptSecretValue, decryptSecretValue } from "@/lib/secrets";
import { d1Enabled } from "./cloudflare-d1";
import { readD1MailboxSnapshot, writeD1MailboxBundle } from "./cloudflare-store";
import { readState, writeState } from "./db";
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
 const storedRaw=await getSecret("mailbox_credentials_json");
 const stored=parse(storedRaw||"");
 const merged=new Map<string,StoredMailboxCredential>();
 for(const item of env)merged.set(item.id,item);
 for(const item of stored)merged.set(item.id,{...(merged.get(item.id)||{}),...item} as StoredMailboxCredential);
 return [...merged.values()];
}

export async function saveVerifiedMailboxes(verified:StoredMailboxCredential[]) {
 if(!verified.length)return;
 for(let attempt=0;attempt<3;attempt++) {
  const snapshot=d1Enabled()?await readD1MailboxSnapshot():null;
  const current=snapshot?parse(snapshot.ciphertext?decryptSecretValue(snapshot.ciphertext):""):await loadMailboxCredentials();
  const state=snapshot?.payload || (await readState())?.payload || {};
  const existing=Array.isArray(state.mailboxes)?state.mailboxes as Array<Record<string,unknown>>:[];
  const credentials=new Map<string,StoredMailboxCredential>();
  for(const item of [...parse(process.env.MAILBOX_CREDENTIALS_JSON||""),...current])credentials.set(item.id,item);
  const nextMailboxes=[...existing];
  for(const item of verified) {
   for(const [id,old] of credentials)if(old.email.toLowerCase()===item.email.toLowerCase()&&id!==item.id)credentials.delete(id);
   credentials.set(item.id,item);
   const previous=nextMailboxes.find(old=>old.id===item.id||String(old.email||"").toLowerCase()===item.email.toLowerCase());
   for(let index=nextMailboxes.length-1;index>=0;index--)if(nextMailboxes[index].id===item.id||String(nextMailboxes[index].email||"").toLowerCase()===item.email.toLowerCase())nextMailboxes.splice(index,1);
   nextMailboxes.push({...previous,id:item.id,email:item.email,enabled:previous?.enabled ?? true,dailyLimit:previous?.dailyLimit ?? 5});
  }
  const payload={...state,mailboxes:nextMailboxes};
  const serialized=JSON.stringify([...credentials.values()]);
  if(snapshot) {
   if(await writeD1MailboxBundle(payload,encryptSecretValue(serialized),snapshot.version,snapshot.ciphertext))return;
  } else {
   await setSecret("mailbox_credentials_json",serialized);
   await writeState(payload);
   return;
  }
 }
 throw new Error("Die Postfachliste wurde gleichzeitig geändert. Bitte erneut speichern.");
}

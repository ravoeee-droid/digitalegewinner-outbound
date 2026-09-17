import { query, readState, writeState } from "@/lib/db";
import { getMailboxAccessToken } from "@/lib/mailer";
import { loadMailboxCredentials, type StoredMailboxCredential } from "@/lib/mailbox-credentials";
import { listImapMessages, type ImapMailboxCredential } from "@/lib/imap-client";

export const runtime="nodejs";export const maxDuration=60;
type State={leads?:Array<Record<string,unknown>>};
type Credential=StoredMailboxCredential;
function auth(request:Request){const s=process.env.CRON_SECRET;return Boolean(s&&(request.headers.get("authorization")||"")===`Bearer ${s}`)}
function fromHeader(value:string){const m=value.match(/<([^>]+)>/);return (m?.[1]||value).trim().toLowerCase()}
async function recordReply(messageId:string,from:string,subject:string,mailboxId:string){
 const existing=await query<{id:number}>("select id from er_events where workspace='default' and type='reply' and meta->>'providerMessageId'=$1 limit 1",[messageId]);if(existing.length)return false;
 const row=await readState();const state=row?.payload as State|undefined;const lead=state?.leads?.find(l=>String(l.email||"").toLowerCase()===from);if(!lead)return false;const leadId=String(lead.id);
 await query("insert into er_events(workspace,lead_id,type,meta) values('default',$1,'reply',$2::jsonb)",[leadId,JSON.stringify({providerMessageId:messageId,from,subject,mailboxId})]);await query("update er_outbox set status='stopped' where workspace='default' and lead_id=$1 and status='queued'",[leadId]);
 // Update the real CRM row directly - the legacy JSON mirror below gets overwritten by
 // sales_leads on every /api/crm/launch load, so writing only there silently loses this.
 await query("update sales_leads set intent_score=least(100,intent_score+30),stage=case when stage in ('Neu','Kontaktiert') then 'Engaged' else stage end,last_contact_at=now(),updated_at=now() where id=$1 and workspace='default'",[leadId]);
 if(state?.leads){const leads=state.leads.map(l=>String(l.id)===leadId?{...l,intentScore:Math.min(100,Number(l.intentScore||0)+30),stage:String(l.stage)==="Neu"||String(l.stage)==="Kontaktiert"?"Engaged":l.stage}:l);await writeState({...state,leads})}
 return true;
}
async function syncGmail(c:Credential){const token=await getMailboxAccessToken(c);const list=await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=50&q=in%3Ainbox%20newer_than%3A2d",{headers:{Authorization:`Bearer ${token}`}});if(!list.ok)throw new Error(`Gmail Inbox Sync ${list.status}`);const data=await list.json() as {messages?:Array<{id:string}>};let replies=0;for(const m of data.messages||[]){const r=await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,{headers:{Authorization:`Bearer ${token}`}});if(!r.ok)continue;const msg=await r.json() as {id:string;payload?:{headers?:Array<{name:string;value:string}>}};const headers=msg.payload?.headers||[];const from=fromHeader(headers.find(h=>h.name.toLowerCase()==="from")?.value||"");if(!from||from===c.email.toLowerCase())continue;const subject=headers.find(h=>h.name.toLowerCase()==="subject")?.value||"";if(await recordReply(msg.id,from,subject,c.id))replies++}return replies}
async function syncMicrosoft(c:Credential){const token=await getMailboxAccessToken(c);const since=new Date(Date.now()-2*86400000).toISOString();const endpoint=`https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=50&$select=id,subject,from,receivedDateTime&$filter=receivedDateTime%20ge%20${encodeURIComponent(since)}`;const r=await fetch(endpoint,{headers:{Authorization:`Bearer ${token}`}});if(!r.ok)throw new Error(`Microsoft Inbox Sync ${r.status}`);const data=await r.json() as {value?:Array<{id:string;subject?:string;from?:{emailAddress?:{address?:string}}}>};let replies=0;for(const m of data.value||[]){const from=(m.from?.emailAddress?.address||"").toLowerCase();if(!from||from===c.email.toLowerCase())continue;if(await recordReply(m.id,from,m.subject||"",c.id))replies++}return replies}
// Deliberately narrow: only unambiguous DSN senders/subjects count as a bounce, so a
// normal reply never gets misfiled as one.
function isBounceMessage(from:string,subject:string){
 if(/^(mailer-daemon|postmaster)@/i.test(from)||from.includes("mailer-daemon"))return true;
 return /(mail delivery (failed|subsystem)|undelivered mail|delivery status notification|undeliverable|returned mail|delivery (has )?fail|nicht zustellbar|unzustellbar)/i.test(subject);
}
// DSN bodies name the address that failed inline ("Final-Recipient: ...", "couldn't be
// delivered to ...") - pick the address right after such a marker, falling back to the
// most-repeated non-self address in the body if no marker matches.
function extractBouncedEmail(bodyText:string,ownEmail:string){
 const own=ownEmail.toLowerCase();
 const marker=/(?:final-recipient|failed recipient|the following address(?:es)? (?:failed|has failed)|rcpt to|couldn't be delivered to|nicht zustellbar an|unzustellbar an)[:\s]*[^\n]*?([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i.exec(bodyText);
 if(marker?.[1]&&marker[1].toLowerCase()!==own)return marker[1].toLowerCase();
 const all=(bodyText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)||[]).map(v=>v.toLowerCase()).filter(v=>v!==own&&!/^(mailer-daemon|postmaster)@/.test(v));
 if(!all.length)return "";
 const counts=new Map<string,number>();for(const v of all)counts.set(v,(counts.get(v)||0)+1);
 return [...counts.entries()].sort((a,b)=>b[1]-a[1])[0][0];
}
async function recordBounce(messageId:string,bouncedEmail:string,mailboxId:string){
 const existing=await query<{id:number}>("select id from er_events where workspace='default' and type='bounce' and meta->>'providerMessageId'=$1 limit 1",[messageId]);if(existing.length)return false;
 await query("insert into er_suppressions(workspace,email,reason) values('default',lower($1),'bounce') on conflict(workspace,email) do update set reason=excluded.reason",[bouncedEmail]);
 await query("update er_outbox set status='suppressed' where workspace='default' and lower(recipient)=lower($1) and status='queued'",[bouncedEmail]);
 await query(
  `insert into er_events(workspace,lead_id,type,meta) values('default',
    (select l.id from sales_leads l join sales_contacts ct on ct.id=l.contact_id where l.workspace='default' and lower(ct.email)=lower($1) limit 1),
    'bounce',$2::jsonb)`,
  [bouncedEmail,JSON.stringify({providerMessageId:messageId,email:bouncedEmail,mailboxId})],
 );
 return true;
}
async function syncImap(c:Credential){
 const messages=await listImapMessages(c as ImapMailboxCredential,50);let replies=0,bounces=0;
 for(const m of messages){
  const from=m.from.toLowerCase();if(!from)continue;
  const messageId=m.messageId||`imap:${c.id}:${m.uid}`;
  if(isBounceMessage(from,m.subject)){
   const bounced=extractBouncedEmail(m.bodyText,c.email.toLowerCase());
   if(bounced&&await recordBounce(messageId,bounced,c.id))bounces++;
   continue;
  }
  if(from===c.email.toLowerCase())continue;
  if(await recordReply(messageId,from,m.subject,c.id))replies++;
 }
 return {replies,bounces};
}
async function run(request:Request){if(!auth(request))return Response.json({error:"Unauthorized"},{status:401});let credentials:Credential[]=[];try{credentials=await loadMailboxCredentials()}catch{return Response.json({error:"Mailbox Credentials JSON ungültig."},{status:503})}let replies=0,bounces=0;const errors:string[]=[];for(const c of credentials){try{if(c.provider==="gmail")replies+=await syncGmail(c);else if(c.provider==="microsoft")replies+=await syncMicrosoft(c);else if(c.provider==="smtp"&&(c as ImapMailboxCredential).imapHost){const r=await syncImap(c);replies+=r.replies;bounces+=r.bounces}}catch(e){errors.push(`${c.id}: ${e instanceof Error?e.message:"Sync Fehler"}`)}}return Response.json({ok:true,mailboxes:credentials.length,newReplies:replies,newBounces:bounces,errors})}
export async function GET(request:Request){return run(request)}export async function POST(request:Request){return run(request)}

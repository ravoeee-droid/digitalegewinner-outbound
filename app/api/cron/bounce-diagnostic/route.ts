import { loadMailboxCredentials } from "@/lib/mailbox-credentials";
import { listImapMessages, type ImapMailboxCredential } from "@/lib/imap-client";

export const runtime="nodejs";
export const maxDuration=30;

export async function GET(){
 const credentials=await loadMailboxCredentials();
 const mailbox=credentials.find((x)=>x.id==="mb-netcup-raphael") as ImapMailboxCredential | undefined;
 if(!mailbox)return Response.json({error:"Mailbox fehlt"},{status:404});
 const messages=await listImapMessages(mailbox,50);
 const matches=messages.filter((m)=>{
   const s=(m.subject||"").toLowerCase();
   const f=(m.from||"").toLowerCase();
   return s.includes("delivery")||s.includes("undeliver")||s.includes("failure")||s.includes("returned")||s.includes("zustell")||f.includes("mailer-daemon")||f.includes("postmaster");
 }).slice(0,20);
 return Response.json({ok:true,count:matches.length,matches:matches.map((m)=>({from:m.from,subject:m.subject,date:m.date,body:m.bodyText.slice(0,1600)}))});
}
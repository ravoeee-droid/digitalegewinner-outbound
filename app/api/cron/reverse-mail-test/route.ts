import { loadMailboxCredentials } from "@/lib/mailbox-credentials";
import { listImapMessages, type ImapMailboxCredential } from "@/lib/imap-client";

export const runtime="nodejs";
export const maxDuration=30;

export async function GET(){
 const credentials=await loadMailboxCredentials();
 const mailbox=credentials.find((x)=>x.id==="mb-netcup-raphael") as ImapMailboxCredential | undefined;
 if(!mailbox)return Response.json({error:"Mailbox fehlt"},{status:404});
 const messages=await listImapMessages(mailbox,25);
 const matches=messages.filter((m)=>m.subject.includes("Gegenprobe Mailzustellung 27.09.")||m.from.toLowerCase().includes("gmail.com")).slice(0,10);
 return Response.json({ok:true,count:matches.length,matches:matches.map((m)=>({from:m.from,subject:m.subject,date:m.date,unread:m.unread,body:m.bodyText.slice(0,500)}))});
}
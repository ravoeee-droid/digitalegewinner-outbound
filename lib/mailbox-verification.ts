import nodemailer from "nodemailer";
import { testImapConnection, type ImapMailboxCredential } from "./imap-client";
import type { StoredMailboxCredential } from "./mailbox-credentials";
import { DG_MAILBOX_EMAILS } from "./dg-mailboxes";

export type NetcupCredential = StoredMailboxCredential & ImapMailboxCredential;

export function publicMailbox(item: NetcupCredential) {
  return {id:item.id,name:item.name || "",email:item.email,provider:item.provider,
    imapHost:item.imapHost || "",imapPort:Number(item.imapPort || 993),
    smtpHost:item.smtpHost || "",smtpPort:Number(item.smtpPort || 465),
    configured:Boolean(item.imapHost && (item.imapPass || item.smtpPass) && item.smtpHost && item.smtpPass)};
}

export async function verifyMailbox(credential: NetcupCredential) {
  const transport = nodemailer.createTransport({host:credential.smtpHost,port:Number(credential.smtpPort || 465),
    secure:Number(credential.smtpPort || 465)===465,auth:{user:credential.smtpUser,pass:credential.smtpPass},
    connectionTimeout:12_000,greetingTimeout:12_000,socketTimeout:15_000});
  try {
    const results=await Promise.allSettled([testImapConnection(credential),transport.verify()]);
    const failed=results.find(result=>result.status==="rejected");
    if(failed?.status==="rejected")throw failed.reason;
  } finally {transport.close();}
}

export async function verifyDgMailboxes(password:string,name="Raphael Hermann",verify=verifyMailbox) {
  const verified: NetcupCredential[]=[];
  const failures: Array<{email:string;error:string}>=[];
  // Two mailboxes at a time limits simultaneous Netcup logins to four.
  for(let offset=0;offset<DG_MAILBOX_EMAILS.length;offset+=2) {
    await Promise.all(DG_MAILBOX_EMAILS.slice(offset,offset+2).map(async email=>{
      const credential:NetcupCredential={id:`mb-${email.replace(/[^a-z0-9]+/g,"-").replace(/-$/g,"")}`,
        provider:"smtp",email,name,smtpHost:"mxe9bf.netcup.net",smtpPort:465,smtpUser:email,smtpPass:password,
        imapHost:"mxe9bf.netcup.net",imapPort:993,imapUser:email,imapPass:password};
      try{await verify(credential);verified.push(credential);}
      catch{failures.push({email,error:"IMAP- oder SMTP-Anmeldung fehlgeschlagen. Bitte das Mailpasswort prüfen."});}
    }));
  }
  verified.sort((a,b)=>DG_MAILBOX_EMAILS.indexOf(a.email as typeof DG_MAILBOX_EMAILS[number])-DG_MAILBOX_EMAILS.indexOf(b.email as typeof DG_MAILBOX_EMAILS[number]));
  return {verified,failures};
}

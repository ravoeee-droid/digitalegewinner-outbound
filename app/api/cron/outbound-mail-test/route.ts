import { loadMailboxCredentials } from "@/lib/mailbox-credentials";
import { sendMail } from "@/lib/mailer";

export const runtime="nodejs";
export const maxDuration=30;

export async function GET(){
 const credentials=await loadMailboxCredentials();
 const mailbox=credentials.find((x)=>x.id==="mb-netcup-raphael");
 if(!mailbox)return Response.json({error:"Mailbox fehlt"},{status:404});
 const sent=await sendMail({
   ...mailbox,
   to:"digitalegewinner@gmail.com",
   subject:"Digitale Gewinner – Zustelltest nach DNS",
   text:"Hi Raphael,\n\ndas ist der erneute Zustelltest nach der Mail-DNS-Konfiguration.\n\nViele Grüße\nDigitale Gewinner"
 });
 return Response.json({ok:true,sent:true,from:mailbox.email,to:"digitalegewinner@gmail.com",id:sent.id});
}
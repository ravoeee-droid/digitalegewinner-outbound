import { loadMailboxCredentials } from "@/lib/mailbox-credentials";
import { sendMail } from "@/lib/mailer";

export const runtime="nodejs";
export const maxDuration=60;

export async function GET(){
  const credentials=await loadMailboxCredentials();
  const ids=["mb-netcup-hermann","mb-netcup-hermann-raphael","mb-netcup-raphael-hermann"];
  const results=[];
  for(const id of ids){
    const mailbox=credentials.find((x)=>x.id===id);
    if(!mailbox){results.push({id,ok:false,error:"Mailbox credential missing"});continue;}
    try{
      const sent=await sendMail({
        ...mailbox,
        to:"digitalegewinner@gmail.com",
        subject:"DG Mailbox Test – "+mailbox.email,
        text:"Testversand von "+mailbox.email+" nach der DNS-Reparatur."
      });
      results.push({id,email:mailbox.email,ok:true,messageId:sent.id});
    }catch(e:any){
      results.push({id,email:mailbox.email,ok:false,error:String(e?.message||e)});
    }
  }
  return Response.json({ok:true,results});
}
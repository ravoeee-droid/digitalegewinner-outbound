import { query } from "@/lib/db";
import { verifyOpen } from "@/lib/email-tracking";
import { sendAlertOnce } from "@/lib/alerts";

export const runtime="nodejs";
export const dynamic="force-dynamic";

const GIF=new Uint8Array(Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==","base64"));

// Telegram bei der ersten Öffnung pro Lead. Öffnungen in den ersten 60 Sekunden nach dem Versand sind meist Virenscanner und werden nicht gemeldet.
async function notifyOpen(outboxId:string,leadId:string){
  try{
    const [row]=await query<{recipient:string;subject:string;age:number}>(
      "select recipient,subject,extract(epoch from (now()-sent_at))::int age from er_outbox where id::text=$1 limit 1",[outboxId]);
    if(!row||row.age<60)return;
    await sendAlertOnce(`open:${leadId}`,`👀 E-Mail geöffnet\n${row.recipient}\n„${row.subject}"`,24*30);
  }catch{}
}

export async function GET(request:Request){
  const url=new URL(request.url);
  const outboxId=url.searchParams.get("o")||"";
  const leadId=url.searchParams.get("l")||"";
  const sig=url.searchParams.get("s")||"";
  if(outboxId&&leadId&&sig&&verifyOpen(outboxId,leadId,sig)){
    await query(
      "insert into er_events(workspace,lead_id,type,meta) values('default',$1,'email_open',$2::jsonb)",
      [leadId,JSON.stringify({outboxId})],
    ).catch(()=>null);
    await notifyOpen(outboxId,leadId);
  }
  return new Response(GIF,{status:200,headers:{"content-type":"image/gif","cache-control":"no-store, no-cache, must-revalidate, max-age=0","pragma":"no-cache"}});
}

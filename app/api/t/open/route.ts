import { query } from "@/lib/db";
import { verifyOpen } from "@/lib/email-tracking";

export const runtime="nodejs";
export const dynamic="force-dynamic";

const GIF=new Uint8Array(Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==","base64"));

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
  }
  return new Response(GIF,{status:200,headers:{"content-type":"image/gif","cache-control":"no-store, no-cache, must-revalidate, max-age=0","pragma":"no-cache"}});
}

import { query } from "@/lib/db";
import { decodeTarget, verifyClick } from "@/lib/email-tracking";

export const runtime="nodejs";
export const dynamic="force-dynamic";

export async function GET(request:Request){
  const url=new URL(request.url);
  const outboxId=url.searchParams.get("o")||"";
  const leadId=url.searchParams.get("l")||"";
  const encoded=url.searchParams.get("u")||"";
  const sig=url.searchParams.get("s")||"";
  const target=decodeTarget(encoded);
  if(!outboxId||!leadId||!encoded||!sig||!target||!verifyClick(outboxId,leadId,encoded,sig)){
    return new Response("Invalid tracking link",{status:400});
  }
  await query(
    "insert into er_events(workspace,lead_id,type,meta) values('default',$1,'email_click',$2::jsonb)",
    [leadId,JSON.stringify({outboxId,target})],
  ).catch(()=>null);
  return new Response(null,{status:302,headers:{location:target,"cache-control":"no-store"}});
}

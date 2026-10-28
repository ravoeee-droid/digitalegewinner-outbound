import { query } from "@/lib/db";
import { decodeTarget, verifyClick, videoToken } from "@/lib/email-tracking";

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
  // Preserve suspected scanner evidence; a tracked click alone is NOT proof of a human.
  const agent=request.headers.get("user-agent")||"";
  const knownScanner=/(bot|crawl|spider|scan|proofpoint|mimecast|barracuda|safelinks|defender|symantec|trend ?micro|python|curl|wget|go-http|headless|preview)/i.test(agent);
  const [sent]=await query<{age:number|null}>(
    "select extract(epoch from (now()-sent_at))::int age from er_outbox where id::text=$1 limit 1",
    [outboxId],
  ).catch(()=>[]);
  const immediate=sent?.age!=null && sent.age>=0 && sent.age<90;
  await query(
    "insert into er_events(workspace,lead_id,type,meta) values('default',$1,'email_click',$2::jsonb)",
    [leadId,JSON.stringify({outboxId,target,botSuspected:knownScanner||immediate,scannerReason:knownScanner?"user_agent":immediate?"immediate_after_send":null})],
  ).catch(()=>null);
  // Clicks remain tracked for reporting, but are too noisy for Telegram.
  // Links auf die eigene Website bekommen die Lead-Kennung mit, damit der Besuch dort dem Lead zugeordnet werden kann (ohne Cookies).
  let location=target;
  try{const u=new URL(target);if(/(^|\.)digitalegewinner\.de$/i.test(u.hostname)&&!u.searchParams.has("lt")){u.searchParams.set("lt",videoToken(leadId));location=u.toString();}}catch{/* Ziel bleibt unverändert */}
  return new Response(null,{status:302,headers:{location,"cache-control":"no-store"}});
}

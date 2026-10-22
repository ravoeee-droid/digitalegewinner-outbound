import { query } from "@/lib/db";
import { decodeTarget, verifyClick, videoToken } from "@/lib/email-tracking";
import { sendAlertOnce } from "@/lib/alerts";

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
  // Sicherheits-Scanner der Empfänger klicken Links in Sekunden nach der Zustellung. Das ist kein Mensch und wird nicht gemeldet.
  const agent=request.headers.get("user-agent")||"";
  const [sentRow]=await query<{age:number;recipient:string}>("select extract(epoch from (now()-sent_at))::int age, recipient from er_outbox where id::text=$1",[outboxId]).catch(()=>[]);
  const botLike=/(bot|crawl|spider|scan|proofpoint|mimecast|barracuda|safelinks|defender|symantec|trend ?micro|python|curl|wget|go-http|headless|preview)/i.test(agent)||(sentRow&&sentRow.age<300);
  if(!botLike)await sendAlertOnce(`click:${leadId}`,`🔗 Link geklickt: ${sentRow?.recipient||"Lead "+leadId}\n${target}`,24*30).catch(()=>null);
  // Links auf die eigene Website bekommen die Lead-Kennung mit, damit der Besuch dort dem Lead zugeordnet werden kann (ohne Cookies).
  let location=target;
  try{const u=new URL(target);if(/(^|\.)digitalegewinner\.de$/i.test(u.hostname)&&!u.searchParams.has("lt")){u.searchParams.set("lt",videoToken(leadId));location=u.toString();}}catch{/* Ziel bleibt unverändert */}
  return new Response(null,{status:302,headers:{location,"cache-control":"no-store"}});
}

import { query } from "@/lib/db";
import { verifyUnsubscribe } from "@/lib/email-tracking";

export const runtime="nodejs";
export const dynamic="force-dynamic";

function page(title:string,body:string,status=200){
  return new Response(`<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head><body style="font-family:Arial,sans-serif;max-width:460px;margin:12vh auto;padding:0 20px;color:#111;line-height:1.55"><h1 style="font-size:22px">${title}</h1>${body}</body></html>`,{status,headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store"}});
}
function params(request:Request){
  const url=new URL(request.url);
  return {o:url.searchParams.get("o")||"",l:url.searchParams.get("l")||"",s:url.searchParams.get("s")||""};
}

// GET zeigt nur eine Bestätigung: Link-Scanner der Mailprovider dürfen niemanden versehentlich abmelden.
export async function GET(request:Request){
  const {o,l,s}=params(request);
  if(!o||!l||!s||!verifyUnsubscribe(o,l,s))return page("Link ungültig","<p>Dieser Abmelde-Link ist ungültig oder abgelaufen. Antworten Sie einfach auf die E-Mail mit „Abmelden“.</p>",400);
  return page("Keine weiteren E-Mails?",`<p>Wir tragen Ihre Adresse in unsere Sperrliste ein. Sie erhalten danach keine Nachrichten mehr von uns.</p><form method="post"><button style="font-size:16px;padding:12px 20px;border:0;border-radius:8px;background:#111;color:#fff;cursor:pointer">Ja, abmelden</button></form>`);
}

// POST: Bestätigung auf der Seite und RFC-8058 One-Click aus dem Mailprogramm.
export async function POST(request:Request){
  const {o,l,s}=params(request);
  if(!o||!l||!s||!verifyUnsubscribe(o,l,s))return page("Link ungültig","<p>Dieser Abmelde-Link ist ungültig.</p>",400);
  const rows=await query<{recipient:string}>("select recipient from er_outbox where id=$1 and lead_id=$2",[o,l]);
  const email=rows[0]?.recipient?.trim().toLowerCase();
  if(!email)return page("Link ungültig","<p>Die Nachricht wurde nicht gefunden.</p>",404);
  await query("insert into er_suppressions(workspace,email,reason) values('default',$1,'unsubscribed') on conflict(workspace,email) do nothing",[email]);
  await query("update sales_leads set do_not_contact=true,updated_at=now() where workspace='default' and id=$1",[l]).catch(()=>null);
  await query("update er_outbox set status='cancelled',error='unsubscribed' where workspace='default' and lower(recipient)=$1 and status in ('queued','sending')",[email]).catch(()=>null);
  await query("insert into er_events(workspace,lead_id,type,meta) values('default',$1,'unsubscribed',$2::jsonb)",[l,JSON.stringify({outboxId:o})]).catch(()=>null);
  return page("Abgemeldet","<p>Ihre Adresse steht auf unserer Sperrliste. Sie erhalten keine weiteren E-Mails von uns.</p>");
}

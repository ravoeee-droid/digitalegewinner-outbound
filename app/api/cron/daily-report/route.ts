import { query } from "@/lib/db";
import { sendAlert } from "@/lib/alerts";

export const runtime="nodejs";
export const maxDuration=60;

function authorized(request:Request){
  const expected=process.env.CRON_SECRET;
  return Boolean(expected&&(request.headers.get("authorization")||"")===`Bearer ${expected}`);
}

const TODAY="(now() at time zone 'Europe/Berlin')::date";
const berlin=(column:string)=>`(${column} at time zone 'Europe/Berlin')::date`;

async function run(request:Request){
  if(!authorized(request))return Response.json({error:"Unauthorized"},{status:401});
  try{
    const [row]=await query<Record<string,number>>(`
      select
        (select count(*)::int from er_outbox where workspace='default' and status='sent' and ${berlin("sent_at")}=${TODAY}) sent,
        (select count(*)::int from er_outbox where workspace='default' and status='sent' and sent_at>=now()-interval '7 days') sent7,
        (select count(distinct lead_id)::int from er_events where workspace='default' and type='email_open' and ${berlin("created_at")}=${TODAY}) opened,
        (select count(distinct lead_id)::int from er_events where workspace='default' and type='email_click' and ${berlin("created_at")}=${TODAY}) clicked,
        (select count(distinct lead_id)::int from er_events where workspace='default' and type in ('reply','positive_reply') and ${berlin("created_at")}=${TODAY}) replied,
        (select count(distinct lead_id)::int from er_events where workspace='default' and type in ('appointment','appointment_attended') and ${berlin("created_at")}=${TODAY}) meetings,
        (select count(distinct lead_id)::int from er_events where workspace='default' and type in ('appointment','appointment_attended') and created_at>=now()-interval '7 days') meetings7,
        (select count(*)::int from er_events where workspace='default' and type='bounce' and ${berlin("created_at")}=${TODAY}) bounces,
        (select count(*)::int from er_events where workspace='default' and type='unsubscribed' and ${berlin("created_at")}=${TODAY}) unsubscribed,
        (select count(*)::int from er_outbox where workspace='default' and status='failed' and ${berlin("created_at")}=${TODAY}) failed,
        (select count(*)::int from er_outbox where workspace='default' and status='queued') queued
    `);
    const goal=Number(process.env.APPOINTMENT_GOAL_PER_DAY)||4;
    const target=Number(process.env.PFLEGE_CAMPAIGN_DAILY_TARGET)||300;
    const lines=[
      "📊 Tagesbericht Digitale Gewinner",
      `✉️ Gesendet: ${row.sent} von ${target}`,
      `👀 Geöffnet: ${row.opened} · 🔗 Geklickt: ${row.clicked}`,
      `💬 Antworten: ${row.replied}`,
      `📅 Termine heute: ${row.meetings} von ${goal} (7 Tage: ${row.meetings7})`,
      `⚠️ Bounces: ${row.bounces} · Abmeldungen: ${row.unsubscribed} · Fehlgeschlagen: ${row.failed}`,
      `⏳ In der Warteschlange: ${row.queued}`,
    ];
    if(row.sent===0)lines.push("","❗ Heute wurde keine Mail gesendet. Bitte Postfächer, Kampagne und Cron Jobs prüfen.");
    const sent=await sendAlert(lines.join("\n"));
    return Response.json({ok:true,telegram:sent,...row});
  }catch(error){
    console.error("[daily-report] failed",error);
    await sendAlert(`❗ Tagesbericht konnte nicht erstellt werden: ${error instanceof Error?error.message:"Fehler"}`);
    return Response.json({ok:false,error:error instanceof Error?error.message:"Fehler"},{status:500});
  }
}

export async function GET(request:Request){return run(request)}
export async function POST(request:Request){return run(request)}

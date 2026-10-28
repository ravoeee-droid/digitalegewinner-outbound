import { query } from "@/lib/db";
import { leadSegmentSql } from "@/lib/lead-segment";
import { loadMailboxCredentials } from "@/lib/mailbox-credentials";
import { sendMail } from "@/lib/mailer";
import { videoPageUrl } from "@/lib/email-tracking";
import { VIDEO_IDS } from "@/lib/outreach-copy";

export const runtime = "nodejs";
export const maxDuration = 300;

// Time-limited internal test: sends previews only to the owner's confirmed inbox,
// never to the prospective recipients. It cannot authorize a live campaign.
const BATCH = "dg-loom-preview-2026-10-28-v1";
const OWNER_INBOX = "digitalegewinner@gmail.com";
type Candidate = { lead_id:string; company:string; contact:string; email:string; segment:"pflege"|"pv" };
function escapeHtml(s:string) {return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");}
function originFor(request:Request) {
  const configured=(process.env.NEXT_PUBLIC_APP_URL||"").trim().replace(/\/+$/,"");
  return /^https:\/\/[^\s/]+$/i.test(configured) ? configured : new URL(request.url).origin;
}
function safeGreeting(raw:string) {
  const name=String(raw||"").trim().replace(/\s+/g," ");
  return /^[A-ZÄÖÜ][a-zäöüß]+(?:[ -][A-ZÄÖÜ][a-zäöüß]+){1,2}$/.test(name) ? "Guten Tag "+name+"," : "Guten Tag,";
}
async function candidates():Promise<Candidate[]> {
  const segment=leadSegmentSql("c");
  return query<Candidate>(`
    with base as (
      select l.id::text lead_id, c.name company, coalesce(ct.name,'') contact,
             trim(ct.email) email, ${segment} segment,
             coalesce(l.priority_score,0) score, l.updated_at, l.company_id
      from sales_leads l
      join sales_companies c on c.id=l.company_id and c.workspace=l.workspace
      join sales_contacts ct on ct.id=l.contact_id and ct.workspace=l.workspace
      join lead_screenshots sc on sc.lead_id=l.id::text and sc.status='ok' and sc.data is not null
      where l.workspace='default' and l.status='active'
        and l.stage in ('Neu','Research','Bereit')
        and coalesce(l.do_not_contact,false)=false
        and ct.email ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
        and not exists (select 1 from er_suppressions s where s.workspace='default' and lower(s.email)=lower(ct.email))
        and not exists (select 1 from outbound_compliance_suppressions s where s.workspace='default' and s.channel='email' and s.status='active' and lower(s.identifier)=lower(ct.email))
        and not exists (select 1 from er_outbox o where o.workspace='default'
          and (o.lead_id=l.id::text or lower(o.recipient)=lower(ct.email)) and o.status in ('sent','queued','sending'))
        and not exists (select 1 from er_events e where e.workspace='default' and e.lead_id=l.id::text
          and e.type in ('reply','positive_reply','appointment','bounce'))
    ), ranked as (
      select *,row_number() over(partition by segment,company_id order by score desc,updated_at desc,lead_id) company_rank,
               row_number() over(partition by segment,lower(email) order by score desc,updated_at desc,lead_id) email_rank
      from base where segment in ('pflege','pv')
        and not (segment='pv' and email ~* '^(bewerbung|bewerbungen|bewerber|karriere|jobs?|hr|personal|recruiting|career|careers|application|applications|stellen|ausbildung)[._-]?[a-z0-9]*@')
    ), selected as (
      select *,row_number() over(partition by segment order by score desc,updated_at desc,lead_id) pos
      from ranked where company_rank=1 and email_rank=1
    )
    select lead_id,company,contact,email,segment from selected
    where pos<=5 order by segment,pos
  `);
}
export async function GET(request:Request) {
  const expected=process.env.CRON_SECRET;
  if(!expected || request.headers.get("authorization")!==`Bearer ${expected}`)
    return Response.json({ok:false,error:"Unauthorized"},{status:401});
  const berlinDay=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Berlin",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  if(berlinDay!=="2026-10-28") return Response.json({ok:true,skipped:"expired"});
  if(!VIDEO_IDS.pflege||!VIDEO_IDS.pv) return Response.json({ok:false,error:"video_id_missing"},{status:503});
  const mailboxes=(await loadMailboxCredentials()).filter(m=>m.provider==="smtp"&&m.smtpHost&&m.smtpUser&&m.smtpPass);
  if(!mailboxes.length) return Response.json({ok:false,error:"smtp_credentials_missing"},{status:503});
  const selected=await candidates();
  if(selected.length!==10) return Response.json({ok:false,error:"insufficient_candidates",found:selected.length},{status:503});
  const [existing]=await query<{n:string}>("select count(*)::text n from er_events where workspace='default' and type='loom_test_sent' and meta->>'batch'=$1",[BATCH]);
  if(Number(existing?.n||0)>=10) return Response.json({ok:true,already_sent:10});
  const baseUrl=originFor(request),mailbox=mailboxes[0];
  let sent=0,failed=0;
  for(let i=0;i<selected.length;i++) {
    const lead=selected[i];
    const [already]=await query<{n:string}>(
      "select count(*)::text n from er_events where workspace='default' and type='loom_test_sent' and meta->>'batch'=$1 and meta->>'lead_id'=$2",
      [BATCH,lead.lead_id]
    );
    if(Number(already?.n||0)>0)continue;
    const link=videoPageUrl(baseUrl,lead.lead_id);
    const body=[safeGreeting(lead.contact),`ich habe eine kurze Videonachricht für ${lead.company} vorbereitet:`,link,
      `Beste Grüße\nRaphael Hermann\nDigitale Gewinner\n${lead.segment==="pflege"?"https://digitalegewinner.de/pflege":"https://digitalegewinner.de/pv-trust"}`].join("\n\n");
    const subject=`[LOOM-TEST ${i+1}/10 · ${lead.segment.toUpperCase()}] Persönliche Videonachricht für ${lead.company}`.slice(0,175);
    const header=`NUR INTERNE TESTMAIL – kein Lead wurde angeschrieben.\nGeplanter Empfänger: ${lead.email}\nSegment: ${lead.segment}\nFirmen-Screenshot: ${link}\n\n--- VORSCHAU DER KUNDENMAIL ---\n\n`;
    try {
      const text=header+body;
      const html=`<div style="font:14px Arial,sans-serif;line-height:1.6"><p style="background:#fff6dc;padding:12px"><strong>INTERNE TESTMAIL ${i+1}/10 · ${escapeHtml(lead.segment)}</strong><br>Geplanter Empfänger: ${escapeHtml(lead.email)}</p><hr><p>${escapeHtml(body).replace(/\n/g,"<br>").replace(escapeHtml(link),`<a href="${escapeHtml(link)}">${escapeHtml(link)}</a>`)}</p></div>`;
      await sendMail({...mailbox,to:OWNER_INBOX,subject,text,html});
      await query("insert into er_events(workspace,lead_id,type,meta) values('default',$1,'loom_test_sent',$2::jsonb)",
        [lead.lead_id,JSON.stringify({batch:BATCH,lead_id:lead.lead_id,segment:lead.segment,recipient:OWNER_INBOX})]);
      sent++;
    } catch(error) {
      failed++;
      console.error("[loom-test] failed",i+1,error instanceof Error?error.message:"unknown");
      break;
    }
  }
  return Response.json({ok:failed===0,batch:BATCH,just_sent:sent,failed});
}

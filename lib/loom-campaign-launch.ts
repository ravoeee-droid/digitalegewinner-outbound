
import { query, readStateFields } from "@/lib/db";
import { leadSegmentSql } from "@/lib/lead-segment";
import { evaluateEmailSendCompliance } from "@/lib/outbound-compliance-runtime";
import { loadMailboxCredentials } from "@/lib/mailbox-credentials";
import { VIDEO_IDS } from "@/lib/outreach-copy";

type Segment = "pflege" | "pv";
type Candidate = { id: string; email: string; company: string; contact: string; priority_score: number };
type StateCampaign = {
  id: string; name: string; audience: string; status: "Entwurf" | "Aktiv" | "Pausiert";
  dailyLimit: number; steps: Array<{ waitDays: number; subject: string; body: string }>;
  sent: number; replies: number; positive: number; appointments: number;
};
const LEGACY = new Set(["pflege-starter-v2", "pv-starter-v1"]);
export const LOOM_CAMPAIGNS: Record<Segment,string> = { pflege: "pflege-loom-150-v1", pv: "pv-loom-150-v1" };
const MAX_PER_SEGMENT = 150;
const PV_CAREER_RECIPIENT = /^(bewerbung|bewerbungen|bewerber|karriere|jobs?|hr|personal|recruiting|career|careers|application|applications|stellen|ausbildung)[._-]?[a-z0-9]*@/i;

function emailBody(segment:Segment, company:string, contact:string) {
  // Same face recording for a sector, but a genuinely company-specific screenshot on each video page.
  const cleaned = String(contact||"").trim().replace(/\s+/g," ");
  const greeting = /^(?:[A-ZÄÖÜ][a-zäöüß]+(?:[ -][A-ZÄÖÜ][a-zäöüß]+){1,2})$/.test(cleaned)
    ? `Guten Tag ${cleaned},`
    : "Guten Tag,";
  const sectorLink = segment==="pflege" ? "https://digitalegewinner.de/pflege" : "{{pv_link}}";
  return [
    greeting,
    `ich habe eine kurze Videonachricht für ${company} vorbereitet:`,
    "{{video_link}}",
    "Beste Grüße\nRaphael Hermann\nDigitale Gewinner\n"+sectorLink,
  ].join("\n\n");
}
function campaignDefinition(segment:Segment):StateCampaign {
  const isCare=segment==="pflege";
  return {
    id: LOOM_CAMPAIGNS[segment],
    name: isCare?"Loom-Video · Pflege · 150 Betriebe":"Loom-Video · PV-Trust · 150 Betriebe",
    audience: isCare?"150 geprüfte Pflegebetriebe, eigene Bewerbergewinnung":"150 geprüfte Photovoltaikbetriebe, eigene exklusive Anfragen",
    status:"Entwurf",
    dailyLimit:150,
    steps:[{
      waitDays:0,
      subject:"Persönliche Videonachricht für {{company}}",
      body: emailBody(segment,"{{company}}",""),
    }],
    sent:0,replies:0,positive:0,appointments:0,
  };
}
async function writeCampaignDashboard(pending:Record<Segment,number>) {
  // The workspace state may contain thousands of legacy leads. Fetch and write
  // only the campaigns JSON subdocument to prevent massive Neon network egress.
  const [row] = await query<{campaigns:StateCampaign[]|null}>(
    "select payload->'campaigns' as campaigns from er_state where workspace='default'",
  );
  if (!row) return;
  const campaigns = Array.isArray(row.campaigns) ? row.campaigns : [];
  const existing = new Set(campaigns.map(c=>c.id));
  const updated = campaigns.map(c=>LEGACY.has(c.id)?{...c,status:"Pausiert" as const}:c);
  for (const segment of ["pflege","pv"] as const) {
    const id = LOOM_CAMPAIGNS[segment];
    if (!existing.has(id)) updated.push({...campaignDefinition(segment),status:pending[segment]>0?"Aktiv":"Entwurf"});
    else for (let i=0;i<updated.length;i++) if(updated[i].id===id&&pending[segment]>0)
      updated[i]={...updated[i],status:"Aktiv"};
  }
  if (JSON.stringify(updated)!==JSON.stringify(campaigns)) {
    await query(
      "update er_state set payload=jsonb_set(payload,'{campaigns}',$1::jsonb,true),version=version+1,updated_at=now() where workspace='default' and payload->'campaigns' is not distinct from $2::jsonb",
      [JSON.stringify(updated),row.campaigns===null?null:JSON.stringify(row.campaigns)],
    );
  }
}
async function candidatePool(segment:Segment,limit:number) {
  const segmentSql=leadSegmentSql("c");
  // Deduplicate both company and recipient, not just one of them.
  // Rank globally by priority; DISTINCT ON(company) previously selected by company UUID,
  // accidentally ignoring high-priority candidates outside the first 650 UUIDs.
  return query<Candidate>(
    `with ranked as (
       select l.id::text id,trim(ct.email) email,c.name company,
         coalesce(ct.name,'') contact,coalesce(l.priority_score,0) priority_score,
         row_number() over (partition by l.company_id order by l.priority_score desc nulls last,l.updated_at desc,l.id) company_rank,
         row_number() over (partition by lower(trim(ct.email)) order by l.priority_score desc nulls last,l.updated_at desc,l.id) recipient_rank
       from sales_leads l
       join sales_companies c on c.id=l.company_id and c.workspace=l.workspace
       join sales_contacts ct on ct.id=l.contact_id and ct.workspace=l.workspace
       join lead_screenshots sc on sc.lead_id=l.id::text and sc.status='ok'
       where l.workspace='default' and l.status='active'
         and l.stage in ('Neu','Research','Bereit')
         and coalesce(l.do_not_contact,false)=false
         and ${segmentSql}=$1
         and ct.email ~* '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'
         and not exists(select 1 from er_suppressions s where s.workspace='default' and lower(s.email)=lower(ct.email))
         and not exists(select 1 from outbound_compliance_suppressions s where s.workspace='default' and s.channel='email' and s.status='active' and lower(s.identifier)=lower(ct.email))
         and not exists(select 1 from er_outbox o
            where o.workspace='default' and
               (o.lead_id=l.id::text or lower(o.recipient)=lower(ct.email))
               and (o.status='sent' or (o.status in ('queued','sending') and o.campaign_id not in ('pflege-starter-v2','pv-starter-v1'))))
         and not exists(select 1 from er_events e where e.workspace='default' and e.lead_id=l.id::text and e.type in ('reply','positive_reply','appointment','bounce'))
         and not exists(select 1 from er_outbox d where d.workspace='default'
           and (d.lead_id=l.id::text or lower(d.recipient)=lower(ct.email))
           and d.campaign_id in ('pflege-loom-150-v1','pv-loom-150-v1'))
     )
     select id,email,company,contact,priority_score from ranked
     where company_rank=1 and recipient_rank=1
     order by priority_score desc,id
     limit $2`, [segment,limit],
  );
}

export async function diagnoseLoomReadiness() {
  const out: Record<string, unknown>[] = [];
  for (const segment of ["pflege", "pv"] as const) {
    const sql = [
      "with base as (select l.id, ct.email,",
      "(position('@' in coalesce(ct.email,''))>1) as valid_email,",
      "not exists(select 1 from er_suppressions s where s.workspace='default' and lower(s.email)=lower(ct.email))",
      "and not exists(select 1 from outbound_compliance_suppressions s where s.workspace='default'",
      "and s.channel='email' and s.status='active' and lower(s.identifier)=lower(ct.email)) as unsuppressed,",
      "not exists(select 1 from er_outbox o where o.workspace='default'",
      "and (o.lead_id=l.id::text or lower(o.recipient)=lower(ct.email))",
      "and (o.status='sent' or (o.status in ('queued','sending')",
      "and coalesce(o.campaign_id,'') not in ('pflege-starter-v2','pv-starter-v1')))) as untouched,",
      "exists(select 1 from outbound_contact_permissions p where p.workspace='default'",
      "and p.channel='email' and p.status='verified'",
      "and (p.contact_id=l.contact_id or p.company_id=l.company_id)",
      "and p.revoked_at is null and (p.valid_from is null or p.valid_from<=now())",
      "and (p.valid_until is null or p.valid_until>=now())) as permitted,",
      "exists(select 1 from lead_screenshots s where s.lead_id=l.id::text and s.status='ok') as screenshot",
      "from sales_leads l",
      "join sales_companies c on c.id=l.company_id and c.workspace=l.workspace",
      "join sales_contacts ct on ct.id=l.contact_id and ct.workspace=l.workspace",
      "where l.workspace='default' and l.status='active'",
      "and l.stage in ('Neu','Research','Bereit')",
      "and coalesce(l.do_not_contact,false)=false",
      "and " + leadSegmentSql("c") + "=$1)",
      "select count(*)::int in_pipeline,",
      "count(*) filter(where valid_email)::int with_email,",
      "count(*) filter(where valid_email and unsuppressed and untouched)::int unsent_not_blocked,",
      "count(*) filter(where valid_email and unsuppressed and untouched and permitted)::int verified_email_permission,",
      "count(*) filter(where valid_email and unsuppressed and untouched and screenshot)::int with_screenshot,",
      "count(*) filter(where valid_email and unsuppressed and untouched and permitted and screenshot)::int ready,",
      "count(*) filter(where valid_email and unsuppressed and untouched and permitted and not screenshot)::int needs_screenshot",
      "from base",
    ].join(" ");
    const [row] = await query<Record<string, number>>(sql, [segment]);
    out.push({segment, ...row});
  }
  return out;
}

export async function ensureLoomCampaigns() {
  // Old sequences must not survive the switch.
  const [old] = await query<{n:string}>(
    "with affected as (update er_outbox set status='suppressed',error='Alte Kampagne durch Loom ersetzt' where workspace='default' and status='queued' and campaign_id in ('pflege-starter-v2','pv-starter-v1') returning id) select count(*)::text n from affected",
  );
  const creds=await loadMailboxCredentials();
  const oldState=(await readStateFields(["mailboxes"]))?.payload as {mailboxes?:Array<{email?:string;enabled?:boolean}>}|undefined;
  const enabledByEmail=new Map((oldState?.mailboxes||[]).map(m=>[m.email?.toLowerCase(),m.enabled!==false]));
  const mailboxes=creds.filter(c=>c.provider==="smtp"&&enabledByEmail.get(c.email?.toLowerCase())!==false);
  const result:Record<Segment,{already:number;prepared:number;queued:number;rejected:number;scanned:number;reason?:string}>={
    pflege:{already:0,prepared:0,queued:0,rejected:0,scanned:0},
    pv:{already:0,prepared:0,queued:0,rejected:0,scanned:0},
  };
  for(const segment of ["pflege","pv"] as const) {
    const id=LOOM_CAMPAIGNS[segment];
    const [count]=await query<{n:string}>(`select count(distinct lead_id)::text n from er_outbox where workspace='default' and campaign_id=$1 and (created_at at time zone 'Europe/Berlin')::date=(now() at time zone 'Europe/Berlin')::date`,[id]);
    const already=Number(count?.n||0);
    result[segment].already=already;
    const remaining=Math.max(0,MAX_PER_SEGMENT-already);
    if(!remaining){result[segment].reason="target_reached";continue;}
    if(!VIDEO_IDS[segment]){result[segment].reason="video_missing";continue;}
    if(!mailboxes.length){result[segment].reason="mailboxes_unavailable";continue;}
    const pool=await candidatePool(segment,Math.min(650,Math.max(remaining*3,remaining)));
    // Rank by lead priority after distinct-email selection.
    pool.sort((a,b)=>b.priority_score-a.priority_score);
    result[segment].scanned=pool.length;
    for(const lead of pool) {
      if(result[segment].prepared>=remaining)break;
      if(segment==="pv"&&PV_CAREER_RECIPIENT.test(lead.email)){result[segment].rejected++;continue;}
      // Drafting a personalized video message is not permission to send it.
      // Only records explicitly cleared by the compliance engine enter the actual queue.
      let allowed=false;
      try { allowed=(await evaluateEmailSendCompliance(lead.id,lead.email)).decision.allowed; }
      catch { allowed=false; }
      const mailbox=mailboxes[(already+result[segment].prepared)%mailboxes.length];
      const body=emailBody(segment,lead.company,lead.contact);
      const subject=`Persönliche Videonachricht für ${lead.company}`.slice(0,125);
      await query(
        `insert into er_outbox(id,workspace,campaign_id,lead_id,mailbox_id,recipient,subject,body,variant,status,scheduled_at)
         values(gen_random_uuid(),'default',$1,$2,$3,$4,$5,$6,'V',$7,greatest(now(),$8::timestamptz))`,
        [id,lead.id,mailbox.id,lead.email,subject,body,allowed?"queued":"draft","2026-10-28T08:30:00+01:00"],
      );
      result[segment].prepared++;
      if(allowed)result[segment].queued++;
    }
    result[segment].reason=result[segment].queued>0?"queued":result[segment].prepared>0?"drafts_prepared_awaiting_legal_permission":"no_screenshot_ready_unsent_recipients";
  }
  await writeCampaignDashboard({
    pflege:result.pflege.queued,
    pv:result.pv.queued,
  });
  const readiness=await diagnoseLoomReadiness().catch((err:unknown)=>({error:String(err instanceof Error?err.message:err)}));
  return {ok:true,oldSuppressed:Number(old?.n||0),maxPerSegment:MAX_PER_SEGMENT,campaigns:result,readiness};
}

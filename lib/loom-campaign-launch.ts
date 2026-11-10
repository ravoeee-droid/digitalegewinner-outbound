
import { query, readStateFields } from "@/lib/db";
import { leadSegmentSql } from "@/lib/lead-segment";
import { evaluateEmailSendCompliance } from "@/lib/outbound-compliance-runtime";
import { loadMailboxCredentials } from "@/lib/mailbox-credentials";
import { DG_MAILBOX_EMAILS } from "@/lib/dg-mailboxes";
import { VIDEO_IDS } from "@/lib/outreach-copy";
import { loomVisualReadySql } from "@/lib/lead-screenshot";

type Segment = "pflege" | "pv";
type Candidate = { id: string; email: string; company: string; contact: string; priority_score: number; has_screenshot: boolean };
type StateCampaign = {
  id: string; name: string; audience: string; status: "Entwurf" | "Aktiv" | "Pausiert";
  dailyLimit: number; steps: Array<{ waitDays: number; subject: string; body: string }>;
  sent: number; replies: number; positive: number; appointments: number;
};
const LEGACY = new Set(["pflege-starter-v2", "pv-starter-v1"]);
export const LOOM_CAMPAIGNS: Record<Segment,string> = { pflege: "pflege-loom-150-v1", pv: "pv-loom-150-v1" };
const MAX_PER_SEGMENT = 150;
const PV_CAREER_RECIPIENT = /^(bewerbung|bewerbungen|bewerber|karriere|jobs?|hr|personal|recruiting|career|careers|application|applications|stellen|ausbildung)[._-]?[a-z0-9]*@/i;
// Follow-up-Sequenz: Erstkontakt (Variante V), Nachfrage nach 3 Tagen (F1), Abschluss nach weiteren 4 Tagen (F2).
// Termine aus Kaltakquise entstehen überwiegend aus Nachfassmails; ohne Sequenz blieb es bei 0 Terminen.
// LOOM_FOLLOWUPS=off schaltet die Nachfassmails ab.
const FOLLOWUP_STEPS:Array<{variant:"F1"|"F2";afterVariant:"V"|"F1";afterDays:number}>=[
  {variant:"F1",afterVariant:"V",afterDays:3},
  {variant:"F2",afterVariant:"F1",afterDays:4},
];
const MAX_FOLLOWUPS_PER_RUN=150;
const COPY_VERSION="dg-loom-copy-2026-11-10";

function greetingFor(contact:string){
  const cleaned = String(contact||"").trim().replace(/\s+/g," ");
  return /^(?:[A-ZÄÖÜ][a-zäöüß]+(?:[ -][A-ZÄÖÜ][a-zäöüß]+){1,2})$/.test(cleaned)
    ? `Guten Tag ${cleaned},`
    : "Guten Tag,";
}
function signatureFor(segment:Segment){
  const sectorLink = segment==="pflege" ? "https://digitalegewinner.de/pflege" : "{{pv_link}}";
  return "Beste Grüße\nRaphael Hermann\nDigitale Gewinner\n"+sectorLink;
}
const TOPIC:Record<Segment,string>={pflege:"die Bewerbergewinnung",pv:"eigene PV-Anfragen"};
export function emailSubject(segment:Segment, company:string){
  const base = segment==="pflege"
    ? `Eine Idee für die Bewerbergewinnung bei ${company}`
    : `Eine Idee für eigene PV-Anfragen bei ${company}`;
  return base.slice(0,125);
}
// Erstkontakt: Nutzen zuerst, dann das Video, dann eine Antwort-Aufforderung ("Ja"/"Nein") statt nur Kalenderlink.
// Keine Behauptungen über den konkreten Betrieb; der Website-Bezug nur, wenn ein Screenshot existiert.
export function emailBody(segment:Segment, company:string, contact:string, withScreenshot=true) {
  const site = withScreenshot ? " – gezeigt direkt an Ihrer eigenen Website" : "";
  const intro = segment==="pflege"
    ? `ich habe für ${company} eine kurze Videonachricht vorbereitet. Darin zeige ich, wie Pflegebetriebe wieder regelmäßig passende Bewerbungen bekommen, ohne dauerhaft von Stellenportalen und Vermittlern abhängig zu sein${site}.`
    : `ich habe für ${company} eine kurze Videonachricht vorbereitet. Darin geht es darum, wie PV-Betriebe eigene regionale Projektanfragen gewinnen, statt Kontakte über Leadportale einzukaufen${site}.`;
  return [
    greetingFor(contact),
    intro,
    "{{video_link}}",
    "Wenn das Thema bei Ihnen gerade aktuell ist, reicht eine kurze Antwort mit „Ja“. Dann schicke ich Ihnen zwei konkrete Terminvorschläge für ein 15-minütiges Gespräch. Falls nicht, genügt ein kurzes „Nein“ und ich melde mich nicht mehr.",
    signatureFor(segment),
  ].join("\n\n");
}
export function followUpBody(segment:Segment, company:string, contact:string, step:"F1"|"F2") {
  if(step==="F1"){
    return [
      greetingFor(contact),
      `kurze Nachfrage zu meiner letzten Nachricht. Hier ist noch einmal die Videonachricht für ${company}:`,
      "{{video_link}}",
      `Mich interessiert ehrlich, ob ${TOPIC[segment]} für Sie gerade eine Rolle spielt. Ein kurzes „Ja“ oder „Nein“ als Antwort reicht völlig – bei „Ja“ schicke ich zwei Terminvorschläge für 15 Minuten.`,
      signatureFor(segment),
    ].join("\n\n");
  }
  return [
    greetingFor(contact),
    `ich möchte Sie nicht weiter stören, deshalb ist das meine letzte Nachricht zu dem Thema. Falls ${TOPIC[segment]} später wieder aktuell wird: Die Videonachricht für ${company} bleibt unter diesem Link erreichbar.`,
    "{{video_link}}",
    "Ein kurzes „später“ oder „kein Bedarf“ genügt, dann richte ich mich danach.",
    signatureFor(segment),
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
    steps:[
      { waitDays:0, subject:emailSubject(segment,"{{company}}"), body: emailBody(segment,"{{company}}","") },
      { waitDays:3, subject:"Re: "+emailSubject(segment,"{{company}}"), body: followUpBody(segment,"{{company}}","","F1") },
      { waitDays:7, subject:"Re: "+emailSubject(segment,"{{company}}"), body: followUpBody(segment,"{{company}}","","F2") },
    ],
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
         exists(select 1 from lead_screenshots sc where sc.lead_id=l.id::text and sc.status='ok') has_screenshot,
         row_number() over (partition by l.company_id order by l.priority_score desc nulls last,l.updated_at desc,l.id) company_rank,
         row_number() over (partition by lower(trim(ct.email)) order by l.priority_score desc nulls last,l.updated_at desc,l.id) recipient_rank
       from sales_leads l
       join sales_companies c on c.id=l.company_id and c.workspace=l.workspace
       join sales_contacts ct on ct.id=l.contact_id and ct.workspace=l.workspace
       where l.workspace='default' and l.status='active'
         and ${loomVisualReadySql("l.id::text")}
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
     select id,email,company,contact,priority_score,has_screenshot from ranked
     where company_rank=1 and recipient_rank=1
     order by has_screenshot desc,priority_score desc,id
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
      loomVisualReadySql("l.id::text") + " as screenshot",
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


// A verified permission may arrive days after a personalized Loom draft was created.
// Check the complete backlog, not just today's drafts. The database update remains
// idempotent, and the full compliance/suppression checks must still pass before queuing.
// Never infer consent from CRM membership or campaign approval.
async function promoteVerifiedLoomDrafts() {
  const promoted:Record<Segment,number>={pflege:0,pv:0};
  const rows=await query<{id:string;lead_id:string;recipient:string;campaign_id:string}>(
    `select o.id::text id,o.lead_id,o.recipient,o.campaign_id
     from er_outbox o
     join sales_leads l on l.workspace=o.workspace and l.id=o.lead_id
     join sales_contacts ct on ct.workspace=l.workspace and ct.id=l.contact_id
     where o.workspace='default'
       and o.status='draft'
       and o.campaign_id in ('pflege-loom-150-v1','pv-loom-150-v1')
       and l.status='active' and l.stage in ('Neu','Research','Bereit')
       and coalesce(l.do_not_contact,false)=false
       and lower(trim(ct.email))=lower(trim(o.recipient))
       and exists(select 1 from outbound_contact_permissions p
         where p.workspace=o.workspace and p.channel='email'
           and p.status='verified' and p.revoked_at is null
           and (p.contact_id=l.contact_id or p.company_id=l.company_id)
           and (p.valid_from is null or p.valid_from<=now())
           and (p.valid_until is null or p.valid_until>=now()))
       and not exists(select 1 from er_suppressions s
         where s.workspace=o.workspace and lower(s.email)=lower(o.recipient))
       and not exists(select 1 from outbound_compliance_suppressions s
         where s.workspace=o.workspace and s.channel='email'
           and s.status='active' and lower(s.identifier)=lower(o.recipient))
       and not exists(select 1 from er_outbox prior
         where prior.workspace=o.workspace and prior.id<>o.id
           and (prior.lead_id=o.lead_id or lower(prior.recipient)=lower(o.recipient))
           and prior.status in ('sent','queued','sending'))
       and not exists(select 1 from er_events e
         where e.workspace=o.workspace and e.lead_id=o.lead_id
           and e.type in ('reply','positive_reply','appointment','bounce'))
       and ${loomVisualReadySql("o.lead_id")}
     order by o.created_at
     limit 300`,
  );
  for(const row of rows){
    const segment:Segment=row.campaign_id===LOOM_CAMPAIGNS.pv?"pv":"pflege";
    if(segment==="pv"&&PV_CAREER_RECIPIENT.test(row.recipient))continue;
    // Evaluate the full jurisdiction/basis policy immediately before queuing.
    const compliance=await evaluateEmailSendCompliance(row.lead_id,row.recipient).catch(()=>null);
    if(!compliance?.decision.allowed)continue;
    const updated=await query<{id:string}>(
      `update er_outbox o set status='queued',scheduled_at=greatest(o.scheduled_at,now()),error=null
       where o.id=$1::uuid and o.status='draft'
         and not exists(select 1 from er_outbox prior
           where prior.workspace=o.workspace and prior.id<>o.id
             and (prior.lead_id=o.lead_id or lower(prior.recipient)=lower(o.recipient))
             and prior.status in ('sent','queued','sending'))
         and not exists(select 1 from er_suppressions s
           where s.workspace=o.workspace and lower(s.email)=lower(o.recipient))
         and not exists(select 1 from outbound_compliance_suppressions s
           where s.workspace=o.workspace and s.channel='email'
             and s.status='active' and lower(s.identifier)=lower(o.recipient))
       returning o.id::text id`,
      [row.id],
    );
    if(updated.length)promoted[segment]++;
  }
  return promoted;
}

export async function ensureLoomCampaigns() {
  // Old sequences must not survive the switch.
  const [old] = await query<{n:string}>(
    "with affected as (update er_outbox set status='suppressed',error='Alte Kampagne durch Loom ersetzt' where workspace='default' and status='queued' and campaign_id in ('pflege-starter-v2','pv-starter-v1') returning id) select count(*)::text n from affected",
  );
  const creds=await loadMailboxCredentials();
  const oldState=(await readStateFields(["mailboxes"]))?.payload as {mailboxes?:Array<{email?:string;enabled?:boolean}>}|undefined;
  const enabledByEmail=new Map((oldState?.mailboxes||[]).map(m=>[m.email?.toLowerCase(),m.enabled!==false]));
  // DE-Outreach geht ausschließlich über die deutschen DG-Postfächer; andere (z. B. US-)Postfächer sind ausgeschlossen.
  const dgEmails=new Set<string>(DG_MAILBOX_EMAILS);
  const mailboxes=creds.filter(c=>c.provider==="smtp"&&dgEmails.has(c.email?.toLowerCase())&&enabledByEmail.get(c.email?.toLowerCase())!==false);
  const result:Record<Segment,{already:number;prepared:number;queued:number;rejected:number;scanned:number;reason?:string}>={
    pflege:{already:0,prepared:0,queued:0,rejected:0,scanned:0},
    pv:{already:0,prepared:0,queued:0,rejected:0,scanned:0},
  };
  for(const segment of ["pflege","pv"] as const) {
    const id=LOOM_CAMPAIGNS[segment];
    // Nur Erstkontakte (Variante V) zählen gegen die 150 neuen Betriebe je Segment; Nachfassmails nicht.
    const [count]=await query<{n:string}>(`select count(distinct lead_id)::text n from er_outbox where workspace='default' and campaign_id=$1 and variant='V' and ((created_at at time zone 'Europe/Berlin')::date=(now() at time zone 'Europe/Berlin')::date or (scheduled_at at time zone 'Europe/Berlin')::date=(now() at time zone 'Europe/Berlin')::date)`,[id]);
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
      const body=emailBody(segment,lead.company,lead.contact,lead.has_screenshot);
      const subject=emailSubject(segment,lead.company);
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
  // A legal permission can be reviewed after initial draft creation.
  // Promote only those drafts that independently pass the send-policy gate.
  const promoted=mailboxes.length?await promoteVerifiedLoomDrafts():{pflege:0,pv:0};
  for(const segment of ["pflege","pv"] as const){
    if(promoted[segment]){
      result[segment].queued+=promoted[segment];
      result[segment].reason="verified_drafts_queued";
    }
  }
  // Noch nicht versendete Erstkontakte auf die aktuelle Textfassung heben (Nutzen + Antwort-CTA).
  const refreshedCopy=await refreshPendingLoomCopy().catch(()=>0);
  // Nachfassmails für bereits angeschriebene Betriebe ohne Reaktion.
  const followUps=process.env.LOOM_FOLLOWUPS==="off"||!mailboxes.length?{F1:0,F2:0,skipped:0}:await queueLoomFollowUps().catch(()=>({F1:0,F2:0,skipped:0}));
  await writeCampaignDashboard({
    pflege:result.pflege.queued,
    pv:result.pv.queued,
  });
  const readiness=await diagnoseLoomReadiness().catch((err:unknown)=>({error:String(err instanceof Error?err.message:err)}));
  return {ok:true,oldSuppressed:Number(old?.n||0),maxPerSegment:MAX_PER_SEGMENT,campaigns:result,followUps,refreshedCopy,readiness};
}

// Noch nicht versendete Erstkontakte (queued/draft) bekommen die aktuelle Textfassung.
// Idempotent über eine Markierung im Fehlerfeld-freien Betreff: alte Betreffzeile -> neue Betreffzeile.
async function refreshPendingLoomCopy(){
  const rows=await query<{id:string;campaign_id:string;company:string;contact:string;has_screenshot:boolean}>(
    `select o.id::text id,o.campaign_id,c.name company,coalesce(ct.name,'') contact,
       exists(select 1 from lead_screenshots sc where sc.lead_id=o.lead_id and sc.status='ok') has_screenshot
     from er_outbox o
     join sales_leads l on l.workspace=o.workspace and l.id::text=o.lead_id
     join sales_companies c on c.id=l.company_id and c.workspace=l.workspace
     left join sales_contacts ct on ct.id=l.contact_id and ct.workspace=l.workspace
     where o.workspace='default' and o.status in ('queued','draft') and o.variant='V'
       and o.campaign_id in ('pflege-loom-150-v1','pv-loom-150-v1')
       and o.subject like 'Persönliche Videonachricht für %'
     limit 600`,
  );
  let updated=0;
  for(const row of rows){
    const segment:Segment=row.campaign_id===LOOM_CAMPAIGNS.pv?"pv":"pflege";
    const changed=await query<{id:string}>(
      `update er_outbox set subject=$2,body=$3 where id=$1::uuid and status in ('queued','draft') and variant='V' returning id::text id`,
      [row.id,emailSubject(segment,row.company),emailBody(segment,row.company,row.contact,row.has_screenshot)],
    );
    updated+=changed.length;
  }
  return updated;
}

// Nachfassmails: nur an Betriebe, die auf den vorherigen Schritt nicht reagiert haben
// (keine Antwort, kein Termin, kein Bounce, keine Abmeldung, keine Sperre), vom gleichen Postfach
// und im gleichen Betreff-Thread. Die Compliance-Prüfung läuft erneut vor dem Einreihen und noch einmal beim Versand.
async function queueLoomFollowUps(){
  const out={F1:0,F2:0,skipped:0};
  let budget=MAX_FOLLOWUPS_PER_RUN;
  for(const step of FOLLOWUP_STEPS){
    if(budget<=0)break;
    const rows=await query<{prev_id:string;lead_id:string;campaign_id:string;mailbox_id:string;recipient:string;subject:string;company:string;contact:string}>(
      `select p.id::text prev_id,p.lead_id,p.campaign_id,p.mailbox_id,p.recipient,p.subject,c.name company,coalesce(ct.name,'') contact
       from er_outbox p
       join sales_leads l on l.workspace=p.workspace and l.id::text=p.lead_id
       join sales_companies c on c.id=l.company_id and c.workspace=l.workspace
       join sales_contacts ct on ct.id=l.contact_id and ct.workspace=l.workspace
       where p.workspace='default' and p.status='sent' and p.variant=$1
         and p.campaign_id in ('pflege-loom-150-v1','pv-loom-150-v1')
         and p.sent_at<=now()-($2::int*interval '1 day')
         and p.sent_at>=now()-interval '30 days'
         and l.status='active' and coalesce(l.do_not_contact,false)=false
         and l.stage not in ('Gewonnen','Verloren','Engaged')
         and lower(trim(ct.email))=lower(trim(p.recipient))
         and not exists(select 1 from er_outbox n where n.workspace=p.workspace and n.lead_id=p.lead_id and n.variant=$3)
         and not exists(select 1 from er_outbox q where q.workspace=p.workspace
           and (q.lead_id=p.lead_id or lower(q.recipient)=lower(p.recipient)) and q.status in ('queued','sending','draft'))
         and not exists(select 1 from er_events e where e.workspace=p.workspace and e.lead_id=p.lead_id
           and e.type in ('reply','positive_reply','appointment','appointment_attended','bounce','unsubscribed','reply_classified'))
         and not exists(select 1 from er_suppressions s where s.workspace=p.workspace and lower(s.email)=lower(p.recipient))
         and not exists(select 1 from outbound_compliance_suppressions s where s.workspace=p.workspace and s.channel='email'
           and s.status='active' and lower(s.identifier)=lower(p.recipient))
       order by p.sent_at asc
       limit $4`,
      [step.afterVariant,step.afterDays,step.variant,budget],
    );
    for(const row of rows){
      const segment:Segment=row.campaign_id===LOOM_CAMPAIGNS.pv?"pv":"pflege";
      const compliance=await evaluateEmailSendCompliance(row.lead_id,row.recipient).catch(()=>null);
      if(!compliance?.decision.allowed){out.skipped++;continue;}
      const subject=(row.subject.startsWith("Re: ")?row.subject:`Re: ${row.subject}`).slice(0,125);
      const inserted=await query<{id:string}>(
        `insert into er_outbox(id,workspace,campaign_id,lead_id,mailbox_id,recipient,subject,body,variant,status,scheduled_at)
         select gen_random_uuid(),'default',$1,$2,$3,$4,$5,$6,$7,'queued',now()
         where not exists(select 1 from er_outbox n where n.workspace='default' and n.lead_id=$2 and n.variant=$7)
         returning id::text id`,
        [row.campaign_id,row.lead_id,row.mailbox_id,row.recipient,subject,followUpBody(segment,row.company,row.contact,step.variant),step.variant],
      );
      if(inserted.length){out[step.variant]++;budget--;}
    }
  }
  return out;
}

export const LOOM_COPY_VERSION=COPY_VERSION;

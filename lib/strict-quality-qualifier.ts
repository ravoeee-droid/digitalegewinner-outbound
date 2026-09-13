import { query } from "./db";
import { enrichPublicContact, type ContactEnrichment } from "./contact-enrichment";
import { inspectJobGrowth, type JobGrowthSignal } from "./job-intelligence";
import { scoreResearch } from "./sales-os";
import { runWebsiteAudit, type WebsiteAuditResult } from "./website-audit";

const QUALITY_FRESH_DAYS = 7;
const QUALIFICATION_VERSION = 3;

const HARD_ICP_SQL = `lower(c.name||' '||coalesce(c.industry,'')) ~ '(pflegedienst|ambulant|ambulatory_care|sozialstation|diakoniestation|häuslich|haeuslich|krankenpflege|intensivpflege|pflegeteam|home care|home health)'
  and lower(c.name) !~ '(pflegeheim|altenheim|seniorenheim|seniorenzentrum|seniorenresidenz|pflegezentrum|wohn-? und pflege|wohnpark|tagespflege|hospiz|krankenhaus|klinik|psychiatr|recrut|recruit|zeitarbeit|personaldienst|personalservice|arbeitnehmerüberlass|arbeitnehmerueberlass|arbeitsvermittlung|personalvermittlung|staffing|fußpflege|fusspflege|textilpflege|fahrzeugpflege|kosmetik|sanitätshaus|sanitaetshaus)'`;

type CandidateRow = {
  lead_id: string;
  company_id: string;
  company: string;
  city: string;
  industry: string;
  website: string;
  phone: string;
  source_id: string;
  metadata: Record<string, unknown>;
  stage: string;
  intent_score: number;
};

type StrictQualification = {
  version: number;
  checkedAt: string;
  tier: "A+" | "A" | "B" | "C";
  callReady: boolean;
  websiteWeak: boolean;
  websiteReason: string[];
  jobGrowth: JobGrowthSignal;
  websiteScores: Record<string, number>;
  priorityScore: number;
  opportunityScore: number;
  intentScore: number;
  reasons: string[];
  icpHardVerified: boolean;
  qualityGatePassed: boolean;
  qualityGateFailures: string[];
};

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeWebsite(value = "") {
  const raw = value.trim();
  if (!raw) return "";
  try { return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).toString(); } catch { return ""; }
}

function domainFromWebsite(value = "") {
  try { return new URL(normalizeWebsite(value)).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

function seededJobGrowth(metadata: Record<string, unknown>): JobGrowthSignal | null {
  const raw = metadata?.job_growth_seed;
  if (!raw || typeof raw !== "object") return null;
  const seed = raw as Partial<JobGrowthSignal>;
  const checked = Date.parse(String(seed.checkedAt || ""));
  if (!Number.isFinite(checked) || Date.now() - checked > QUALITY_FRESH_DAYS * 86_400_000) return null;
  if (!Number(seed.relevantOpenJobs || 0)) return null;
  return seed as JobGrowthSignal;
}

function websiteWeakness(audit: WebsiteAuditResult | undefined, contact: Partial<ContactEnrichment>) {
  const reasons: string[] = [];
  if (!audit) return { weak: false, reasons: ["Website-Audit nicht bestätigt"] };
  if (Number(audit.scores.overall || 0) < 72) reasons.push(`Website ${Math.round(Number(audit.scores.overall || 0))}/100`);
  if (Number(audit.scores.conversion || 0) < 68) reasons.push(`Conversion ${Math.round(Number(audit.scores.conversion || 0))}/100`);
  if (Number(audit.scores.trust || 0) < 65) reasons.push(`Trust ${Math.round(Number(audit.scores.trust || 0))}/100`);
  if (!contact.careersPage) reasons.push("kein klarer Karrierebereich");
  if (!contact.jobsPage) reasons.push("keine direkte Bewerbungsseite");
  return { weak: reasons.length > 0, reasons };
}

async function candidates(limit: number) {
  const rows = await query<CandidateRow>(`
    with ranked as (
      select
        l.id lead_id,c.id company_id,c.name company,c.city,c.industry,c.website,
        coalesce(ct.phone,c.phone,'') phone,c.source_id,coalesce(c.metadata,'{}'::jsonb) metadata,
        l.stage,l.intent_score,
        row_number() over (
          partition by coalesce(nullif(lower(c.domain),''),lower(c.name)||'|'||lower(c.city))
          order by case when c.metadata->'job_growth_seed' is not null then 0 else 1 end,
                   case when coalesce(ct.phone,c.phone,'')<>'' then 0 else 1 end,
                   l.intent_score desc,c.updated_at asc
        ) rn
      from sales_companies c
      join sales_leads l on l.company_id=c.id and l.workspace=c.workspace and l.status='active'
      left join sales_contacts ct on ct.id=l.contact_id
      where c.workspace='default'
        and ${HARD_ICP_SQL}
        and l.last_contact_at is null
        and l.stage in ('Neu','Research','Bereit')
        and not l.do_not_contact
        and l.phone_status<>'invalid'
        and coalesce(c.website,'')<>''
        and (
          c.metadata->'daily_qualification' is null
          or coalesce(c.metadata->'daily_qualification'->>'checkedAt','')=''
          or (c.metadata->'daily_qualification'->>'checkedAt')::timestamptz < now() - interval '${QUALITY_FRESH_DAYS} days'
          or coalesce(nullif(c.metadata->'daily_qualification'->>'version','')::int,0) < ${QUALIFICATION_VERSION}
        )
    )
    select lead_id,company_id,company,city,industry,website,phone,source_id,metadata,stage,intent_score
    from ranked
    where rn=1
    order by case when metadata->'job_growth_seed' is not null then 0 else 1 end,
             case when phone<>'' then 0 else 1 end,
             intent_score desc
    limit $1
  `, [Math.max(1, Math.min(20, limit))]);
  return rows;
}

async function persistContact(row: CandidateRow, contact: Partial<ContactEnrichment>, phone: string) {
  if (!(phone || contact.email)) return;
  const existing = await query<{ id: string }>(
    `select id from sales_contacts where workspace='default' and company_id=$1 order by is_primary desc,updated_at desc limit 1`,
    [row.company_id],
  );
  const contactId = existing[0]?.id || crypto.randomUUID();
  await query(
    `insert into sales_contacts(id,workspace,company_id,name,email,phone,linkedin,instagram,is_primary,source,metadata)
     values($1,'default',$2,'',$3,$4,$5,$6,true,'strict-quality-qualifier',$7::jsonb)
     on conflict(id) do update set
       email=case when excluded.email<>'' then excluded.email else sales_contacts.email end,
       phone=case when excluded.phone<>'' then excluded.phone else sales_contacts.phone end,
       linkedin=case when excluded.linkedin<>'' then excluded.linkedin else sales_contacts.linkedin end,
       instagram=case when excluded.instagram<>'' then excluded.instagram else sales_contacts.instagram end,
       is_primary=true,updated_at=now()`,
    [contactId,row.company_id,contact.email || "",phone,contact.linkedin || "",contact.instagram || "",JSON.stringify({ careersPage: contact.careersPage || "",jobsPage: contact.jobsPage || "",atsProviders: contact.atsProviders || [] })],
  );
  await query(`update sales_leads set contact_id=$2 where id=$1 and workspace='default'`, [row.lead_id, contactId]);
}

async function qualify(row: CandidateRow) {
  const website = normalizeWebsite(row.website);
  let contact: Partial<ContactEnrichment> = {};
  let audit: WebsiteAuditResult | undefined;
  const seeded = seededJobGrowth(row.metadata);
  const [contactResult,auditResult,jobResult] = await Promise.allSettled([
    enrichPublicContact(website),
    runWebsiteAudit(website,row.company),
    seeded ? Promise.resolve(seeded) : inspectJobGrowth(row.company,row.city),
  ]);
  if (contactResult.status === "fulfilled") contact = contactResult.value;
  if (auditResult.status === "fulfilled") audit = auditResult.value;
  const jobGrowth = jobResult.status === "fulfilled" ? jobResult.value : {
    source: "arbeitsagentur-jobsuche",checkedAt:new Date().toISOString(),openJobs:0,relevantOpenJobs:0,
    externalPortalJobs:0,externalPortals:[],latestPublishedAt:"",roles:[],growthScore:0,confidence:"low",warning:"Jobsignal fehlgeschlagen",
  } as JobGrowthSignal;

  const phone = contact.phone || row.phone || "";
  const candidate = { id: row.source_id || row.company_id,company:row.company,phone,website,city:row.city,industry:row.industry || "Ambulanter Pflegedienst",source:"strict-quality-qualifier" };
  const base = scoreResearch(candidate,contact,audit);
  const weakness = websiteWeakness(audit,contact);
  const recruitingGap = (audit && !contact.careersPage ? 8 : 0) + (audit && !contact.jobsPage ? 7 : 0) + (audit && !(contact.atsProviders?.length) ? 4 : 0);
  const opportunityScore = clamp(base.scores.opportunityScore + recruitingGap);
  const intentScore = Math.max(Number(row.intent_score || 0),jobGrowth.growthScore);
  const priorityScore = clamp(opportunityScore * 0.4 + base.scores.fitScore * 0.2 + base.scores.contactScore * 0.15 + intentScore * 0.25);
  const callReady = Boolean(phone);
  const failures = [
    ...(!website ? ["keine erreichbare Website"] : []),
    ...(!callReady ? ["keine Telefonnummer"] : []),
    ...(!weakness.weak ? ["Website-Schwäche nicht belegt"] : []),
    ...(jobGrowth.relevantOpenJobs < 1 ? ["keine aktuelle Pflege-Stelle bestätigt"] : []),
    ...(jobGrowth.confidence === "low" ? ["Jobsignal zu unsicher"] : []),
    ...(priorityScore < 72 ? [`Priority nur ${priorityScore}/100`] : []),
  ];
  const qualityGatePassed = failures.length === 0;

  let tier: StrictQualification["tier"] = "C";
  if (qualityGatePassed) tier = "A+";
  else if (callReady && jobGrowth.relevantOpenJobs >= 1 && priorityScore >= 62) tier = "A";
  else if (callReady && weakness.weak) tier = "B";

  const reasons = [
    ...(callReady ? ["Telefon direkt verfügbar"] : []),
    ...weakness.reasons,
    ...(jobGrowth.relevantOpenJobs ? [`${jobGrowth.relevantOpenJobs} aktuelle Pflege-Stelle${jobGrowth.relevantOpenJobs === 1 ? "" : "n"}`] : []),
    ...(jobGrowth.externalPortals.length ? [`Extern: ${jobGrowth.externalPortals.join(", ")}`] : []),
  ];
  const qualification: StrictQualification = {
    version:QUALIFICATION_VERSION,checkedAt:new Date().toISOString(),tier,callReady,websiteWeak:weakness.weak,
    websiteReason:weakness.reasons,jobGrowth,
    websiteScores:audit?.scores ? Object.fromEntries(Object.entries(audit.scores).map(([key,value]) => [key,Number(value || 0)])) : {},
    priorityScore,opportunityScore,intentScore,reasons,icpHardVerified:true,qualityGatePassed,qualityGateFailures:failures,
  };

  await query(
    `update sales_companies set domain=$2,website=$3,phone=case when $4<>'' then $4 else phone end,
       research_status=case when $5 then 'complete' else research_status end,latest_score=$6,
       metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('daily_qualification',$7::jsonb,'pflege_icp_verified',true,'pflege_icp_hard_verified',true),updated_at=now()
     where id=$1 and workspace='default'`,
    [row.company_id,domainFromWebsite(website),website,phone,Boolean(audit),priorityScore,JSON.stringify(qualification)],
  );
  await persistContact(row,contact,phone);

  const nextStage = tier === "A+" || tier === "A" ? "Bereit" : row.stage;
  await query(
    `update sales_leads set stage=$2,intent_score=$3,fit_score=$4,opportunity_score=$5,priority_score=$6,
       next_action=case when $7='A+' then 'Quality Lead anrufen' when $7='A' and coalesce(next_action,'')='' then 'A Lead prüfen/anrufen' else next_action end,updated_at=now()
     where id=$1 and workspace='default'`,
    [row.lead_id,nextStage,intentScore,base.scores.fitScore,opportunityScore,priorityScore,tier],
  );
  await query(
    `insert into sales_activities(workspace,lead_id,company_id,type,summary,meta)
     values('default',$1,$2,'quality_gate.v3',$3,$4::jsonb)`,
    [row.lead_id,row.company_id,`${tier} · ${row.company} · Priority ${priorityScore} · ${jobGrowth.relevantOpenJobs} offene Pflege-Stellen`,JSON.stringify({ tier,qualityGatePassed,failures,reasons,qualification })],
  );
  return { leadId:row.lead_id,company:row.company,tier,qualityGatePassed,priorityScore,reasons,failures };
}

export async function runStrictQualityQualificationBatch(batchSize = 10) {
  const selected = await candidates(batchSize);
  const results = await Promise.allSettled(selected.map(qualify));
  const qualified = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const failed = results.flatMap((result) => result.status === "rejected" ? [result.reason instanceof Error ? result.reason.message : String(result.reason)] : []);
  return {
    selected: selected.length,
    passed: qualified.filter((item) => item.qualityGatePassed).length,
    rejected: qualified.filter((item) => !item.qualityGatePassed).length,
    qualified,
    failed,
  };
}

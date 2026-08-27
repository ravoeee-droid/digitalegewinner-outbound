import { query } from "./db";
import { discoverBusinesses, type DiscoveredBusiness } from "./business-discovery";
import { enrichPublicContact, type ContactEnrichment } from "./contact-enrichment";
import { coverageTasksForState, GERMANY_COVERAGE_STATES, normalizeGermanState } from "./germany-pflege-coverage";
import { inspectJobGrowth, type JobGrowthSignal } from "./job-intelligence";
import { ensureSalesOsSchema, scoreResearch } from "./sales-os";
import { runWebsiteAudit, type WebsiteAuditResult } from "./website-audit";

export const DAILY_CALL_TARGET = 120;
export const A_PLUS_BUFFER_TARGET = 160;
export const QUALIFICATION_FRESH_DAYS = 7;

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
  last_contact_at: string | null;
};

type Qualification = {
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
};

type DiscoveryTask = ReturnType<typeof coverageTasksForState>[number];

type FactoryStats = {
  target: number;
  bufferTarget: number;
  aPlusReady: number;
  aReady: number;
  qualifiedToday: number;
  untouchedPhoneReady: number;
  pendingQualification: number;
  deficit: number;
  status: "green" | "yellow" | "red";
};

function clamp(value: number) { return Math.max(0, Math.min(100, Math.round(value))); }
function normalizeWebsite(value = "") {
  const raw = value.trim();
  if (!raw) return "";
  try { return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).toString(); } catch { return raw; }
}
function domainFromWebsite(value = "") {
  try { return new URL(normalizeWebsite(value)).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}
function isPflegeCandidate(item: DiscoveredBusiness) {
  const value = `${item.company} ${item.industry}`.toLowerCase();
  const include = /(pflege|sozialstation|ambulant|intensiv|häuslich|haeuslich|home care|home health)/i.test(value);
  const exclude = /(pflegeheim|seniorenheim|seniorenresidenz|wohnpark|krankenhaus|klinik|apotheke|physio|arztpraxis|sanitätshaus|sanitaetshaus)/i.test(value);
  return include && !exclude;
}

async function ensureFactorySchema() {
  await ensureSalesOsSchema();
  await query(`
    create table if not exists sales_territory_scans (
      id bigserial primary key,
      workspace text not null,
      state text not null,
      state_code text not null default '',
      sector text not null,
      term text not null,
      query_key text not null,
      status text not null default 'pending',
      pages_scanned integer not null default 0,
      found_count integer not null default 0,
      last_page_token text not null default '',
      metadata jsonb not null default '{}'::jsonb,
      last_run_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create unique index if not exists sales_territory_scans_key_idx on sales_territory_scans(workspace,query_key);
  `);
}

export async function getLeadFactoryStats(): Promise<FactoryStats> {
  await ensureFactorySchema();
  const [row] = await query<{
    a_plus_ready: number;
    a_ready: number;
    qualified_today: number;
    untouched_phone_ready: number;
    pending_qualification: number;
  }>(`
    select
      count(*) filter(where
        c.metadata->'daily_qualification'->>'tier'='A+'
        and (c.metadata->'daily_qualification'->>'checkedAt')::timestamptz >= now() - interval '${QUALIFICATION_FRESH_DAYS} days'
        and l.last_contact_at is null and l.stage in ('Neu','Research','Bereit')
        and coalesce(ct.phone,c.phone,'')<>'' and not l.do_not_contact and l.phone_status<>'invalid'
      )::int a_plus_ready,
      count(*) filter(where
        c.metadata->'daily_qualification'->>'tier'='A'
        and (c.metadata->'daily_qualification'->>'checkedAt')::timestamptz >= now() - interval '${QUALIFICATION_FRESH_DAYS} days'
        and l.last_contact_at is null and l.stage in ('Neu','Research','Bereit')
      )::int a_ready,
      count(*) filter(where
        (c.metadata->'daily_qualification'->>'checkedAt')::timestamptz >= date_trunc('day',now())
      )::int qualified_today,
      count(*) filter(where
        l.last_contact_at is null and l.stage in ('Neu','Research','Bereit')
        and coalesce(ct.phone,c.phone,'')<>'' and not l.do_not_contact and l.phone_status<>'invalid'
      )::int untouched_phone_ready,
      count(*) filter(where
        l.last_contact_at is null and l.stage in ('Neu','Research','Bereit')
        and (
          c.metadata->'daily_qualification' is null
          or coalesce(c.metadata->'daily_qualification'->>'checkedAt','')=''
          or (c.metadata->'daily_qualification'->>'checkedAt')::timestamptz < now() - interval '${QUALIFICATION_FRESH_DAYS} days'
        )
      )::int pending_qualification
    from sales_companies c
    join sales_leads l on l.company_id=c.id and l.workspace=c.workspace and l.status='active'
    left join sales_contacts ct on ct.id=l.contact_id
    where c.workspace='default'
      and (c.source like 'pflege%' or lower(c.industry) like '%pflege%' or lower(c.name) like '%pflege%')
  `);
  const aPlusReady = Number(row?.a_plus_ready || 0);
  const deficit = Math.max(0, A_PLUS_BUFFER_TARGET - aPlusReady);
  return {
    target: DAILY_CALL_TARGET,
    bufferTarget: A_PLUS_BUFFER_TARGET,
    aPlusReady,
    aReady: Number(row?.a_ready || 0),
    qualifiedToday: Number(row?.qualified_today || 0),
    untouchedPhoneReady: Number(row?.untouched_phone_ready || 0),
    pendingQualification: Number(row?.pending_qualification || 0),
    deficit,
    status: aPlusReady >= DAILY_CALL_TARGET ? "green" : aPlusReady >= 70 ? "yellow" : "red",
  };
}

async function nextDiscoveryTask(): Promise<DiscoveryTask | null> {
  const rows = await query<{ query_key: string; status: string; last_run_at: string | null }>(
    `select query_key,status,last_run_at from sales_territory_scans where workspace='default'`,
  );
  const state = new Map(rows.map((row) => [row.query_key, row]));
  const tasks = GERMANY_COVERAGE_STATES.flatMap((item) => coverageTasksForState(item.name));
  const neverDone = tasks.find((task) => state.get(task.queryKey)?.status !== "complete");
  if (neverDone) return neverDone;
  const sorted = tasks
    .map((task) => ({ task, date: state.get(task.queryKey)?.last_run_at ? new Date(state.get(task.queryKey)!.last_run_at!).getTime() : 0 }))
    .sort((a, b) => a.date - b.date);
  return sorted[0]?.task || null;
}

async function persistDiscovered(task: DiscoveryTask, leads: DiscoveredBusiness[], source: string, warning: string) {
  const candidates = leads.filter(isPflegeCandidate).filter((item) => {
    const itemState = normalizeGermanState(item.state || "");
    return !itemState || itemState === task.state;
  });
  const deduped = [...new Map(candidates.map((item) => [item.id, item])).values()];
  if (deduped.length) {
    const payload = JSON.stringify(deduped.map((item) => ({ ...item, state: task.state, stateCode: task.code, sector: task.sector, query: task.query })));
    await query(
      `with input as (
         select * from jsonb_to_recordset($1::jsonb) as x(
           id text, company text, contact text, email text, phone text, website text, city text, address text, state text, "stateCode" text,
           "postalCode" text, industry text, lat double precision, lng double precision, rating double precision,
           "reviewCount" integer, "businessStatus" text, source text, sector text, query text
         )
       ), existing as (
         select distinct on (i.id) i.id source_input_id,c.id company_id
         from input i
         join sales_companies c on c.workspace='default' and (
           c.source_id=i.id or
           (i.website<>'' and c.website<>'' and lower(c.website)=lower(i.website)) or
           (lower(c.name)=lower(i.company) and lower(c.city)=lower(i.city))
         )
         order by i.id,c.updated_at desc
       ), updated as (
         update sales_companies c set
           website=case when i.website<>'' then i.website else c.website end,
           city=case when i.city<>'' then i.city else c.city end,
           phone=case when i.phone<>'' then i.phone else c.phone end,
           source_id=case when c.source_id='' then i.id else c.source_id end,
           metadata=coalesce(c.metadata,'{}'::jsonb) || jsonb_build_object(
             'state',i.state,'state_code',i."stateCode",'postal_code',i."postalCode",'address',i.address,
             'google_rating',i.rating,'google_reviews',i."reviewCount",'business_status',i."businessStatus",
             'discovery_source',i.source,'discovery_sector',i.sector,'discovery_query',i.query,'discovered_at',now()
           ),updated_at=now()
         from input i join existing e on e.source_input_id=i.id
         where c.id=e.company_id returning c.id
       ), inserted as (
         insert into sales_companies(id,workspace,name,domain,website,city,industry,phone,source,source_id,lat,lng,research_status,latest_score,metadata)
         select md5('company:default:'||i.id),'default',i.company,'',i.website,i.city,i.industry,i.phone,concat('pflege-',i.source),i.id,i.lat,i.lng,'pending',20,
           jsonb_build_object('state',i.state,'state_code',i."stateCode",'postal_code',i."postalCode",'address',i.address,
             'google_rating',i.rating,'google_reviews',i."reviewCount",'business_status',i."businessStatus",
             'discovery_source',i.source,'discovery_sector',i.sector,'discovery_query',i.query,'discovered_at',now())
         from input i where not exists(select 1 from existing e where e.source_input_id=i.id)
         on conflict do nothing returning id
       ), touched as (select id from updated union select id from inserted)
       insert into sales_leads(id,workspace,company_id,stage,status,deal_value,intent_score,fit_score,opportunity_score,priority_score,owner,notes)
       select md5('lead:default:'||c.id),'default',c.id,'Research','active',0,0,55,55,25,'','Daily Lead Factory · Discovery · Qualifizierung offen'
       from sales_companies c join touched t on t.id=c.id where c.workspace='default'
       on conflict(workspace,company_id) where status='active' do update set updated_at=now()`,
      [payload],
    );
  }
  await query(
    `insert into sales_territory_scans(workspace,state,state_code,sector,term,query_key,status,pages_scanned,found_count,last_page_token,metadata,last_run_at)
     values('default',$1,$2,$3,$4,$5,'complete',1,$6,'',$7::jsonb,now())
     on conflict(workspace,query_key) do update set status='complete',pages_scanned=sales_territory_scans.pages_scanned+1,
       found_count=sales_territory_scans.found_count+excluded.found_count,metadata=excluded.metadata,last_run_at=now(),updated_at=now()`,
    [task.state, task.code, task.sector, task.term, task.queryKey, deduped.length, JSON.stringify({ query: task.query, source, warning, factory: true })],
  );
  return deduped.length;
}

async function discoverNextBatch() {
  const task = await nextDiscoveryTask();
  if (!task) return { discovered: 0, task: "" };
  const result = await discoverBusinesses({ query: task.query, pageSize: 20, locationHint: `${task.sector}, ${task.state}` });
  const discovered = await persistDiscovered(task, result.leads, result.source, result.warning || "");
  return { discovered, task: `${task.sector} · ${task.term}` };
}

async function candidatesForQualification(limit: number) {
  return query<CandidateRow>(`
    select l.id lead_id,c.id company_id,c.name company,c.city,c.industry,c.website,
           coalesce(ct.phone,c.phone,'') phone,c.source_id,coalesce(c.metadata,'{}'::jsonb) metadata,
           l.stage,l.intent_score,l.last_contact_at
    from sales_companies c
    join sales_leads l on l.company_id=c.id and l.workspace=c.workspace and l.status='active'
    left join sales_contacts ct on ct.id=l.contact_id
    where c.workspace='default'
      and (c.source like 'pflege%' or lower(c.industry) like '%pflege%' or lower(c.name) like '%pflege%')
      and l.last_contact_at is null and l.stage in ('Neu','Research','Bereit')
      and not l.do_not_contact and l.phone_status<>'invalid'
      and (
        c.metadata->'daily_qualification' is null
        or coalesce(c.metadata->'daily_qualification'->>'checkedAt','')=''
        or (c.metadata->'daily_qualification'->>'checkedAt')::timestamptz < now() - interval '${QUALIFICATION_FRESH_DAYS} days'
      )
    order by case when coalesce(c.phone,'')<>'' then 0 else 1 end,c.updated_at asc
    limit $1
  `, [limit]);
}

function websiteWeakness(audit: WebsiteAuditResult | undefined, contact: Partial<ContactEnrichment>, website: string) {
  const reasons: string[] = [];
  if (!website) reasons.push("keine Website");
  if (audit && Number(audit.scores.overall || 0) < 72) reasons.push(`Website ${Math.round(Number(audit.scores.overall || 0))}/100`);
  if (audit && Number(audit.scores.conversion || 0) < 68) reasons.push(`Conversion ${Math.round(Number(audit.scores.conversion || 0))}/100`);
  if (audit && Number(audit.scores.trust || 0) < 65) reasons.push(`Trust ${Math.round(Number(audit.scores.trust || 0))}/100`);
  if (audit && !contact.careersPage) reasons.push("kein klarer Karrierebereich");
  if (audit && !contact.jobsPage) reasons.push("keine direkte Bewerbungsseite");
  return { weak: reasons.length > 0, reasons };
}

async function qualify(row: CandidateRow) {
  const website = normalizeWebsite(row.website || "");
  let contact: Partial<ContactEnrichment> = {};
  let audit: WebsiteAuditResult | undefined;
  const [contactResult, auditResult, jobResult] = await Promise.allSettled([
    website ? enrichPublicContact(website) : Promise.resolve({} as ContactEnrichment),
    website ? runWebsiteAudit(website, row.company) : Promise.resolve(undefined),
    inspectJobGrowth(row.company, row.city),
  ]);
  if (contactResult.status === "fulfilled") contact = contactResult.value;
  if (auditResult.status === "fulfilled") audit = auditResult.value;
  const jobGrowth = jobResult.status === "fulfilled" ? jobResult.value : await Promise.resolve({
    source: "arbeitsagentur-jobsuche", checkedAt: new Date().toISOString(), openJobs: 0, relevantOpenJobs: 0,
    externalPortalJobs: 0, externalPortals: [], latestPublishedAt: "", roles: [], growthScore: 0,
    confidence: "low", warning: "Jobsignal fehlgeschlagen",
  } as JobGrowthSignal);

  const phone = contact.phone || row.phone || "";
  const candidate = { id: row.source_id || row.company_id, company: row.company, phone, website, city: row.city, industry: row.industry || "Pflege", source: "daily-lead-factory" };
  const base = scoreResearch(candidate, contact, audit);
  const weakness = websiteWeakness(audit, contact, website);
  const recruitingGap = (audit && !contact.careersPage ? 8 : 0) + (audit && !contact.jobsPage ? 7 : 0) + (audit && !(contact.atsProviders?.length) ? 4 : 0);
  const opportunityScore = clamp(base.scores.opportunityScore + recruitingGap + (!website ? 10 : 0));
  const intentScore = Math.max(Number(row.intent_score || 0), jobGrowth.growthScore);
  const priorityScore = clamp(opportunityScore * 0.4 + base.scores.fitScore * 0.2 + base.scores.contactScore * 0.15 + intentScore * 0.25);
  const callReady = Boolean(phone);

  let tier: Qualification["tier"] = "C";
  if (callReady && weakness.weak && jobGrowth.relevantOpenJobs >= 1 && priorityScore >= 72) tier = "A+";
  else if (callReady && jobGrowth.relevantOpenJobs >= 1 && priorityScore >= 62) tier = "A";
  else if (callReady && weakness.weak) tier = "B";

  const reasons = [
    ...(callReady ? ["Telefon direkt verfügbar"] : []),
    ...weakness.reasons,
    ...(jobGrowth.relevantOpenJobs ? [`${jobGrowth.relevantOpenJobs} aktuelle Pflege-Stelle${jobGrowth.relevantOpenJobs === 1 ? "" : "n"}`] : []),
    ...(jobGrowth.externalPortals.length ? [`Extern: ${jobGrowth.externalPortals.join(", ")}`] : []),
  ];
  const qualification: Qualification = {
    version: 1,
    checkedAt: new Date().toISOString(),
    tier,
    callReady,
    websiteWeak: weakness.weak,
    websiteReason: weakness.reasons,
    jobGrowth,
    websiteScores: audit?.scores ? Object.fromEntries(Object.entries(audit.scores).map(([key, value]) => [key, Number(value || 0)])) : {},
    priorityScore,
    opportunityScore,
    intentScore,
    reasons,
  };

  const domain = domainFromWebsite(website);
  await query(
    `update sales_companies set domain=case when $2<>'' then $2 else domain end,
       website=case when $3<>'' then $3 else website end,
       phone=case when $4<>'' then $4 else phone end,
       research_status=case when $3<>'' then 'complete' else research_status end,
       latest_score=$5,
       metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object('daily_qualification',$6::jsonb),updated_at=now()
     where id=$1 and workspace='default'`,
    [row.company_id, domain, website, phone, priorityScore, JSON.stringify(qualification)],
  );

  if (phone || contact.email) {
    const existing = await query<{ id: string }>(`select id from sales_contacts where workspace='default' and company_id=$1 order by is_primary desc,updated_at desc limit 1`, [row.company_id]);
    const contactId = existing[0]?.id || crypto.randomUUID();
    await query(
      `insert into sales_contacts(id,workspace,company_id,name,email,phone,linkedin,instagram,is_primary,source,metadata)
       values($1,'default',$2,'',$3,$4,$5,$6,true,'daily-lead-factory',$7::jsonb)
       on conflict(id) do update set
         email=case when excluded.email<>'' then excluded.email else sales_contacts.email end,
         phone=case when excluded.phone<>'' then excluded.phone else sales_contacts.phone end,
         linkedin=case when excluded.linkedin<>'' then excluded.linkedin else sales_contacts.linkedin end,
         instagram=case when excluded.instagram<>'' then excluded.instagram else sales_contacts.instagram end,
         is_primary=true,updated_at=now()`,
      [contactId, row.company_id, contact.email || "", phone, contact.linkedin || "", contact.instagram || "", JSON.stringify({ careersPage: contact.careersPage || "", jobsPage: contact.jobsPage || "", atsProviders: contact.atsProviders || [] })],
    );
    await query(`update sales_leads set contact_id=$2 where id=$1 and workspace='default'`, [row.lead_id, contactId]);
  }

  const nextStage = tier === "A+" || tier === "A" ? "Bereit" : row.stage;
  await query(
    `update sales_leads set stage=$2,intent_score=$3,fit_score=$4,opportunity_score=$5,priority_score=$6,
       next_action=case when $7='A+' then 'A+ Lead anrufen' else next_action end,updated_at=now()
     where id=$1 and workspace='default'`,
    [row.lead_id, nextStage, intentScore, base.scores.fitScore, opportunityScore, priorityScore, tier],
  );
  await query(
    `insert into sales_activities(workspace,lead_id,company_id,type,summary,meta)
     values('default',$1,$2,'lead_factory.qualified',$3,$4::jsonb)`,
    [row.lead_id, row.company_id, `${tier} · ${row.company} · Priority ${priorityScore} · ${jobGrowth.relevantOpenJobs} offene Pflege-Stellen`, JSON.stringify({ tier, reasons, qualification })],
  );
  return { leadId: row.lead_id, company: row.company, tier, priorityScore, reasons };
}

export async function runLeadFactoryCycle(batchSize = 3) {
  await ensureFactorySchema();
  const before = await getLeadFactoryStats();
  if (before.aPlusReady >= A_PLUS_BUFFER_TARGET) return { ok: true, skipped: true, reason: "A+ Buffer voll", before, after: before, discovered: 0, qualified: [] };

  const pending = await candidatesForQualification(Math.max(1, Math.min(5, batchSize)));
  const shouldDiscover = pending.length < batchSize || before.untouchedPhoneReady < A_PLUS_BUFFER_TARGET * 2;
  const discoveryPromise = shouldDiscover
    ? discoverNextBatch()
        .then((value) => ({ ...value, error: "" }))
        .catch((error) => ({ discovered: 0, task: "", error: error instanceof Error ? error.message : "Discovery vorübergehend nicht verfügbar" }))
    : Promise.resolve({ discovered: 0, task: "", error: "" });

  const results = await Promise.allSettled(pending.map(qualify));
  const discovery = await discoveryPromise;
  const qualified = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const failed = results.filter((result) => result.status === "rejected").map((result) => result.reason instanceof Error ? result.reason.message : "Qualifizierung fehlgeschlagen");
  const after = await getLeadFactoryStats();
  return {
    ok: true,
    skipped: false,
    before,
    after,
    discovered: discovery.discovered,
    discoveryTask: discovery.task,
    discoveryError: discovery.error,
    qualified,
    failed,
  };
}

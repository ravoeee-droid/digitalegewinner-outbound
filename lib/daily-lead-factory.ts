import { query } from "./db";
import { discoverBusinesses, type DiscoveredBusiness } from "./business-discovery";
import { enrichPublicContact, type ContactEnrichment } from "./contact-enrichment";
import { GERMANY_COVERAGE_STATES } from "./germany-pflege-coverage";
import { companyNamesMatch, discoverHiringEmployers, inspectJobGrowth, type HiringEmployerSignal, type JobGrowthSignal } from "./job-intelligence";
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

type JobTask = { state: string; code: string; sector: string; queryKey: string };
type LeadBusiness = Omit<DiscoveredBusiness, "source"> & { source: string };
type ResolvedJobLead = { business: LeadBusiness; seed: HiringEmployerSignal };

const TARGET_NAME_SQL = `(c.metadata->>'pflege_icp_verified'='true' or lower(c.name) ~ '(pflegedienst|ambulant|sozialstation|diakoniestation|häuslich|haeuslich|krankenpflege|intensivpflege|pflegeteam|home care|home health)')
  and lower(c.name) !~ '(pflegeheim|altenheim|seniorenheim|seniorenzentrum|seniorenresidenz|pflegezentrum|wohn-? und pflege|wohnpark|tagespflege|hospiz|krankenhaus|klinik|fußpflege|fusspflege|textilpflege|fahrzeugpflege|kosmetik|sanitätshaus|sanitaetshaus)'`;

function clamp(value: number) { return Math.max(0, Math.min(100, Math.round(value))); }
function normalizeWebsite(value = "") {
  const raw = value.trim();
  if (!raw) return "";
  try { return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).toString(); } catch { return raw; }
}
function domainFromWebsite(value = "") {
  try { return new URL(normalizeWebsite(value)).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}
function isExcludedName(value = "") {
  return /(pflegeheim|altenheim|seniorenheim|seniorenzentrum|seniorenresidenz|pflegezentrum|wohn-? und pflege|wohnpark|tagespflege|hospiz|krankenhaus|klinik|fußpflege|fusspflege|textilpflege|fahrzeugpflege|kosmetik|sanitätshaus|sanitaetshaus|pflegestützpunkt|pflegestuetzpunkt)/i.test(value);
}
function isStrongAmbulatoryText(value = "") {
  return /(pflegedienst|ambulan(?:t|te|ter)|sozialstation|diakoniestation|häuslich|haeuslich|krankenpflege|intensivpflege|pflegeteam|home care|home health|home_care|ambulatory_care|outreach)/i.test(value) && !isExcludedName(value);
}
function isAmbulatoryBusiness(item: Pick<LeadBusiness, "company" | "industry">) {
  return isStrongAmbulatoryText(`${item.company} ${item.industry}`);
}
function isCandidateRowTarget(row: CandidateRow) {
  return row.metadata?.pflege_icp_verified === true || isStrongAmbulatoryText(`${row.company} ${row.industry}`);
}
function seededJobGrowth(metadata: Record<string, unknown>): JobGrowthSignal | null {
  const raw = metadata?.job_growth_seed;
  if (!raw || typeof raw !== "object") return null;
  const seed = raw as Partial<JobGrowthSignal>;
  const checked = Date.parse(String(seed.checkedAt || ""));
  if (!Number.isFinite(checked) || Date.now() - checked > QUALIFICATION_FRESH_DAYS * 86_400_000) return null;
  if (!Number(seed.relevantOpenJobs || 0)) return null;
  return seed as JobGrowthSignal;
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
    where c.workspace='default' and ${TARGET_NAME_SQL}
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

async function nextJobDiscoveryTask(): Promise<JobTask | null> {
  const rows = await query<{ query_key: string; last_run_at: string | null }>(
    `select query_key,last_run_at from sales_territory_scans where workspace='default' and query_key like 'job:%'`,
  );
  const state = new Map(rows.map((row) => [row.query_key, row]));
  const tasks: JobTask[] = GERMANY_COVERAGE_STATES.flatMap((item) => item.sectors.map((sector) => ({
    state: item.name,
    code: item.code,
    sector,
    queryKey: `job:${item.code}:${sector.toLowerCase()}`,
  })));
  const freshCutoff = Date.now() - 18 * 60 * 60_000;
  const neverOrStale = tasks.find((task) => {
    const row = state.get(task.queryKey);
    if (!row?.last_run_at) return true;
    const value = Date.parse(row.last_run_at);
    return !Number.isFinite(value) || value < freshCutoff;
  });
  if (neverOrStale) return neverOrStale;
  return tasks
    .map((task) => ({ task, date: Date.parse(state.get(task.queryKey)?.last_run_at || "") || 0 }))
    .sort((a, b) => a.date - b.date)[0]?.task || null;
}

async function markJobScan(task: JobTask, values: { found: number; rawJobs: number; relevantJobs: number; warning: string }) {
  await query(
    `insert into sales_territory_scans(workspace,state,state_code,sector,term,query_key,status,pages_scanned,found_count,last_page_token,metadata,last_run_at)
     values('default',$1,$2,$3,'Aktuelle Pflege-Stellen',$4,'complete',1,$5,'',$6::jsonb,now())
     on conflict(workspace,query_key) do update set status='complete',pages_scanned=sales_territory_scans.pages_scanned+1,
       found_count=sales_territory_scans.found_count+excluded.found_count,metadata=excluded.metadata,last_run_at=now(),updated_at=now()`,
    [task.state, task.code, task.sector, task.queryKey, values.found, JSON.stringify({ jobFirst: true, rawJobs: values.rawJobs, relevantJobs: values.relevantJobs, warning: values.warning })],
  );
}

function businessFromSeed(seed: HiringEmployerSignal, task: JobTask): LeadBusiness | null {
  if (!(seed.phone || seed.website)) return null;
  if (!(seed.ambulatoryEvidence || isStrongAmbulatoryText(seed.employer))) return null;
  return {
    id: `job:${seed.seedKey}`,
    company: seed.employer,
    contact: "",
    email: "",
    phone: seed.phone || "",
    website: seed.website || "",
    city: seed.city || task.sector,
    address: seed.address || "",
    state: seed.region || task.state,
    postalCode: "",
    industry: "Ambulanter Pflegedienst",
    rating: 0,
    reviewCount: 0,
    businessStatus: "",
    source: "arbeitsagentur-jobdetails+public-directory",
  };
}

async function resolveHiringEmployer(seed: HiringEmployerSignal, task: JobTask): Promise<ResolvedJobLead | null> {
  if (!seed.employer || isExcludedName(seed.employer)) return null;
  let match: LeadBusiness | null = businessFromSeed(seed, task);

  if (!match) {
    try {
      const result = await discoverBusinesses({
        query: `${seed.employer} ${seed.city || task.sector}`,
        pageSize: 12,
        locationHint: `${seed.city || task.sector}, ${task.state}`,
      });
      const candidates = result.leads
        .filter((item) => isAmbulatoryBusiness(item))
        .filter((item) => companyNamesMatch(seed.employer, item.company))
        .sort((a, b) => Number(Boolean(b.phone)) - Number(Boolean(a.phone)) || Number(Boolean(b.website)) - Number(Boolean(a.website)));
      if (candidates[0]) match = { ...candidates[0], source: candidates[0].source };
    } catch {}
  }

  if (!match && seed.website && (seed.ambulatoryEvidence || isStrongAmbulatoryText(seed.employer))) {
    match = {
      id: `job:${seed.seedKey}`,
      company: seed.employer,
      contact: "",
      email: "",
      phone: seed.phone || "",
      website: seed.website,
      city: seed.city || task.sector,
      address: seed.address,
      state: seed.region || task.state,
      postalCode: "",
      industry: "Ambulanter Pflegedienst",
      rating: 0,
      reviewCount: 0,
      businessStatus: "",
      source: "arbeitsagentur-jobdetails",
    };
  }
  if (!match) return null;
  if (seed.website && !match.website) match.website = seed.website;
  if (seed.phone && !match.phone) match.phone = seed.phone;
  if (seed.address && !match.address) match.address = seed.address;
  return { business: match, seed };
}

async function persistJobFirst(task: JobTask, leads: ResolvedJobLead[]) {
  let persisted = 0;
  for (const item of leads) {
    const business = item.business;
    if (!isAmbulatoryBusiness(business)) continue;
    const website = normalizeWebsite(business.website || item.seed.website || "");
    const domain = domainFromWebsite(website);
    const sourceId = business.id || `job:${item.seed.seedKey}`;
    const city = business.city || item.seed.city || task.sector;
    const metadata = {
      state: task.state,
      state_code: task.code,
      address: business.address || item.seed.address || "",
      discovery_source: business.source,
      discovery_sector: task.sector,
      discovered_at: new Date().toISOString(),
      pflege_icp_verified: true,
      job_first: true,
      job_growth_seed: item.seed.jobGrowth,
      job_seed_checked_at: item.seed.jobGrowth.checkedAt,
      job_seed_open_positions: item.seed.openPositions,
      job_seed_company_size: item.seed.companySize,
      job_seed_external_portals: item.seed.jobGrowth.externalPortals,
    };

    let existing = await query<{ id: string }>(
      `select id from sales_companies where workspace='default' and (
         source_id=$1 or ($2<>'' and domain=$2) or (lower(name)=lower($3) and lower(city)=lower($4))
       ) order by updated_at desc limit 1`,
      [sourceId, domain, business.company, city],
    );
    let companyId = existing[0]?.id || crypto.randomUUID();
    if (!existing.length) {
      const inserted = await query<{ id: string }>(
        `insert into sales_companies(id,workspace,name,domain,website,city,industry,phone,source,source_id,lat,lng,research_status,latest_score,metadata)
         values($1,'default',$2,$3,$4,$5,$6,$7,'pflege-job-first',$8,$9,$10,'pending',45,$11::jsonb)
         on conflict do nothing returning id`,
        [companyId, business.company, domain, website, city, business.industry || "Ambulanter Pflegedienst", business.phone || "", sourceId, business.lat ?? null, business.lng ?? null, JSON.stringify(metadata)],
      );
      if (!inserted.length) {
        existing = await query<{ id: string }>(
          `select id from sales_companies where workspace='default' and (($1<>'' and domain=$1) or (lower(name)=lower($2) and lower(city)=lower($3))) order by updated_at desc limit 1`,
          [domain, business.company, city],
        );
        if (!existing[0]) continue;
        companyId = existing[0].id;
      }
    }

    await query(
      `update sales_companies set
         website=case when $2<>'' then $2 else website end,
         domain=case when $3<>'' then $3 else domain end,
         phone=case when $4<>'' then $4 else phone end,
         city=case when $5<>'' then $5 else city end,
         industry=case when $6<>'' then $6 else industry end,
         source=case when source='manual' then 'pflege-job-first' else source end,
         source_id=case when source_id='' then $7 else source_id end,
         metadata=coalesce(metadata,'{}'::jsonb) || $8::jsonb,
         updated_at=now()
       where id=$1 and workspace='default'`,
      [companyId, website, domain, business.phone || "", city, business.industry || "Ambulanter Pflegedienst", sourceId, JSON.stringify(metadata)],
    );
    await query(
      `insert into sales_leads(id,workspace,company_id,stage,status,deal_value,intent_score,fit_score,opportunity_score,priority_score,owner,notes)
       values($1,'default',$2,'Research','active',0,$3,65,65,55,'','Job-first Lead · offene Pflege-Stelle bestätigt · Qualifizierung offen')
       on conflict(workspace,company_id) where status='active' do update set intent_score=greatest(sales_leads.intent_score,excluded.intent_score),updated_at=now()`,
      [crypto.randomUUID(), companyId, item.seed.jobGrowth.growthScore],
    );
    persisted++;
  }
  return persisted;
}

async function persistFallback(leads: DiscoveredBusiness[], task: JobTask) {
  const strict = leads.filter(isAmbulatoryBusiness);
  let persisted = 0;
  for (const business of strict) {
    const website = normalizeWebsite(business.website || "");
    const domain = domainFromWebsite(website);
    const city = business.city || task.sector;
    const metadata = {
      state: task.state,
      state_code: task.code,
      discovery_source: business.source,
      discovery_sector: task.sector,
      discovered_at: new Date().toISOString(),
      pflege_icp_verified: true,
      job_first: false,
    };
    const existing = await query<{ id: string }>(
      `select id from sales_companies where workspace='default' and (source_id=$1 or ($2<>'' and domain=$2) or (lower(name)=lower($3) and lower(city)=lower($4))) order by updated_at desc limit 1`,
      [business.id, domain, business.company, city],
    );
    const companyId = existing[0]?.id || crypto.randomUUID();
    if (!existing.length) {
      const inserted = await query<{ id: string }>(
        `insert into sales_companies(id,workspace,name,domain,website,city,industry,phone,source,source_id,lat,lng,research_status,latest_score,metadata)
         values($1,'default',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending',20,$12::jsonb) on conflict do nothing returning id`,
        [companyId, business.company, domain, website, city, business.industry || "Ambulanter Pflegedienst", business.phone || "", `pflege-${business.source}`, business.id, business.lat ?? null, business.lng ?? null, JSON.stringify(metadata)],
      );
      if (!inserted.length) continue;
    } else {
      await query(`update sales_companies set metadata=coalesce(metadata,'{}'::jsonb) || $2::jsonb,updated_at=now() where id=$1 and workspace='default'`, [companyId, JSON.stringify(metadata)]);
    }
    await query(
      `insert into sales_leads(id,workspace,company_id,stage,status,deal_value,intent_score,fit_score,opportunity_score,priority_score,owner,notes)
       values($1,'default',$2,'Research','active',0,0,55,55,25,'','Fallback Discovery · Stellenprüfung offen')
       on conflict(workspace,company_id) where status='active' do update set updated_at=now()`,
      [crypto.randomUUID(), companyId],
    );
    persisted++;
  }
  return persisted;
}

async function discoverNextBatch() {
  const task = await nextJobDiscoveryTask();
  if (!task) return { discovered: 0, jobSeeds: 0, task: "", warning: "Keine Discovery-Region verfügbar." };
  const jobs = await discoverHiringEmployers(task.sector, { days: 21, size: 100, radiusKm: 60 });
  const resolvedResults = await Promise.allSettled(jobs.employers.slice(0, 10).map((seed) => resolveHiringEmployer(seed, task)));
  const resolved = resolvedResults.flatMap((result) => result.status === "fulfilled" && result.value ? [result.value] : []);
  let discovered = await persistJobFirst(task, resolved);
  let fallbackWarning = "";

  if (discovered < 2) {
    try {
      const fallback = await discoverBusinesses({ query: `Ambulanter Pflegedienst ${task.sector}`, pageSize: 20, locationHint: `${task.sector}, ${task.state}` });
      discovered += await persistFallback(fallback.leads, task);
      fallbackWarning = fallback.warning || "";
    } catch (error) {
      fallbackWarning = error instanceof Error ? error.message : "Fallback Discovery fehlgeschlagen.";
    }
  }
  const warning = [jobs.warning, fallbackWarning].filter(Boolean).join(" · ");
  await markJobScan(task, { found: discovered, rawJobs: jobs.rawJobs, relevantJobs: jobs.relevantJobs, warning });
  return { discovered, jobSeeds: jobs.employers.length, task: `${task.sector} · Job-first`, warning };
}

async function candidatesForQualification(limit: number) {
  const rows = await query<CandidateRow>(`
    select l.id lead_id,c.id company_id,c.name company,c.city,c.industry,c.website,
           coalesce(ct.phone,c.phone,'') phone,c.source_id,coalesce(c.metadata,'{}'::jsonb) metadata,
           l.stage,l.intent_score,l.last_contact_at
    from sales_companies c
    join sales_leads l on l.company_id=c.id and l.workspace=c.workspace and l.status='active'
    left join sales_contacts ct on ct.id=l.contact_id
    where c.workspace='default'
      and l.last_contact_at is null and l.stage in ('Neu','Research','Bereit')
      and not l.do_not_contact and l.phone_status<>'invalid'
      and (
        c.metadata->'daily_qualification' is null
        or coalesce(c.metadata->'daily_qualification'->>'checkedAt','')=''
        or (c.metadata->'daily_qualification'->>'checkedAt')::timestamptz < now() - interval '${QUALIFICATION_FRESH_DAYS} days'
      )
    order by case when c.metadata->'job_growth_seed' is not null then 0 else 1 end,
             case when coalesce(c.phone,'')<>'' then 0 else 1 end,
             l.intent_score desc,c.updated_at asc
    limit $1
  `, [Math.max(limit * 5, 25)]);
  return rows.filter(isCandidateRowTarget).slice(0, limit);
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
  const seeded = seededJobGrowth(row.metadata);
  const [contactResult, auditResult, jobResult] = await Promise.allSettled([
    website ? enrichPublicContact(website) : Promise.resolve({} as ContactEnrichment),
    website ? runWebsiteAudit(website, row.company) : Promise.resolve(undefined),
    seeded ? Promise.resolve(seeded) : inspectJobGrowth(row.company, row.city),
  ]);
  if (contactResult.status === "fulfilled") contact = contactResult.value;
  if (auditResult.status === "fulfilled") audit = auditResult.value;
  const jobGrowth = jobResult.status === "fulfilled" ? jobResult.value : {
    source: "arbeitsagentur-jobsuche", checkedAt: new Date().toISOString(), openJobs: 0, relevantOpenJobs: 0,
    externalPortalJobs: 0, externalPortals: [], latestPublishedAt: "", roles: [], growthScore: 0,
    confidence: "low", warning: "Jobsignal fehlgeschlagen",
  } as JobGrowthSignal;

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
    version: 2,
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
       metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object('daily_qualification',$6::jsonb,'pflege_icp_verified',true),updated_at=now()
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
       next_action=case when $7='A+' then 'A+ Lead anrufen' when $7='A' and coalesce(next_action,'')='' then 'A Lead prüfen/anrufen' else next_action end,updated_at=now()
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

export async function runLeadFactoryCycle(batchSize = 5) {
  await ensureFactorySchema();
  const before = await getLeadFactoryStats();
  if (before.aPlusReady >= A_PLUS_BUFFER_TARGET) return { ok: true, skipped: true, reason: "A+ Buffer voll", before, after: before, discovered: 0, qualified: [] };

  const safeBatch = Math.max(1, Math.min(5, batchSize));
  const pending = await candidatesForQualification(safeBatch);
  const shouldDiscover = before.aPlusReady < A_PLUS_BUFFER_TARGET || pending.length < safeBatch;
  const discoveryPromise = shouldDiscover
    ? discoverNextBatch()
        .then((value) => ({ ...value, error: "" }))
        .catch((error) => ({ discovered: 0, jobSeeds: 0, task: "", warning: "", error: error instanceof Error ? error.message : "Discovery vorübergehend nicht verfügbar" }))
    : Promise.resolve({ discovered: 0, jobSeeds: 0, task: "", warning: "", error: "" });

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
    jobSeeds: discovery.jobSeeds,
    discoveryTask: discovery.task,
    discoveryWarning: discovery.warning,
    discoveryError: discovery.error,
    qualified,
    failed,
  };
}

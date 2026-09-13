import { query } from "./db";
import { discoverBusinesses, type DiscoveredBusiness } from "./business-discovery";
import { GERMANY_COVERAGE_STATES } from "./germany-pflege-coverage";
import { companyNamesMatch, discoverHiringEmployers, type HiringEmployerSignal } from "./job-intelligence";

type JobTask = { state: string; code: string; sector: string; queryKey: string };
type LeadBusiness = Omit<DiscoveredBusiness, "source"> & { source: string };
type ResolvedLead = { business: LeadBusiness; seed?: HiringEmployerSignal };

const QUALITY_SCAN_PREFIX = "quality-job:";
const SCAN_FRESH_HOURS = 18;
const MAX_JOB_EMPLOYERS_PER_SCAN = 18;
const FALLBACK_PAGE_SIZE = 30;

function normalizeWebsite(value = "") {
  const raw = value.trim();
  if (!raw) return "";
  try { return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).toString(); } catch { return ""; }
}

function domainFromWebsite(value = "") {
  try { return new URL(normalizeWebsite(value)).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

function isExcludedName(value = "") {
  return /(pflegeheim|altenheim|seniorenheim|seniorenzentrum|seniorenresidenz|pflegezentrum|wohn-? und pflege|wohnpark|tagespflege|hospiz|krankenhaus|klinik|psychiatr|recrut|recruit|zeitarbeit|personaldienst|personalservice|arbeitnehmerüberlass|arbeitnehmerueberlass|arbeitsvermittlung|personalvermittlung|staffing|fußpflege|fusspflege|textilpflege|fahrzeugpflege|kosmetik|sanitätshaus|sanitaetshaus|pflegestützpunkt|pflegestuetzpunkt)/i.test(value);
}

function isStrongAmbulatoryText(value = "") {
  return /(pflegedienst|ambulan(?:t|te|ter)|sozialstation|diakoniestation|häuslich|haeuslich|krankenpflege|intensivpflege|pflegeteam|home care|home health|home_care|ambulatory_care)/i.test(value) && !isExcludedName(value);
}

function isAmbulatoryBusiness(item: Pick<LeadBusiness, "company" | "industry">) {
  return isStrongAmbulatoryText(`${item.company} ${item.industry}`);
}

async function nextTask(): Promise<JobTask | null> {
  const rows = await query<{ query_key: string; last_run_at: string | null }>(
    `select query_key,last_run_at from sales_territory_scans where workspace='default' and query_key like $1`,
    [`${QUALITY_SCAN_PREFIX}%`],
  );
  const state = new Map(rows.map((row) => [row.query_key, row]));
  const tasks: JobTask[] = GERMANY_COVERAGE_STATES.flatMap((item) => item.sectors.map((sector) => ({
    state: item.name,
    code: item.code,
    sector,
    queryKey: `${QUALITY_SCAN_PREFIX}${item.code}:${sector.toLowerCase()}`,
  })));
  const freshCutoff = Date.now() - SCAN_FRESH_HOURS * 60 * 60_000;
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

function fromSeed(seed: HiringEmployerSignal, task: JobTask): LeadBusiness | null {
  if (!seed.employer || isExcludedName(seed.employer)) return null;
  if (!(seed.ambulatoryEvidence || isStrongAmbulatoryText(seed.employer))) return null;
  if (!(seed.phone || seed.website)) return null;
  return {
    id: `quality-job:${seed.seedKey}`,
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
    source: "quality-job-first",
  };
}

async function resolveSeed(seed: HiringEmployerSignal, task: JobTask): Promise<ResolvedLead | null> {
  const direct = fromSeed(seed, task);
  if (direct) return { business: direct, seed };
  if (!seed.employer || isExcludedName(seed.employer)) return null;

  try {
    const result = await discoverBusinesses({
      query: `${seed.employer} ${seed.city || task.sector}`,
      pageSize: 12,
      locationHint: `${seed.city || task.sector}, ${task.state}`,
    });
    const match = result.leads
      .filter((item) => isAmbulatoryBusiness(item))
      .filter((item) => companyNamesMatch(seed.employer, item.company))
      .sort((a, b) => Number(Boolean(b.phone)) - Number(Boolean(a.phone)) || Number(Boolean(b.website)) - Number(Boolean(a.website)))[0];
    if (!match) return null;
    return {
      business: {
        ...match,
        website: match.website || seed.website || "",
        phone: match.phone || seed.phone || "",
        source: match.source || "quality-job-directory",
      },
      seed,
    };
  } catch {
    return null;
  }
}

async function persistOne(item: ResolvedLead, task: JobTask) {
  const business = item.business;
  if (!isAmbulatoryBusiness(business)) return false;
  const website = normalizeWebsite(business.website || item.seed?.website || "");
  const domain = domainFromWebsite(website);
  const city = business.city || item.seed?.city || task.sector;
  const sourceId = business.id || `quality:${business.company}:${city}`;
  const phone = business.phone || item.seed?.phone || "";
  const metadata = {
    state: task.state,
    state_code: task.code,
    address: business.address || item.seed?.address || "",
    discovery_source: business.source,
    discovery_sector: task.sector,
    discovered_at: new Date().toISOString(),
    pflege_icp_verified: true,
    quality_supply_discovery: true,
    job_first: Boolean(item.seed),
    ...(item.seed ? {
      job_growth_seed: item.seed.jobGrowth,
      job_seed_checked_at: item.seed.jobGrowth.checkedAt,
      job_seed_open_positions: item.seed.openPositions,
      job_seed_company_size: item.seed.companySize,
      job_seed_external_portals: item.seed.jobGrowth.externalPortals,
    } : {}),
  };

  const existing = await query<{ id: string }>(
    `select id from sales_companies where workspace='default' and (
       source_id=$1 or ($2<>'' and domain=$2) or (lower(name)=lower($3) and lower(city)=lower($4))
     ) order by updated_at desc limit 1`,
    [sourceId, domain, business.company, city],
  );
  let companyId = existing[0]?.id || crypto.randomUUID();

  if (!existing.length) {
    const inserted = await query<{ id: string }>(
      `insert into sales_companies(id,workspace,name,domain,website,city,industry,phone,source,source_id,lat,lng,research_status,latest_score,metadata)
       values($1,'default',$2,$3,$4,$5,$6,$7,'quality-supply',$8,$9,$10,'pending',45,$11::jsonb)
       on conflict do nothing returning id`,
      [companyId,business.company,domain,website,city,business.industry || "Ambulanter Pflegedienst",phone,sourceId,business.lat ?? null,business.lng ?? null,JSON.stringify(metadata)],
    );
    if (!inserted.length) {
      const matched = await query<{ id: string }>(
        `select id from sales_companies where workspace='default' and (($1<>'' and domain=$1) or (lower(name)=lower($2) and lower(city)=lower($3))) order by updated_at desc limit 1`,
        [domain,business.company,city],
      );
      if (!matched[0]) return false;
      companyId = matched[0].id;
    }
  }

  await query(
    `update sales_companies set
       website=case when $2<>'' then $2 else website end,
       domain=case when $3<>'' then $3 else domain end,
       phone=case when $4<>'' then $4 else phone end,
       city=case when $5<>'' then $5 else city end,
       industry=case when $6<>'' then $6 else industry end,
       metadata=coalesce(metadata,'{}'::jsonb) || $7::jsonb,
       updated_at=now()
     where id=$1 and workspace='default'`,
    [companyId,website,domain,phone,city,business.industry || "Ambulanter Pflegedienst",JSON.stringify(metadata)],
  );

  await query(
    `insert into sales_leads(id,workspace,company_id,stage,status,deal_value,intent_score,fit_score,opportunity_score,priority_score,owner,notes)
     values($1,'default',$2,'Research','active',0,$3,65,65,55,'','Quality Supply · Job-first · Gate v3 offen')
     on conflict(workspace,company_id) where status='active' do update set
       intent_score=greatest(sales_leads.intent_score,excluded.intent_score),updated_at=now()`,
    [crypto.randomUUID(),companyId,item.seed?.jobGrowth.growthScore || 0],
  );
  return true;
}

async function markScan(task: JobTask, values: { found: number; rawJobs: number; relevantJobs: number; warning: string }) {
  await query(
    `insert into sales_territory_scans(workspace,state,state_code,sector,term,query_key,status,pages_scanned,found_count,last_page_token,metadata,last_run_at)
     values('default',$1,$2,$3,'Quality Supply',$4,'complete',1,$5,'',$6::jsonb,now())
     on conflict(workspace,query_key) do update set
       status='complete',pages_scanned=sales_territory_scans.pages_scanned+1,
       found_count=sales_territory_scans.found_count+excluded.found_count,
       metadata=excluded.metadata,last_run_at=now(),updated_at=now()`,
    [task.state,task.code,task.sector,task.queryKey,values.found,JSON.stringify({ qualitySupply: true, rawJobs: values.rawJobs, relevantJobs: values.relevantJobs, warning: values.warning })],
  );
}

export async function runQualitySupplyDiscovery() {
  const task = await nextTask();
  if (!task) return { discovered: 0, jobSeeds: 0, task: "", warning: "Keine Quality-Discovery-Region verfügbar." };

  const jobs = await discoverHiringEmployers(task.sector, { days: 35, size: 100, radiusKm: 75 });
  const resolvedResults = await Promise.allSettled(
    jobs.employers.slice(0, MAX_JOB_EMPLOYERS_PER_SCAN).map((seed) => resolveSeed(seed, task)),
  );
  const resolved = resolvedResults.flatMap((result) => result.status === "fulfilled" && result.value ? [result.value] : []);

  let discovered = 0;
  for (const item of resolved) if (await persistOne(item, task)) discovered += 1;

  let fallbackWarning = "";
  if (discovered < 5) {
    try {
      const fallback = await discoverBusinesses({
        query: `Ambulanter Pflegedienst ${task.sector}`,
        pageSize: FALLBACK_PAGE_SIZE,
        locationHint: `${task.sector}, ${task.state}`,
      });
      for (const business of fallback.leads.filter(isAmbulatoryBusiness)) {
        if (await persistOne({ business: { ...business, source: business.source } }, task)) discovered += 1;
      }
      fallbackWarning = fallback.warning || "";
    } catch (error) {
      fallbackWarning = error instanceof Error ? error.message : "Quality-Fallback-Discovery fehlgeschlagen.";
    }
  }

  const warning = [jobs.warning, fallbackWarning].filter(Boolean).join(" · ");
  await markScan(task, { found: discovered, rawJobs: jobs.rawJobs, relevantJobs: jobs.relevantJobs, warning });
  return {
    discovered,
    jobSeeds: jobs.employers.length,
    task: `${task.sector} · Quality Job-first`,
    warning,
  };
}

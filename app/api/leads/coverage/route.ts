import { z } from "zod";
import { query } from "@/lib/db";
import { getSecret } from "@/lib/secrets";
import { ensureSalesOsSchema } from "@/lib/sales-os";
import { coverageTasksForState, GERMANY_COVERAGE_STATES, normalizeGermanState } from "@/lib/germany-pflege-coverage";

export const runtime = "nodejs";
export const maxDuration = 60;

const postSchema = z.object({
  action: z.enum(["scan"]).default("scan"),
  state: z.string().min(2).max(80),
});

type AddressComponent = { longText?: string; types?: string[] };
type Place = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  websiteUri?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  primaryTypeDisplayName?: { text?: string };
  location?: { latitude?: number; longitude?: number };
  addressComponents?: AddressComponent[];
  businessStatus?: string;
  rating?: number;
  userRatingCount?: number;
};

type Candidate = {
  id: string;
  company: string;
  phone: string;
  website: string;
  city: string;
  address: string;
  state: string;
  stateCode: string;
  postalCode: string;
  industry: string;
  lat: number | null;
  lng: number | null;
  rating: number;
  reviewCount: number;
  businessStatus: string;
  sector: string;
  query: string;
};

async function ensureCoverageSchema() {
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
    create index if not exists sales_territory_scans_state_idx on sales_territory_scans(workspace,state,status);
    alter table sales_territory_scans enable row level security;
    revoke all on sales_territory_scans from anon, authenticated;
  `);
}

function component(place: Place, type: string) {
  return place.addressComponents?.find((item) => item.types?.includes(type))?.longText || "";
}

function isPflegeCandidate(place: Place) {
  const value = `${place.displayName?.text || ""} ${place.primaryTypeDisplayName?.text || ""}`.toLowerCase();
  const include = /(pflege|sozialstation|ambulant|intensiv|häuslich|haeuslich|home care|home health)/i.test(value);
  const exclude = /(pflegeheim|seniorenheim|seniorenresidenz|wohnpark|krankenhaus|klinik|apotheke|physio|arztpraxis|sanitätshaus|sanitaetshaus)/i.test(value);
  return include && !exclude;
}

async function searchPages(apiKey: string, task: { state: string; code: string; sector: string; term: string; queryKey: string; query: string }) {
  const candidates: Candidate[] = [];
  let pageToken = "";
  let pages = 0;
  for (let page = 0; page < 3; page += 1) {
    const body: Record<string, unknown> = { textQuery: task.query, pageSize: 20, languageCode: "de", regionCode: "DE" };
    if (pageToken) body.pageToken = pageToken;
    const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.websiteUri,places.nationalPhoneNumber,places.internationalPhoneNumber,places.primaryTypeDisplayName,places.location,places.addressComponents,places.businessStatus,places.rating,places.userRatingCount,nextPageToken",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Google Places Fehler ${response.status} bei ${task.sector}.`);
    const json = await response.json() as { places?: Place[]; nextPageToken?: string };
    pages += 1;
    for (const place of json.places || []) {
      if (!place.id || !isPflegeCandidate(place)) continue;
      const stateFromPlace = normalizeGermanState(component(place, "administrative_area_level_1"));
      if (stateFromPlace && stateFromPlace !== task.state) continue;
      candidates.push({
        id: place.id,
        company: place.displayName?.text || "Unbekannt",
        phone: place.nationalPhoneNumber || place.internationalPhoneNumber || "",
        website: place.websiteUri || "",
        city: component(place, "locality") || component(place, "postal_town") || task.sector,
        address: place.formattedAddress || "",
        state: task.state,
        stateCode: task.code,
        postalCode: component(place, "postal_code"),
        industry: place.primaryTypeDisplayName?.text || "Pflege",
        lat: place.location?.latitude ?? null,
        lng: place.location?.longitude ?? null,
        rating: Number(place.rating || 0),
        reviewCount: Number(place.userRatingCount || 0),
        businessStatus: place.businessStatus || "",
        sector: task.sector,
        query: task.query,
      });
    }
    pageToken = json.nextPageToken || "";
    if (!pageToken) break;
  }
  return { candidates, pages, pageToken };
}

async function persistDiscovered(candidates: Candidate[]) {
  if (!candidates.length) return 0;
  const deduped = [...new Map(candidates.map((item) => [item.id, item])).values()];
  const payload = JSON.stringify(deduped);
  const rows = await query<{ id: string }>(
    `with input as (
       select * from jsonb_to_recordset($1::jsonb) as x(
         id text, company text, phone text, website text, city text, address text, state text, "stateCode" text,
         "postalCode" text, industry text, lat double precision, lng double precision, rating double precision,
         "reviewCount" integer, "businessStatus" text, sector text, query text
       )
     ), updated as (
       update sales_companies c set
         name=i.company,
         website=case when i.website<>'' then i.website else c.website end,
         city=case when i.city<>'' then i.city else c.city end,
         industry=case when i.industry<>'' then i.industry else c.industry end,
         phone=case when i.phone<>'' then i.phone else c.phone end,
         lat=coalesce(i.lat,c.lat),lng=coalesce(i.lng,c.lng),
         source=case when c.source='' then 'pflege-google-places' else c.source end,
         metadata=coalesce(c.metadata,'{}'::jsonb) || jsonb_build_object(
           'state',i.state,'state_code',i."stateCode",'postal_code',i."postalCode",'address',i.address,
           'google_rating',i.rating,'google_reviews',i."reviewCount",'business_status',i."businessStatus",
           'discovery_sector',i.sector,'discovery_query',i.query,'discovered_at',now()
         ),updated_at=now()
       from input i where c.workspace='default' and c.source_id=i.id
       returning c.id
     ), inserted as (
       insert into sales_companies(id,workspace,name,domain,website,city,industry,phone,source,source_id,lat,lng,research_status,latest_score,metadata)
       select md5('company:default:'||i.id),'default',i.company,'',i.website,i.city,i.industry,i.phone,'pflege-google-places',i.id,i.lat,i.lng,'pending',20,
         jsonb_build_object(
           'state',i.state,'state_code',i."stateCode",'postal_code',i."postalCode",'address',i.address,
           'google_rating',i.rating,'google_reviews',i."reviewCount",'business_status',i."businessStatus",
           'discovery_sector',i.sector,'discovery_query',i.query,'discovered_at',now()
         )
       from input i
       where not exists(select 1 from sales_companies c where c.workspace='default' and c.source_id=i.id)
       on conflict do nothing
       returning id
     )
     insert into sales_leads(id,workspace,company_id,stage,status,deal_value,intent_score,fit_score,opportunity_score,priority_score,owner,notes)
     select md5('lead:default:'||c.id),'default',c.id,'Research','active',0,0,55,55,25,'','Deutschland Radar · Discovery abgeschlossen · Enrichment ausstehend'
     from sales_companies c join input i on i.id=c.source_id
     where c.workspace='default'
     on conflict(workspace,company_id) where status='active'
     do update set updated_at=now()
     returning id`,
    [payload],
  );
  return rows.length;
}

async function loadCoverage() {
  await ensureCoverageSchema();
  const scanRows = await query<{ state: string; done: number; pages: number; found: number; last_run_at: string | null }>(
    `select state,count(*) filter(where status='complete')::int done,coalesce(sum(pages_scanned),0)::int pages,
            coalesce(sum(found_count),0)::int found,max(last_run_at) last_run_at
       from sales_territory_scans where workspace='default' group by state`,
  );
  const companyRows = await query<{ state: string; companies: number; enriched: number; call_ready: number; contacted: number; ad_signal: number }>(
    `select coalesce(c.metadata->>'state','') state,
            count(distinct c.id)::int companies,
            count(distinct c.id) filter(where c.research_status='complete')::int enriched,
            count(distinct c.id) filter(where c.research_status='complete' and coalesce(ct.phone,c.phone,'')<>'' and l.stage<>'Research' and not l.do_not_contact and l.phone_status<>'invalid')::int call_ready,
            count(distinct c.id) filter(where l.last_contact_at is not null or l.stage not in ('Neu','Research','Bereit'))::int contacted,
            count(distinct c.id) filter(where
              (c.metadata->'enrichment'->'ads'->'google'->>'status') in ('active','likely') or
              (c.metadata->'enrichment'->'ads'->'meta'->>'status') in ('active','likely') or
              (c.metadata->'enrichment'->'marketing'->>'googleAdsTag')='true' or
              (c.metadata->'enrichment'->'marketing'->>'metaPixel')='true'
            )::int ad_signal
       from sales_companies c
       join sales_leads l on l.company_id=c.id and l.workspace=c.workspace and l.status='active'
       left join sales_contacts ct on ct.id=l.contact_id
      where c.workspace='default' and (c.source like 'pflege%' or lower(c.industry) like '%pflege%' or lower(c.name) like '%pflege%')
      group by coalesce(c.metadata->>'state','')`,
  );
  const pendingRows = await query<{ state: string; id: string }>(
    `select coalesce(c.metadata->>'state','') state,l.id
       from sales_companies c join sales_leads l on l.company_id=c.id and l.workspace=c.workspace and l.status='active'
      where c.workspace='default' and c.research_status<>'complete' and (c.source like 'pflege%' or lower(c.industry) like '%pflege%' or lower(c.name) like '%pflege%')
      order by c.updated_at asc limit 120`,
  );
  const [globalRow] = await query<{ total: number; unmapped: number }>(
    `select count(distinct c.id)::int total,
            count(distinct c.id) filter(where coalesce(c.metadata->>'state','')='')::int unmapped
       from sales_companies c
      where c.workspace='default' and (c.source like 'pflege%' or lower(c.industry) like '%pflege%' or lower(c.name) like '%pflege%')`,
  );

  const scanMap = new Map(scanRows.map((row) => [normalizeGermanState(row.state), row]));
  const companyMap = new Map(companyRows.map((row) => [normalizeGermanState(row.state), row]));
  const queueMap = new Map<string, string[]>();
  for (const row of pendingRows) {
    const state = normalizeGermanState(row.state);
    if (!state) continue;
    const list = queueMap.get(state) || [];
    if (list.length < 5) list.push(row.id);
    queueMap.set(state, list);
  }

  const states = GERMANY_COVERAGE_STATES.map((state) => {
    const scan = scanMap.get(state.name);
    const companies = companyMap.get(state.name);
    const tasksTotal = coverageTasksForState(state.name).length;
    const tasksDone = Number(scan?.done || 0);
    return {
      code: state.code,
      name: state.name,
      sectors: state.sectors.length,
      tasksTotal,
      tasksDone,
      coveragePercent: tasksTotal ? Math.round(tasksDone / tasksTotal * 100) : 0,
      pagesScanned: Number(scan?.pages || 0),
      rawHits: Number(scan?.found || 0),
      companies: Number(companies?.companies || 0),
      enriched: Number(companies?.enriched || 0),
      callReady: Number(companies?.call_ready || 0),
      contacted: Number(companies?.contacted || 0),
      adSignal: Number(companies?.ad_signal || 0),
      pendingLeadIds: queueMap.get(state.name) || [],
      lastRunAt: scan?.last_run_at || null,
    };
  });
  const taskTotal = states.reduce((sum, state) => sum + state.tasksTotal, 0);
  const taskDone = states.reduce((sum, state) => sum + state.tasksDone, 0);
  return {
    states,
    global: {
      companies: Number(globalRow?.total || 0),
      unmapped: Number(globalRow?.unmapped || 0),
      enriched: states.reduce((sum, state) => sum + state.enriched, 0),
      callReady: states.reduce((sum, state) => sum + state.callReady, 0),
      contacted: states.reduce((sum, state) => sum + state.contacted, 0),
      adSignal: states.reduce((sum, state) => sum + state.adSignal, 0),
      tasksTotal: taskTotal,
      tasksDone: taskDone,
      coveragePercent: taskTotal ? Math.round(taskDone / taskTotal * 100) : 0,
    },
  };
}

export async function GET() {
  try {
    return Response.json(await loadCoverage());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Coverage konnte nicht geladen werden." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await ensureCoverageSchema();
    const input = postSchema.parse(await request.json());
    const stateName = normalizeGermanState(input.state);
    const state = GERMANY_COVERAGE_STATES.find((item) => item.name === stateName);
    if (!state) return Response.json({ error: "Bundesland nicht erkannt." }, { status: 400 });
    const key = process.env.GOOGLE_MAPS_API_KEY || await getSecret("google_maps_api_key");
    if (!key) return Response.json({ error: "Google Maps / Places API ist noch nicht verbunden." }, { status: 503 });

    const tasks = coverageTasksForState(state.name);
    const doneRows = await query<{ query_key: string }>(
      `select query_key from sales_territory_scans where workspace='default' and state=$1 and status='complete'`,
      [state.name],
    );
    const done = new Set(doneRows.map((row) => row.query_key));
    const nextSector = state.sectors.find((sector) => tasks.some((task) => task.sector === sector && !done.has(task.queryKey)));
    if (!nextSector) return Response.json({ ok: true, complete: true, message: `${state.name} ist im Discovery-Pass vollständig gescannt.`, coverage: await loadCoverage() });
    const sectorTasks = tasks.filter((task) => task.sector === nextSector && !done.has(task.queryKey));

    const results = await Promise.all(sectorTasks.map((task) => searchPages(key, task)));
    const allCandidates = results.flatMap((result) => result.candidates);
    const imported = await persistDiscovered(allCandidates);

    for (let index = 0; index < sectorTasks.length; index += 1) {
      const task = sectorTasks[index];
      const result = results[index];
      await query(
        `insert into sales_territory_scans(workspace,state,state_code,sector,term,query_key,status,pages_scanned,found_count,last_page_token,metadata,last_run_at)
         values('default',$1,$2,$3,$4,$5,'complete',$6,$7,$8,$9::jsonb,now())
         on conflict(workspace,query_key) do update set status='complete',pages_scanned=excluded.pages_scanned,found_count=excluded.found_count,last_page_token=excluded.last_page_token,metadata=excluded.metadata,last_run_at=now(),updated_at=now()`,
        [state.name, state.code, task.sector, task.term, task.queryKey, result.pages, result.candidates.length, result.pageToken, JSON.stringify({ query: task.query })],
      );
    }

    return Response.json({
      ok: true,
      state: state.name,
      sector: nextSector,
      queries: sectorTasks.length,
      rawHits: allCandidates.length,
      uniqueFound: new Set(allCandidates.map((item) => item.id)).size,
      crmTouched: imported,
      coverage: await loadCoverage(),
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Bundesland-Scan fehlgeschlagen." }, { status: 500 });
  }
}

import { query } from "./db";
import { ensureSalesOsSchema } from "./sales-os";

export const REVENUE_STAGES = [
  "Neu",
  "Geprüft",
  "Call bereit",
  "Kontaktiert",
  "Interesse",
  "Termin",
  "Angebot",
  "Verhandlung",
  "Gewonnen",
  "Verloren",
] as const;

export type RevenueStage = (typeof REVENUE_STAGES)[number];
export type ProductKey = "pflege_recruiting" | "website" | "seo" | "automation";

export const PRODUCT_CATALOG: Record<ProductKey, {
  key: ProductKey;
  label: string;
  shortLabel: string;
  description: string;
  setup: number;
  monthly: number;
  accent: string;
}> = {
  pflege_recruiting: {
    key: "pflege_recruiting",
    label: "Pflege Social Recruiting",
    shortLabel: "Recruiting",
    description: "Mitarbeitergewinnung · Funnel · Ads · Employer Branding",
    setup: 3000,
    monthly: 1990,
    accent: "lime",
  },
  website: {
    key: "website",
    label: "Website Relaunch",
    shortLabel: "Website",
    description: "Conversion · Arbeitgeberattraktivität · Vertrauen · Bewerberweg",
    setup: 2490,
    monthly: 0,
    accent: "violet",
  },
  seo: {
    key: "seo",
    label: "SEO / Local Growth",
    shortLabel: "SEO",
    description: "Google Sichtbarkeit · Local SEO · Content · Nachfrage abfangen",
    setup: 1500,
    monthly: 1990,
    accent: "cyan",
  },
  automation: {
    key: "automation",
    label: "KI / Automation",
    shortLabel: "Automation",
    description: "Anrufannahme · Follow-up · Terminierung · Prozessautomatisierung",
    setup: 1500,
    monthly: 200,
    accent: "amber",
  },
};

type JsonObject = Record<string, unknown>;

type SeedLeadRow = {
  lead_id: string;
  company_id: string;
  company: string;
  city: string;
  industry: string;
  website: string;
  phone: string;
  email: string;
  notes: string;
  priority_score: number;
  opportunity_score: number;
  metadata: JsonObject;
  website_score: number;
};

type OpportunityRow = {
  id: string;
  workspace: string;
  lead_id: string;
  company_id: string;
  product_key: ProductKey;
  stage: RevenueStage;
  status: string;
  setup_value: number;
  monthly_value: number;
  probability: number;
  score: number;
  next_action: string;
  next_action_at: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
  company: string;
  city: string;
  industry: string;
  website: string;
  phone: string;
  email: string;
  lead_priority: number;
  lead_opportunity: number;
  company_metadata: JsonObject;
  website_score: number;
};

let schemaReady = false;

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function num(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function normalizedHaystack(row: SeedLeadRow) {
  return [row.company, row.industry, row.notes, JSON.stringify(row.metadata)].join(" ").toLowerCase();
}

function jobCount(row: SeedLeadRow) {
  const daily = asObject(row.metadata?.daily_qualification);
  const growth = asObject(daily?.jobGrowth);
  return Math.max(0, num(growth?.relevantOpenJobs));
}

function websiteWeak(row: SeedLeadRow) {
  const daily = asObject(row.metadata?.daily_qualification);
  if (!row.website) return true;
  if (daily?.websiteWeak === true || text(daily?.websiteWeak).toLowerCase() === "true") return true;
  if (row.website_score > 0 && row.website_score < 72) return true;
  return row.opportunity_score >= 72;
}

function defaultWebsiteSetup(row: SeedLeadRow) {
  if (!row.website) return 3490;
  if (row.website_score > 0 && row.website_score < 40) return 3490;
  if (row.website_score > 0 && row.website_score < 65) return 2490;
  return 1490;
}

function suggestedProducts(row: SeedLeadRow): ProductKey[] {
  const haystack = normalizedHaystack(row);
  const jobs = jobCount(row);
  const careFit = /(pflege|pflegedienst|senior|ambulant|intensivpflege|tagespflege|altenpflege)/i.test(haystack);
  const handworkFit = /(shk|haustechnik|sanitär|heizung|klima|elektro|handwerk|werkstatt|servicebetrieb|installateur)/i.test(haystack);
  const products = new Set<ProductKey>();

  if (websiteWeak(row)) products.add("website");
  if (careFit || jobs > 0 || /(karriere|bewerb|stellenanzeige|mitarbeiter|fachkraft)/i.test(haystack)) products.add("pflege_recruiting");
  if (row.website && (row.website_score === 0 ? row.priority_score >= 65 : row.website_score < 70)) products.add("seo");
  if (row.phone && handworkFit) products.add("automation");

  if (!products.size) products.add(row.website ? "seo" : "website");
  return [...products];
}

function defaultValues(product: ProductKey, row?: SeedLeadRow) {
  if (product === "website") return { setup: row ? defaultWebsiteSetup(row) : PRODUCT_CATALOG.website.setup, monthly: 0 };
  const base = PRODUCT_CATALOG[product];
  return { setup: base.setup, monthly: base.monthly };
}

function defaultStage(row: SeedLeadRow): RevenueStage {
  return row.phone ? "Call bereit" : "Geprüft";
}

function stageProbability(stage: RevenueStage) {
  const values: Record<RevenueStage, number> = {
    Neu: 5,
    "Geprüft": 10,
    "Call bereit": 12,
    Kontaktiert: 18,
    Interesse: 40,
    Termin: 60,
    Angebot: 75,
    Verhandlung: 85,
    Gewonnen: 100,
    Verloren: 0,
  };
  return values[stage];
}

function signalSummary(row: OpportunityRow) {
  const metadata = asObject(row.company_metadata);
  const daily = asObject(metadata?.daily_qualification);
  const rawReasons = asArray(daily?.reasons).map(String).filter(Boolean);
  const jobs = Math.max(0, num(asObject(daily?.jobGrowth)?.relevantOpenJobs));

  if (row.product_key === "website") {
    if (!row.website) return "Keine Website erkannt · maximaler Relaunch-Hebel";
    if (row.website_score > 0) return `Website-Score ${row.website_score}/100 · sichtbarer Relaunch-Hebel`;
    return rawReasons[0] || "Website-Potenzial aus Research erkannt";
  }
  if (row.product_key === "pflege_recruiting") {
    if (jobs > 0) return `${jobs} offene Stelle${jobs === 1 ? "" : "n"} erkannt · Recruiting-Bedarf vorhanden`;
    return rawReasons.find((reason) => /job|stelle|bewerb|recruit|pflege/i.test(reason)) || "Recruiting-Fit aus Branche und Research erkannt";
  }
  if (row.product_key === "seo") return row.website_score > 0 ? `Website-Score ${row.website_score}/100 · organisches Wachstumspotenzial` : "Website vorhanden · SEO-Potenzial prüfen";
  return "Telefonischer Servicebetrieb · Automationspotenzial im Erstgespräch qualifizieren";
}

function callScore(row: OpportunityRow) {
  let score = Number(row.score || 0) * 2 + Number(row.lead_priority || 0) * 2 + Number(row.lead_opportunity || 0);
  if (row.stage === "Interesse") score += 300;
  if (row.stage === "Termin") score += 220;
  if (row.stage === "Kontaktiert") score += 120;
  if (row.stage === "Call bereit") score += 90;
  if (row.next_action_at && new Date(row.next_action_at).getTime() <= Date.now()) score += 420;
  if (row.product_key === "pflege_recruiting") score += 45;
  if (row.product_key === "website" && row.website_score > 0 && row.website_score < 50) score += 70;
  return Math.round(score);
}

export async function ensureRevenueOpportunitySchema() {
  if (schemaReady) return;
  await ensureSalesOsSchema();
  await query(`
    create table if not exists sales_opportunities (
      id text primary key,
      workspace text not null,
      lead_id text not null references sales_leads(id) on delete cascade,
      company_id text not null references sales_companies(id) on delete cascade,
      product_key text not null,
      stage text not null default 'Neu',
      status text not null default 'open',
      setup_value numeric(12,2) not null default 0,
      monthly_value numeric(12,2) not null default 0,
      probability integer not null default 5,
      score integer not null default 0,
      next_action text not null default '',
      next_action_at timestamptz,
      notes text not null default '',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create unique index if not exists sales_opportunities_lead_product_idx
      on sales_opportunities(workspace, lead_id, product_key);
    create index if not exists sales_opportunities_pipeline_idx
      on sales_opportunities(workspace, product_key, stage, score desc, updated_at desc);
    create index if not exists sales_opportunities_due_idx
      on sales_opportunities(workspace, next_action_at) where status='open';
  `);
  schemaReady = true;
}

async function seedRows(workspace: string, missingOnly = false) {
  return query<SeedLeadRow>(`
    select l.id lead_id,l.company_id,c.name company,c.city,c.industry,c.website,
           coalesce(ct.phone,c.phone,'') phone,coalesce(ct.email,'') email,l.notes,
           l.priority_score,l.opportunity_score,c.metadata,
           coalesce(rr.website_score,0)::int website_score
    from sales_leads l
    join sales_companies c on c.id=l.company_id
    left join sales_contacts ct on ct.id=l.contact_id
    left join lateral (
      select website_score from sales_research_runs r
      where r.workspace=l.workspace and r.company_id=l.company_id
      order by r.created_at desc limit 1
    ) rr on true
    where l.workspace=$1 and l.status='active'
      and ($2::boolean=false or not exists (
        select 1 from sales_opportunities existing
        where existing.workspace=l.workspace and existing.lead_id=l.id
      ))
    order by l.priority_score desc,l.updated_at desc
    limit 1500
  `, [workspace, missingOnly]);
}

async function seedOne(row: SeedLeadRow, product: ProductKey, workspace: string) {
  const values = defaultValues(product, row);
  const stage = defaultStage(row);
  const score = Math.max(0, Math.min(100, Math.round(row.priority_score * 0.55 + row.opportunity_score * 0.45)));
  await query(`
    insert into sales_opportunities(
      id,workspace,lead_id,company_id,product_key,stage,status,setup_value,monthly_value,probability,score,next_action
    ) values($1,$2,$3,$4,$5,$6,'open',$7,$8,$9,$10,$11)
    on conflict(workspace,lead_id,product_key) do nothing
  `, [
    crypto.randomUUID(), workspace, row.lead_id, row.company_id, product, stage,
    values.setup, values.monthly, stageProbability(stage), score,
    row.phone ? "Anrufen und Bedarf qualifizieren" : "Kontaktdaten vervollständigen",
  ]);
}

export async function seedRevenueOpportunities(workspace = "default", missingOnly = false) {
  await ensureRevenueOpportunitySchema();
  const rows = await seedRows(workspace, missingOnly);
  const batchSize = 12;
  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize);
    await Promise.all(batch.flatMap((row) => suggestedProducts(row).map((product) => seedOne(row, product, workspace))));
  }
  return rows.length;
}

async function loadOpportunityRows(workspace: string) {
  return query<OpportunityRow>(`
    select o.id,o.workspace,o.lead_id,o.company_id,o.product_key,o.stage,o.status,
           o.setup_value::float8 setup_value,o.monthly_value::float8 monthly_value,
           o.probability,o.score,o.next_action,o.next_action_at,o.notes,o.created_at,o.updated_at,
           c.name company,c.city,c.industry,c.website,coalesce(ct.phone,c.phone,'') phone,coalesce(ct.email,'') email,
           l.priority_score lead_priority,l.opportunity_score lead_opportunity,c.metadata company_metadata,
           coalesce(rr.website_score,0)::int website_score
    from sales_opportunities o
    join sales_leads l on l.id=o.lead_id and l.workspace=o.workspace
    join sales_companies c on c.id=o.company_id and c.workspace=o.workspace
    left join sales_contacts ct on ct.id=l.contact_id
    left join lateral (
      select website_score from sales_research_runs r
      where r.workspace=o.workspace and r.company_id=o.company_id
      order by r.created_at desc limit 1
    ) rr on true
    where o.workspace=$1 and l.status='active'
    order by o.updated_at desc
    limit 2500
  `, [workspace]);
}

export async function getRevenueSnapshot(workspace = "default") {
  await ensureRevenueOpportunitySchema();
  await seedRevenueOpportunities(workspace, true);
  const rows = await loadOpportunityRows(workspace);
  const opportunities = rows.map((row) => ({
    ...row,
    annual_value: Number(row.setup_value || 0) + Number(row.monthly_value || 0) * 12,
    weighted_value: (Number(row.setup_value || 0) + Number(row.monthly_value || 0) * 12) * Number(row.probability || 0) / 100,
    call_score: callScore(row),
    signal_summary: signalSummary(row),
  })).sort((a, b) => b.call_score - a.call_score);

  const active = opportunities.filter((item) => item.stage !== "Gewonnen" && item.stage !== "Verloren" && item.status === "open");
  const won = opportunities.filter((item) => item.stage === "Gewonnen" || item.status === "won");
  const now = Date.now();

  const [today] = await query<{ calls: number; meetings: number; wins: number; activities: number }>(`
    select count(*) filter(where type='revenue.outcome')::int calls,
           count(*) filter(where type='revenue.outcome' and meta->>'outcome'='Termin')::int meetings,
           count(*) filter(where type='revenue.outcome' and meta->>'outcome'='Gewonnen')::int wins,
           count(*)::int activities
    from sales_activities
    where workspace=$1 and created_at>=date_trunc('day',now())
  `, [workspace]);

  const productStats = (Object.keys(PRODUCT_CATALOG) as ProductKey[]).map((key) => {
    const rowsForProduct = opportunities.filter((item) => item.product_key === key);
    const openRows = rowsForProduct.filter((item) => item.stage !== "Gewonnen" && item.stage !== "Verloren" && item.status === "open");
    return {
      key,
      label: PRODUCT_CATALOG[key].label,
      shortLabel: PRODUCT_CATALOG[key].shortLabel,
      description: PRODUCT_CATALOG[key].description,
      accent: PRODUCT_CATALOG[key].accent,
      open: openRows.length,
      callReady: openRows.filter((item) => Boolean(item.phone) && ["Neu", "Geprüft", "Call bereit", "Kontaktiert", "Interesse"].includes(item.stage)).length,
      annualPotential: openRows.reduce((sum, item) => sum + item.annual_value, 0),
      weightedPotential: openRows.reduce((sum, item) => sum + item.weighted_value, 0),
      mrrPotential: openRows.reduce((sum, item) => sum + Number(item.monthly_value || 0), 0),
    };
  });

  const activityRows = await query<{ id: number; lead_id: string; company_id: string; type: string; summary: string; meta: JsonObject; created_at: string }>(`
    select id,coalesce(lead_id,'') lead_id,coalesce(company_id,'') company_id,type,summary,meta,created_at
    from sales_activities where workspace=$1
    order by created_at desc limit 80
  `, [workspace]);

  return {
    catalog: PRODUCT_CATALOG,
    stages: REVENUE_STAGES,
    stats: {
      openOpportunities: active.length,
      callReady: active.filter((item) => Boolean(item.phone) && ["Neu", "Geprüft", "Call bereit", "Kontaktiert", "Interesse"].includes(item.stage)).length,
      annualPotential: active.reduce((sum, item) => sum + item.annual_value, 0),
      weightedPotential: active.reduce((sum, item) => sum + item.weighted_value, 0),
      mrrPotential: active.reduce((sum, item) => sum + Number(item.monthly_value || 0), 0),
      wonRevenue: won.reduce((sum, item) => sum + item.annual_value, 0),
      dueActions: active.filter((item) => item.next_action_at && new Date(item.next_action_at).getTime() <= now).length,
    },
    today: {
      calls: Number(today?.calls || 0),
      meetings: Number(today?.meetings || 0),
      wins: Number(today?.wins || 0),
      activities: Number(today?.activities || 0),
    },
    productStats,
    opportunities,
    activities: activityRows,
  };
}

async function getSeedLead(leadId: string, workspace: string) {
  const rows = await query<SeedLeadRow>(`
    select l.id lead_id,l.company_id,c.name company,c.city,c.industry,c.website,
           coalesce(ct.phone,c.phone,'') phone,coalesce(ct.email,'') email,l.notes,
           l.priority_score,l.opportunity_score,c.metadata,
           coalesce(rr.website_score,0)::int website_score
    from sales_leads l
    join sales_companies c on c.id=l.company_id
    left join sales_contacts ct on ct.id=l.contact_id
    left join lateral (
      select website_score from sales_research_runs r where r.workspace=l.workspace and r.company_id=l.company_id
      order by r.created_at desc limit 1
    ) rr on true
    where l.workspace=$1 and l.id=$2 and l.status='active' limit 1
  `, [workspace, leadId]);
  return rows[0] || null;
}

export async function addProductOpportunity(leadId: string, productKey: ProductKey, workspace = "default") {
  await ensureRevenueOpportunitySchema();
  const row = await getSeedLead(leadId, workspace);
  if (!row) throw new Error("Lead nicht gefunden.");
  await seedOne(row, productKey, workspace);
  return getRevenueSnapshot(workspace);
}

function outcomePatch(outcome: string, currentStage: RevenueStage) {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  if (outcome === "Nicht erreicht") return { stage: "Kontaktiert" as RevenueStage, probability: Math.max(15, stageProbability(currentStage)), nextAction: "Morgen erneut anrufen", nextActionAt: tomorrow, status: "open" };
  if (outcome === "Erreicht") return { stage: "Kontaktiert" as RevenueStage, probability: Math.max(22, stageProbability(currentStage)), nextAction: "Bedarf qualifizieren", nextActionAt: null, status: "open" };
  if (outcome === "Interesse") return { stage: "Interesse" as RevenueStage, probability: 40, nextAction: "Termin fixieren", nextActionAt: null, status: "open" };
  if (outcome === "Termin") return { stage: "Termin" as RevenueStage, probability: 60, nextAction: "Termin vorbereiten", nextActionAt: null, status: "open" };
  if (outcome === "Angebot") return { stage: "Angebot" as RevenueStage, probability: 75, nextAction: "Angebot nachfassen", nextActionAt: null, status: "open" };
  if (outcome === "Gewonnen") return { stage: "Gewonnen" as RevenueStage, probability: 100, nextAction: "Onboarding starten", nextActionAt: null, status: "won" };
  if (outcome === "Verloren") return { stage: "Verloren" as RevenueStage, probability: 0, nextAction: "", nextActionAt: null, status: "lost" };
  return null;
}

function legacyStage(stage: RevenueStage) {
  const map: Record<RevenueStage, string> = {
    Neu: "Neu",
    "Geprüft": "Research",
    "Call bereit": "Bereit",
    Kontaktiert: "Kontaktiert",
    Interesse: "Engaged",
    Termin: "Termin",
    Angebot: "Angebot",
    Verhandlung: "Verhandlung",
    Gewonnen: "Gewonnen",
    Verloren: "Verloren",
  };
  return map[stage];
}

async function syncLeadStage(leadId: string, workspace: string) {
  const rows = await query<{ stage: RevenueStage; status: string }>(`
    select stage,status from sales_opportunities where workspace=$1 and lead_id=$2
  `, [workspace, leadId]);
  if (!rows.length) return;
  const rank = new Map<RevenueStage, number>(REVENUE_STAGES.map((stage, index) => [stage, index]));
  const open = rows.filter((row) => !["Gewonnen", "Verloren"].includes(row.stage) && row.status === "open");
  const won = rows.filter((row) => row.stage === "Gewonnen" || row.status === "won");
  const best = (open.length ? open : won.length ? won : rows).sort((a, b) => (rank.get(b.stage) || 0) - (rank.get(a.stage) || 0))[0];
  if (!best) return;
  await query(`update sales_leads set stage=$3,updated_at=now() where id=$1 and workspace=$2`, [leadId, workspace, legacyStage(best.stage)]);
}

export type OpportunityPatch = {
  stage?: RevenueStage;
  setupValue?: number;
  monthlyValue?: number;
  probability?: number;
  nextAction?: string;
  nextActionAt?: string | null;
  notes?: string;
  outcome?: string;
};

export async function updateRevenueOpportunity(id: string, patch: OpportunityPatch, workspace = "default") {
  await ensureRevenueOpportunitySchema();
  const currentRows = await query<{ id: string; lead_id: string; company_id: string; product_key: ProductKey; stage: RevenueStage; setup_value: number; monthly_value: number; probability: number; next_action: string; next_action_at: string | null; notes: string }>(`
    select id,lead_id,company_id,product_key,stage,setup_value::float8 setup_value,monthly_value::float8 monthly_value,
           probability,next_action,next_action_at,notes
    from sales_opportunities where id=$1 and workspace=$2 limit 1
  `, [id, workspace]);
  const current = currentRows[0];
  if (!current) throw new Error("Opportunity nicht gefunden.");

  const outcome = patch.outcome ? outcomePatch(patch.outcome, current.stage) : null;
  const stage = patch.stage ?? outcome?.stage ?? current.stage;
  const probability = patch.probability ?? outcome?.probability ?? (patch.stage ? stageProbability(stage) : current.probability);
  const status = outcome?.status ?? (stage === "Gewonnen" ? "won" : stage === "Verloren" ? "lost" : "open");
  const nextAction = patch.nextAction ?? outcome?.nextAction ?? current.next_action;
  const nextActionAt = patch.nextActionAt !== undefined ? patch.nextActionAt : outcome?.nextActionAt !== undefined ? outcome.nextActionAt : current.next_action_at;

  await query(`
    update sales_opportunities set
      stage=$3,status=$4,setup_value=$5,monthly_value=$6,probability=$7,
      next_action=$8,next_action_at=$9,notes=$10,updated_at=now()
    where id=$1 and workspace=$2
  `, [
    id, workspace, stage, status,
    patch.setupValue ?? current.setup_value,
    patch.monthlyValue ?? current.monthly_value,
    probability,
    nextAction,
    nextActionAt || null,
    patch.notes ?? current.notes,
  ]);

  const summary = patch.outcome
    ? `${patch.outcome} · ${PRODUCT_CATALOG[current.product_key].shortLabel}`
    : `${PRODUCT_CATALOG[current.product_key].shortLabel} → ${stage}`;
  await query(`
    insert into sales_activities(workspace,lead_id,company_id,type,summary,meta)
    values($1,$2,$3,$4,$5,$6::jsonb)
  `, [
    workspace, current.lead_id, current.company_id,
    patch.outcome ? "revenue.outcome" : "revenue.stage",
    summary,
    JSON.stringify({ opportunityId: id, outcome: patch.outcome || "", stage, probability }),
  ]);

  await syncLeadStage(current.lead_id, workspace);
  return getRevenueSnapshot(workspace);
}

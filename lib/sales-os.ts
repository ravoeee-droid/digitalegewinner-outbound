import { query } from "./db";
import type { ContactEnrichment } from "./contact-enrichment";
import type { WebsiteAuditResult } from "./website-audit";

let salesSchemaReady = false;

export type RadarCandidate = {
  id: string;
  company: string;
  contact?: string;
  email?: string;
  phone?: string;
  website?: string;
  city?: string;
  industry?: string;
  lat?: number;
  lng?: number;
  source?: string;
};

export type ResearchScores = {
  websiteScore: number;
  contactScore: number;
  fitScore: number;
  opportunityScore: number;
  intentScore: number;
  priorityScore: number;
};

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeWebsite(value = "") {
  if (!value.trim()) return "";
  try {
    return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).toString();
  } catch {
    return value.trim();
  }
}

function domainFromWebsite(value = "") {
  try {
    return new URL(normalizeWebsite(value)).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function scoreResearch(candidate: RadarCandidate, contact: Partial<ContactEnrichment>, audit?: WebsiteAuditResult): { scores: ResearchScores; signals: string[] } {
  const websiteScore = clamp(Number(audit?.scores?.overall || 0));
  const contactScore = clamp(
    (contact.email || candidate.email ? 42 : 0) +
      (contact.phone || candidate.phone ? 24 : 0) +
      (contact.linkedin ? 14 : 0) +
      (contact.instagram ? 8 : 0) +
      (contact.contactPage ? 12 : 0),
  );

  const fitScore = clamp(
    30 +
      (candidate.industry ? 20 : 0) +
      (candidate.city ? 15 : 0) +
      (candidate.website ? 20 : 0) +
      (candidate.phone || contact.phone ? 15 : 0),
  );

  const conversion = Number(audit?.scores?.conversion ?? websiteScore);
  const trust = Number(audit?.scores?.trust ?? websiteScore);
  const seo = Number(audit?.scores?.seo ?? websiteScore);
  const opportunityScore = audit
    ? clamp((100 - conversion) * 0.42 + (100 - trust) * 0.33 + (100 - seo) * 0.25)
    : candidate.website
      ? 60
      : 85;
  const intentScore = 0;
  const priorityScore = clamp(opportunityScore * 0.42 + fitScore * 0.28 + contactScore * 0.2 + intentScore * 0.1);

  const signals: string[] = [];
  if (!candidate.website) signals.push("Keine Website erkannt");
  if (audit && conversion < 55) signals.push("Conversion-Potenzial hoch");
  if (audit && trust < 55) signals.push("Trust-Potenzial hoch");
  if (audit && seo < 55) signals.push("SEO-Potenzial hoch");
  if (contact.email || candidate.email) signals.push("Öffentliche E-Mail gefunden");
  if (contact.phone || candidate.phone) signals.push("Telefon verfügbar");
  if (contact.linkedin) signals.push("LinkedIn erkannt");
  if (contact.instagram) signals.push("Instagram erkannt");

  return { scores: { websiteScore, contactScore, fitScore, opportunityScore, intentScore, priorityScore }, signals };
}

export async function ensureSalesOsSchema() {
  if (salesSchemaReady) return;
  await query(`
    create table if not exists sales_workspaces (
      id text primary key,
      name text not null,
      vertical text not null default 'general',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table if not exists sales_companies (
      id text primary key,
      workspace text not null,
      name text not null,
      domain text not null default '',
      website text not null default '',
      city text not null default '',
      industry text not null default '',
      phone text not null default '',
      source text not null default 'manual',
      source_id text not null default '',
      lat double precision,
      lng double precision,
      research_status text not null default 'pending',
      latest_score integer not null default 0,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create index if not exists sales_companies_workspace_idx on sales_companies(workspace, latest_score desc);
    create unique index if not exists sales_companies_source_idx on sales_companies(workspace, source, source_id) where source_id <> '';
    create unique index if not exists sales_companies_domain_idx on sales_companies(workspace, domain) where domain <> '';

    create table if not exists sales_contacts (
      id text primary key,
      workspace text not null,
      company_id text not null references sales_companies(id) on delete cascade,
      name text not null default '',
      email text not null default '',
      phone text not null default '',
      linkedin text not null default '',
      instagram text not null default '',
      is_primary boolean not null default false,
      source text not null default 'public-website',
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create index if not exists sales_contacts_company_idx on sales_contacts(workspace, company_id);

    create table if not exists sales_leads (
      id text primary key,
      workspace text not null,
      company_id text not null references sales_companies(id) on delete cascade,
      contact_id text references sales_contacts(id) on delete set null,
      stage text not null default 'Neu',
      status text not null default 'active',
      deal_value numeric(12,2) not null default 0,
      intent_score integer not null default 0,
      fit_score integer not null default 0,
      opportunity_score integer not null default 0,
      priority_score integer not null default 0,
      owner text not null default '',
      notes text not null default '',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create unique index if not exists sales_leads_company_idx on sales_leads(workspace, company_id) where status='active';
    create index if not exists sales_leads_priority_idx on sales_leads(workspace, priority_score desc, updated_at desc);

    create table if not exists sales_activities (
      id bigserial primary key,
      workspace text not null,
      lead_id text,
      company_id text,
      type text not null,
      summary text not null,
      meta jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );
    create index if not exists sales_activities_lead_idx on sales_activities(workspace, lead_id, created_at desc);

    create table if not exists sales_research_runs (
      id text primary key,
      workspace text not null,
      company_id text not null references sales_companies(id) on delete cascade,
      status text not null default 'complete',
      website_score integer not null default 0,
      contact_score integer not null default 0,
      fit_score integer not null default 0,
      opportunity_score integer not null default 0,
      priority_score integer not null default 0,
      signals jsonb not null default '[]'::jsonb,
      audit jsonb not null default '{}'::jsonb,
      contact jsonb not null default '{}'::jsonb,
      summary text not null default '',
      created_at timestamptz not null default now()
    );
    create index if not exists sales_research_company_idx on sales_research_runs(workspace, company_id, created_at desc);
  `);
  await query(
    `insert into sales_workspaces(id,name,vertical) values($1,$2,$3)
     on conflict(id) do update set name=excluded.name, updated_at=now()`,
    ["default", "Digitale Gewinner", "general"],
  );
  salesSchemaReady = true;
}

export async function persistRadarLead(candidate: RadarCandidate, contact: Partial<ContactEnrichment>, audit?: WebsiteAuditResult, workspace = "default") {
  await ensureSalesOsSchema();
  const website = normalizeWebsite(candidate.website || "");
  const domain = domainFromWebsite(website);
  const { scores, signals } = scoreResearch(candidate, contact, audit);

  let company = await query<{ id: string }>(
    `select id from sales_companies
     where workspace=$1 and ((source_id<>'' and source_id=$2) or (domain<>'' and domain=$3))
     order by updated_at desc limit 1`,
    [workspace, candidate.id || "", domain],
  );
  const companyId = company[0]?.id || crypto.randomUUID();
  await query(
    `insert into sales_companies(id,workspace,name,domain,website,city,industry,phone,source,source_id,lat,lng,research_status,latest_score,metadata)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'complete',$13,$14::jsonb)
     on conflict(id) do update set name=excluded.name,domain=excluded.domain,website=excluded.website,city=excluded.city,industry=excluded.industry,phone=excluded.phone,research_status='complete',latest_score=excluded.latest_score,metadata=excluded.metadata,updated_at=now()`,
    [companyId, workspace, candidate.company, domain, website, candidate.city || "", candidate.industry || "", contact.phone || candidate.phone || "", candidate.source || "google-places", candidate.id || "", candidate.lat ?? null, candidate.lng ?? null, scores.priorityScore, JSON.stringify({ signals })],
  );

  const contactEmail = contact.email || candidate.email || "";
  const contactPhone = contact.phone || candidate.phone || "";
  const existingContact = await query<{ id: string }>(
    `select id from sales_contacts where workspace=$1 and company_id=$2 and ((email<>'' and email=$3) or is_primary=true) order by is_primary desc limit 1`,
    [workspace, companyId, contactEmail],
  );
  const contactId = existingContact[0]?.id || crypto.randomUUID();
  await query(
    `insert into sales_contacts(id,workspace,company_id,name,email,phone,linkedin,instagram,is_primary,source,metadata)
     values($1,$2,$3,$4,$5,$6,$7,$8,true,'public-website',$9::jsonb)
     on conflict(id) do update set name=excluded.name,email=excluded.email,phone=excluded.phone,linkedin=excluded.linkedin,instagram=excluded.instagram,is_primary=true,metadata=excluded.metadata,updated_at=now()`,
    [contactId, workspace, companyId, candidate.contact || "", contactEmail, contactPhone, contact.linkedin || "", contact.instagram || "", JSON.stringify({ emails: contact.emails || [], phones: contact.phones || [], contactPage: contact.contactPage || "", pagesScanned: contact.pagesScanned || 0 })],
  );

  const existingLead = await query<{ id: string }>(
    `select id from sales_leads where workspace=$1 and company_id=$2 and status='active' limit 1`,
    [workspace, companyId],
  );
  const leadId = existingLead[0]?.id || crypto.randomUUID();
  const summary = audit?.sales?.opportunitySummary || (candidate.website ? "Website automatisch analysiert." : "Unternehmen ohne erkannte Website – hoher Website-Akquisehebel.");
  await query(
    `insert into sales_leads(id,workspace,company_id,contact_id,stage,status,intent_score,fit_score,opportunity_score,priority_score,notes)
     values($1,$2,$3,$4,'Neu','active',$5,$6,$7,$8,$9)
     on conflict(id) do update set contact_id=excluded.contact_id,fit_score=excluded.fit_score,opportunity_score=excluded.opportunity_score,priority_score=excluded.priority_score,notes=excluded.notes,updated_at=now()`,
    [leadId, workspace, companyId, contactId, scores.intentScore, scores.fitScore, scores.opportunityScore, scores.priorityScore, summary],
  );

  const researchId = crypto.randomUUID();
  await query(
    `insert into sales_research_runs(id,workspace,company_id,website_score,contact_score,fit_score,opportunity_score,priority_score,signals,audit,contact,summary)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12)`,
    [researchId, workspace, companyId, scores.websiteScore, scores.contactScore, scores.fitScore, scores.opportunityScore, scores.priorityScore, JSON.stringify(signals), JSON.stringify(audit || {}), JSON.stringify(contact || {}), summary],
  );
  await query(
    `insert into sales_activities(workspace,lead_id,company_id,type,summary,meta)
     values($1,$2,$3,'research.completed',$4,$5::jsonb)`,
    [workspace, leadId, companyId, `Research abgeschlossen · Priority ${scores.priorityScore}/100`, JSON.stringify({ scores, signals, researchId })],
  );

  return { companyId, contactId, leadId, researchId, scores, signals, summary, website, domain };
}

export async function getSalesOverview(workspace = "default") {
  await ensureSalesOsSchema();
  const [stats] = await query<{ companies: number; leads: number; hot: number; avg_priority: number }>(
    `select
      (select count(*)::int from sales_companies where workspace=$1) as companies,
      count(*)::int as leads,
      count(*) filter(where priority_score>=70)::int as hot,
      coalesce(round(avg(priority_score)),0)::int as avg_priority
     from sales_leads where workspace=$1 and status='active'`,
    [workspace],
  );
  const leads = await query<{
    id: string; company: string; city: string; industry: string; website: string; email: string; phone: string;
    stage: string; priority_score: number; fit_score: number; opportunity_score: number; intent_score: number; updated_at: string;
  }>(
    `select l.id,c.name as company,c.city,c.industry,c.website,coalesce(ct.email,'') as email,coalesce(ct.phone,c.phone,'') as phone,
            l.stage,l.priority_score,l.fit_score,l.opportunity_score,l.intent_score,l.updated_at
     from sales_leads l
     join sales_companies c on c.id=l.company_id
     left join sales_contacts ct on ct.id=l.contact_id
     where l.workspace=$1 and l.status='active'
     order by l.priority_score desc,l.updated_at desc limit 25`,
    [workspace],
  );
  const activities = await query<{ id: number; type: string; summary: string; lead_id: string; created_at: string }>(
    `select id,type,summary,lead_id,created_at from sales_activities where workspace=$1 order by created_at desc limit 20`,
    [workspace],
  );
  return { stats: stats || { companies: 0, leads: 0, hot: 0, avg_priority: 0 }, leads, activities };
}

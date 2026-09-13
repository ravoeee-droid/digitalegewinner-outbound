import { query } from "./db";

export const DAILY_QUALITY_TARGET = 120;
export const DAILY_QUALITY_BUFFER_TARGET = 240;
export const QUALITY_FRESH_DAYS = 7;

export type DailyQualityLead = {
  leadId: string;
  companyId: string;
  company: string;
  city: string;
  website: string;
  domain: string;
  email: string;
  phone: string;
  priorityScore: number;
  checkedAt: string;
  relevantOpenJobs: number;
  latestPublishedAt: string;
  jobTitles: string[];
  websiteReasons: string[];
  websiteScores: Record<string, number>;
  proof: string[];
};

export type DailyQualityReport = {
  target: number;
  bufferTarget: number;
  ready: number;
  availableToday: number;
  reserveReady: number;
  deficit: number;
  bufferDeficit: number;
  daysOfCoverage: number;
  status: "green" | "yellow" | "red";
  generatedAt: string;
  gateVersion: 3;
  funnel: {
    activeCandidates: number;
    legacyAPlus: number;
    unqualified: number;
    unqualifiedWithPhoneAndWebsite: number;
    unqualifiedWithEmailAndWebsite: number;
    strictReady: number;
  };
  leads: DailyQualityLead[];
  gate: string[];
};

type QualityRow = {
  lead_id: string;
  company_id: string;
  company: string;
  city: string;
  website: string;
  domain: string;
  email: string;
  phone: string;
  priority_score: number | string;
  checked_at: string;
  relevant_open_jobs: number | string;
  latest_published_at: string;
  job_titles: unknown;
  website_reasons: unknown;
  website_scores: unknown;
};

type FunnelRow = {
  active_candidates: number | string;
  legacy_a_plus: number | string;
  unqualified: number | string;
  unqualified_phone_website: number | string;
  unqualified_email_website: number | string;
  strict_ready: number | string;
};

const ICP_SQL = `lower(c.name||' '||coalesce(c.industry,'')) ~ '(pflegedienst|ambulant|ambulatory_care|sozialstation|diakoniestation|häuslich|haeuslich|krankenpflege|intensivpflege|pflegeteam|home care|home health)'
  and lower(c.name) !~ '(pflegeheim|altenheim|seniorenheim|seniorenzentrum|seniorenresidenz|pflegezentrum|wohn-? und pflege|wohnpark|tagespflege|hospiz|krankenhaus|klinik|psychiatr|recrut|recruit|zeitarbeit|personaldienst|personalservice|arbeitnehmerüberlass|arbeitnehmerueberlass|arbeitsvermittlung|personalvermittlung|staffing|fußpflege|fusspflege|textilpflege|fahrzeugpflege|kosmetik|sanitätshaus|sanitaetshaus)'`;

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function toNumberRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, Number(item || 0)]),
  );
}

function statusFor(ready: number): DailyQualityReport["status"] {
  if (ready >= DAILY_QUALITY_BUFFER_TARGET) return "green";
  if (ready >= DAILY_QUALITY_TARGET) return "yellow";
  return "red";
}

function strictGateWhere() {
  return `
    c.metadata->'daily_qualification'->>'tier'='A+'
    and coalesce(c.metadata->'daily_qualification'->>'callReady','false')='true'
    and coalesce(c.metadata->'daily_qualification'->>'websiteWeak','false')='true'
    and coalesce(nullif(c.metadata->'daily_qualification'->>'version','')::int,0) >= 3
    and coalesce(nullif(c.metadata->'daily_qualification'->'jobGrowth'->>'relevantOpenJobs','')::int,0) >= 1
    and jsonb_typeof(c.metadata->'daily_qualification'->'websiteReason')='array'
    and jsonb_array_length(c.metadata->'daily_qualification'->'websiteReason') >= 1
    and coalesce(c.website,'') <> ''
    and coalesce(ct.email,'') <> ''
    and coalesce(ct.phone,c.phone,'') <> ''
    and l.last_contact_at is null
    and l.stage in ('Neu','Research','Bereit')
    and not l.do_not_contact
    and l.phone_status <> 'invalid'
    and (c.metadata->'daily_qualification'->>'checkedAt')::timestamptz >= now() - interval '${QUALITY_FRESH_DAYS} days'
    and ${ICP_SQL}
  `;
}

export async function getDailyQualityLeadReport(limit = DAILY_QUALITY_TARGET): Promise<DailyQualityReport> {
  const safeLimit = Math.max(1, Math.min(DAILY_QUALITY_TARGET, Math.round(limit || DAILY_QUALITY_TARGET)));
  const strictWhere = strictGateWhere();

  const [funnel] = await query<FunnelRow>(`
    with strict_ranked as (
      select
        l.id,
        row_number() over (
          partition by coalesce(nullif(lower(c.domain),''), lower(c.name)||'|'||lower(c.city))
          order by coalesce(nullif(c.metadata->'daily_qualification'->>'priorityScore','')::numeric,l.priority_score,0) desc,l.updated_at desc
        ) rn
      from sales_companies c
      join sales_leads l on l.company_id=c.id and l.workspace=c.workspace and l.status='active'
      left join sales_contacts ct on ct.id=l.contact_id
      where c.workspace='default' and ${strictWhere}
    )
    select
      count(*) filter(where l.status='active' and l.last_contact_at is null and ${ICP_SQL})::int active_candidates,
      count(*) filter(where l.status='active' and c.metadata->'daily_qualification'->>'tier'='A+' and ${ICP_SQL})::int legacy_a_plus,
      count(*) filter(where l.status='active' and c.metadata->'daily_qualification' is null and ${ICP_SQL})::int unqualified,
      count(*) filter(where l.status='active' and c.metadata->'daily_qualification' is null and coalesce(ct.phone,c.phone,'')<>'' and coalesce(c.website,'')<>'' and ${ICP_SQL})::int unqualified_phone_website,
      count(*) filter(where l.status='active' and c.metadata->'daily_qualification' is null and coalesce(ct.email,'')<>'' and coalesce(c.website,'')<>'' and ${ICP_SQL})::int unqualified_email_website,
      (select count(*) from strict_ranked where rn=1)::int strict_ready
    from sales_companies c
    join sales_leads l on l.company_id=c.id and l.workspace=c.workspace
    left join sales_contacts ct on ct.id=l.contact_id
    where c.workspace='default'
  `);

  const rows = await query<QualityRow>(`
    with ranked as (
      select
        l.id lead_id,c.id company_id,c.name company,c.city,c.website,c.domain,
        coalesce(ct.email,'') email,
        coalesce(ct.phone,c.phone,'') phone,
        coalesce(nullif(c.metadata->'daily_qualification'->>'priorityScore','')::numeric,l.priority_score,0) priority_score,
        c.metadata->'daily_qualification'->>'checkedAt' checked_at,
        coalesce(nullif(c.metadata->'daily_qualification'->'jobGrowth'->>'relevantOpenJobs','')::int,0) relevant_open_jobs,
        coalesce(c.metadata->'daily_qualification'->'jobGrowth'->>'latestPublishedAt','') latest_published_at,
        coalesce((select jsonb_agg(role->>'title') from jsonb_array_elements(coalesce(c.metadata->'daily_qualification'->'jobGrowth'->'roles','[]'::jsonb)) role where coalesce(role->>'title','')<>''),'[]'::jsonb) job_titles,
        coalesce(c.metadata->'daily_qualification'->'websiteReason','[]'::jsonb) website_reasons,
        coalesce(c.metadata->'daily_qualification'->'websiteScores','{}'::jsonb) website_scores,
        row_number() over (
          partition by coalesce(nullif(lower(c.domain),''), lower(c.name)||'|'||lower(c.city))
          order by coalesce(nullif(c.metadata->'daily_qualification'->>'priorityScore','')::numeric,l.priority_score,0) desc,l.updated_at desc
        ) rn
      from sales_companies c
      join sales_leads l on l.company_id=c.id and l.workspace=c.workspace and l.status='active'
      left join sales_contacts ct on ct.id=l.contact_id
      where c.workspace='default' and ${strictWhere}
    )
    select lead_id,company_id,company,city,website,domain,email,phone,priority_score,checked_at,relevant_open_jobs,latest_published_at,job_titles,website_reasons,website_scores
    from ranked
    where rn=1
    order by priority_score desc, relevant_open_jobs desc, checked_at desc
    limit $1
  `, [safeLimit]);

  const leads = rows.map((row) => {
    const websiteReasons = toStringArray(row.website_reasons);
    const jobTitles = toStringArray(row.job_titles);
    const jobs = Number(row.relevant_open_jobs || 0);
    return {
      leadId: row.lead_id,
      companyId: row.company_id,
      company: row.company,
      city: row.city,
      website: row.website,
      domain: row.domain,
      email: row.email,
      phone: row.phone,
      priorityScore: Math.round(Number(row.priority_score || 0)),
      checkedAt: row.checked_at,
      relevantOpenJobs: jobs,
      latestPublishedAt: row.latest_published_at,
      jobTitles,
      websiteReasons,
      websiteScores: toNumberRecord(row.website_scores),
      proof: [
        `${jobs} bestätigte offene Pflege-Stelle${jobs === 1 ? "" : "n"}`,
        ...websiteReasons,
        "E-Mail vorhanden",
        "Telefon vorhanden",
        "Firmentyp hart geprüft",
        "Firma/Dublette geprüft",
      ],
    } satisfies DailyQualityLead;
  });

  const ready = Number(funnel?.strict_ready || leads.length || 0);
  const availableToday = Math.min(DAILY_QUALITY_TARGET, ready);
  const reserveReady = Math.max(0, ready - DAILY_QUALITY_TARGET);
  return {
    target: DAILY_QUALITY_TARGET,
    bufferTarget: DAILY_QUALITY_BUFFER_TARGET,
    ready,
    availableToday,
    reserveReady,
    deficit: Math.max(0, DAILY_QUALITY_TARGET - ready),
    bufferDeficit: Math.max(0, DAILY_QUALITY_BUFFER_TARGET - ready),
    daysOfCoverage: Number((ready / DAILY_QUALITY_TARGET).toFixed(2)),
    status: statusFor(ready),
    generatedAt: new Date().toISOString(),
    gateVersion: 3,
    funnel: {
      activeCandidates: Number(funnel?.active_candidates || 0),
      legacyAPlus: Number(funnel?.legacy_a_plus || 0),
      unqualified: Number(funnel?.unqualified || 0),
      unqualifiedWithPhoneAndWebsite: Number(funnel?.unqualified_phone_website || 0),
      unqualifiedWithEmailAndWebsite: Number(funnel?.unqualified_email_website || 0),
      strictReady: ready,
    },
    leads,
    gate: [
      "Firmentyp hart als ambulanter Pflegedienst bestätigt (kein Recruiter, Heim, Klinik oder Psychiatrie)",
      "Mindestens eine aktuell bestätigte Pflege-Stelle",
      "Erreichbare Website vorhanden",
      "Website-Audit belegt mindestens ein konkretes Problem",
      "Öffentliche E-Mail-Adresse für Loom-Outreach vorhanden",
      "Telefonnummer für Follow-up vorhanden",
      "Noch nicht kontaktiert / nicht gesperrt",
      `Qualifizierung maximal ${QUALITY_FRESH_DAYS} Tage alt`,
      "Dedupliziert nach Domain bzw. Firma + Ort",
      "Kein Auffüllen mit A/B/C-Leads",
      `Tagesziel ${DAILY_QUALITY_TARGET}; Sicherheitsbestand ${DAILY_QUALITY_BUFFER_TARGET}`,
    ],
  };
}

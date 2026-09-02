import { query } from "./db";
import { ensureSalesOsSchema } from "./sales-os";

type Candidate = {
  company_id: string;
  company: string;
  website: string;
  metadata: Record<string, unknown>;
};

type EnrichmentResult = {
  companyId: string;
  url: string;
  ok: boolean;
  error?: string;
  signals?: Record<string, unknown>;
};

function workerConfig() {
  return {
    url: (process.env.SCRAPLING_WORKER_URL || "").replace(/\/$/, ""),
    secret: process.env.SCRAPLING_WORKER_SECRET || "",
  };
}

export function getScraplingStatus() {
  const config = workerConfig();
  return { configured: Boolean(config.url), source: "D4Vinci/Scrapling" };
}

export async function enrichLeadsWithScrapling(limit = 12, workspace = "default") {
  await ensureSalesOsSchema();
  const config = workerConfig();
  if (!config.url) {
    return { ok: false, configured: false, enriched: 0, error: "SCRAPLING_WORKER_URL fehlt." };
  }

  const safeLimit = Math.max(1, Math.min(25, Math.round(limit)));
  const rows = await query<Candidate>(`
    select c.id company_id,c.name company,c.website,c.metadata
    from sales_companies c
    join sales_leads l on l.company_id=c.id and l.workspace=c.workspace and l.status='active'
    where c.workspace=$1
      and coalesce(c.website,'')<>''
      and coalesce(l.do_not_contact,false)=false
      and (
        c.metadata->'scrapling_enrichment' is null
        or coalesce(c.metadata->'scrapling_enrichment'->>'checkedAt','')=''
        or (c.metadata->'scrapling_enrichment'->>'checkedAt')::timestamptz < now() - interval '14 days'
      )
    order by l.priority_score desc,c.updated_at asc
    limit $2
  `, [workspace, safeLimit]);

  if (!rows.length) return { ok: true, configured: true, requested: 0, enriched: 0, results: [] };

  const response = await fetch(`${config.url}/v1/enrich`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(config.secret ? { authorization: `Bearer ${config.secret}` } : {}),
    },
    body: JSON.stringify({
      targets: rows.map((row) => ({ companyId: row.company_id, company: row.company, url: row.website })),
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Scrapling Worker ${response.status}: ${body.slice(0, 400)}`);
  }

  const payload = await response.json() as { results?: EnrichmentResult[] };
  const results = Array.isArray(payload.results) ? payload.results : [];
  let enriched = 0;

  for (const item of results) {
    if (!item?.companyId || !item.ok || !item.signals) continue;
    await query(
      `update sales_companies
       set metadata=metadata || jsonb_build_object(
         'scrapling_enrichment',
         $3::jsonb || jsonb_build_object('checkedAt',now()::text,'source','scrapling')
       ),updated_at=now()
       where id=$1 and workspace=$2`,
      [item.companyId, workspace, JSON.stringify(item.signals)],
    );
    enriched += 1;
  }

  return { ok: true, configured: true, requested: rows.length, enriched, results };
}

import { query } from "@/lib/db";
import { POST as runEnrichment } from "@/app/api/crm/enrichment/route";

export const runtime = "nodejs";
export const maxDuration = 300;

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET;
  return Boolean(expected && (request.headers.get("authorization") || "") === `Bearer ${expected}`);
}

type Candidate = {
  lead_id: string;
  company_id: string;
};

async function run(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const candidates = await query<Candidate>(`
      select l.id lead_id, l.company_id
      from sales_leads l
      join sales_companies c on c.id=l.company_id and c.workspace=l.workspace
      left join sales_contacts ct on ct.id=l.contact_id and ct.workspace=l.workspace
      where l.workspace='default'
        and l.status='active'
        and coalesce(l.do_not_contact,false)=false
        and l.stage not in ('Termin','Angebot','Verhandlung','Gewonnen','Verloren')
        and (
          coalesce(ct.name,'')=''
          or coalesce(ct.phone,c.phone,'')=''
          or coalesce(jsonb_array_length(coalesce(c.metadata->'enrichment'->'jobTitles','[]'::jsonb)),0)=0
          or (
            coalesce(jsonb_array_length(coalesce(c.metadata->'enrichment'->'jobTitles','[]'::jsonb)),0)>0
            and coalesce(jsonb_array_length(coalesce(c.metadata->'enrichment'->'jobOpenings','[]'::jsonb)),0)=0
          )
        )
        and (
          c.metadata->>'call_enrichment_attempt_at' is null
          or (c.metadata->>'call_enrichment_attempt_at')::timestamptz < now() - interval '12 hours'
        )
      order by
        case when coalesce(ct.phone,c.phone,'')='' then 0 else 1 end,
        case when coalesce(ct.name,'')='' then 0 else 1 end,
        case when coalesce(jsonb_array_length(coalesce(c.metadata->'enrichment'->'jobTitles','[]'::jsonb)),0)=0 then 0 else 1 end,
        l.priority_score desc,
        l.updated_at desc
      limit 12
    `);

    if (!candidates.length) {
      return Response.json({ ok: true, processed: 0, reason: "nothing_to_enrich" });
    }

    let processed = 0;
    let succeeded = 0;
    let failed = 0;
    const errors: Array<{ leadId: string; error: string }> = [];

    for (let i = 0; i < candidates.length; i += 3) {
      const batch = candidates.slice(i, i + 3);
      const body = { leadIds: batch.map((item) => item.lead_id), ai: true };
      const response = await runEnrichment(new Request("http://internal/api/crm/enrichment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }));
      const json = await response.json() as { results?: Array<{ ok?: boolean; leadId?: string; error?: string }> };
      const results = json.results || [];

      for (const item of batch) {
        processed++;
        const result = results.find((entry) => entry.leadId === item.lead_id);
        if (result?.ok) succeeded++;
        else {
          failed++;
          errors.push({ leadId: item.lead_id, error: result?.error || "Enrichment fehlgeschlagen" });
        }
        await query(
          `update sales_companies
             set metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object('call_enrichment_attempt_at', now()::text),
                 updated_at=now()
           where id=$1 and workspace='default'`,
          [item.company_id],
        );
      }
    }

    return Response.json({ ok: failed === 0, processed, succeeded, failed, errors });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Bulk enrichment failed" }, { status: 500 });
  }
}

export async function GET(request: Request) { return run(request); }
export async function POST(request: Request) { return run(request); }

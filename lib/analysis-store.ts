import { query } from "@/lib/db";
import { analysisPdf } from "@/lib/analysis-pdf";
import { buildAnalysis } from "@/lib/competitor-analysis";
import { videoToken } from "@/lib/email-tracking";

// Wettbewerbsanalyse (PDF) für den Termin eines Leads: wird erstellt, in der Datenbank abgelegt und 30 Tage wiederverwendet.
export async function ensureAnalysisPdf(leadId: string) {
  await query("create table if not exists lead_analyses (lead_id text primary key, pdf bytea not null, created_at timestamptz not null default now())");
  const [cached] = await query<{ pdf: Buffer }>("select pdf from lead_analyses where lead_id=$1 and created_at>now()-interval '30 days'", [leadId]).catch(() => []);
  if (cached?.pdf) return cached.pdf;
  const analysis = await buildAnalysis(leadId);
  if (!analysis) return null;
  const pdf = await analysisPdf(analysis);
  await query("insert into lead_analyses(lead_id,pdf) values($1,$2) on conflict (lead_id) do update set pdf=excluded.pdf, created_at=now()", [leadId, pdf]).catch(() => null);
  return pdf;
}

export function analysisUrl(leadId: string) {
  const configured = (process.env.NEXT_PUBLIC_APP_URL || "").trim().replace(/\/+$/, "");
  const origin = /^https:\/\/[^\s/]+$/i.test(configured) ? configured : "https://app.digitalegewinner.de";
  return `${origin}/api/t/analyse/${encodeURIComponent(videoToken(leadId))}`;
}

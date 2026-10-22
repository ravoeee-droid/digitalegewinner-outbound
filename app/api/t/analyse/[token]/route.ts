import { query } from "@/lib/db";
import { verifyVideoToken } from "@/lib/email-tracking";
import { ensureAnalysisPdf } from "@/lib/analysis-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Wettbewerbsanalyse als PDF für den Termin (nur mit gültigem Link; wird beim ersten Abruf erstellt).
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const leadId = verifyVideoToken(decodeURIComponent(token));
  if (!leadId) return new Response("Not found", { status: 404 });
  const pdf = await ensureAnalysisPdf(leadId);
  if (!pdf) return new Response("Für diesen Betrieb liegt keine Analyse vor (keine Website bekannt).", { status: 404 });
  await query("insert into er_events(workspace,lead_id,type,meta) values('default',$1,'analyse_open','{}'::jsonb)", [leadId]).catch(() => null);
  return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": "inline; filename=\"Wettbewerbsanalyse.pdf\"", "cache-control": "private, max-age=3600" } });
}

import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

// Setzt noch ungesendete Erstmails (Text A/B/D) zurück, damit die Warteschlange sie mit der aktuellen Textverteilung neu einreiht.
// Betroffen sind nur Leads, bei denen noch nichts gesendet wurde. Varianten V (Video) und C (ohne Stelle) bleiben unverändert.
// Login über den Admin-Cookie (proxy.ts). Ohne ?run=1 nur Vorschau.
export async function GET(request: Request) {
  const run = new URL(request.url).searchParams.get("run") === "1";
  const where = `
    workspace='default' and status='queued' and variant in ('A','B','D')
    and lead_id in (
      select lead_id from er_outbox where workspace='default' and campaign_id in ('pflege-starter-v2','pv-starter-v1')
      group by lead_id having bool_and(status='queued')
    )`;
  const [{ n }] = await query<{ n: number }>(`select count(distinct lead_id)::int n from er_outbox where ${where}`);
  if (!run) return NextResponse.json({ leads: n, hinweis: "Mit ?run=1 ausführen" });
  if (n === 0) {
    const stand = await query("select campaign_id, status, variant, count(*)::int n from er_outbox where workspace='default' and scheduled_at>now()-interval '3 days' group by 1,2,3 order by 1,2,3").catch(() => []);
    return NextResponse.json({ leads: 0, zurueckgesetzt: 0, stand });
  }
  const rows = await query<{ id: string }>(
    `update er_outbox set status='suppressed',error='Neu gerendert (Textvariante E)' where ${where} returning id`,
  );
  return NextResponse.json({ leads: n, zurueckgesetzt: rows.length });
}

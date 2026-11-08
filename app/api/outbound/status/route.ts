import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Nur lesender Klartext-Bericht zur E-Mail-/Loom-Strecke (letzte Tage). Geschützt durch den Admin-Login der App.
async function safe<T>(label: string, run: () => Promise<T>): Promise<{ ok: true; v: T } | { ok: false; label: string; error: string }> {
  try { return { ok: true, v: await run() }; } catch (e) { return { ok: false, label, error: e instanceof Error ? e.message : "Fehler" }; }
}

export async function GET() {
  const lines: string[] = [];
  const fail = (r: { label: string; error: string }) => lines.push(`  [nicht abrufbar: ${r.label} – ${r.error}]`);

  const outbox = await safe("Versand", () => query<{ campaign_id: string; d: string; status: string; n: number }>(
    `select coalesce(campaign_id,'(ohne)') campaign_id, (coalesce(sent_at,scheduled_at) at time zone 'Europe/Berlin')::date::text d, status, count(*)::int n
     from er_outbox where workspace='default' and coalesce(sent_at,scheduled_at) >= now()-interval '8 days' group by 1,2,3 order by 2 desc,1,3`));
  lines.push("VERSAND (letzte 8 Tage, Berliner Datum)");
  if (!outbox.ok) fail(outbox); else if (!outbox.v.length) lines.push("  keine Einträge");
  else for (const r of outbox.v) lines.push(`  ${r.d}  ${r.campaign_id.padEnd(22)} ${r.status.padEnd(10)} ${r.n}`);

  const events = await safe("Ereignisse", () => query<{ type: string; n: number; leads: number }>(
    `select type, count(*)::int n, count(distinct lead_id)::int leads from er_events where workspace='default' and created_at >= now()-interval '7 days' group by 1 order by 2 desc limit 25`));
  lines.push("", "EREIGNISSE (letzte 7 Tage: Ereignisse / verschiedene Leads)");
  if (!events.ok) fail(events); else if (!events.v.length) lines.push("  keine Einträge");
  else for (const r of events.v) lines.push(`  ${r.type.padEnd(28)} ${String(r.n).padStart(5)} / ${r.leads}`);

  const rate = await safe("Bounce-Quote", () => query<{ sent: number; bounced: number }>(
    `select (select count(*)::int from er_outbox where workspace='default' and status='sent' and sent_at >= now()-interval '7 days') sent,
            (select count(distinct lead_id)::int from er_events where workspace='default' and type='bounce' and created_at >= now()-interval '7 days') bounced`));
  lines.push("", "BOUNCES");
  if (!rate.ok) fail(rate); else { const { sent, bounced } = rate.v[0]; lines.push(`  ${bounced} Bounces bei ${sent} versendeten Mails in 7 Tagen = ${sent ? ((bounced / sent) * 100).toFixed(1) : "0.0"} % (über 2 % ist kritisch)`); }

  const appts = await safe("Termine", () => query<{ d: string; n: number }>(
    `select (created_at at time zone 'Europe/Berlin')::date::text d, count(*)::int n from er_events where workspace='default' and type='appointment' and created_at >= now()-interval '14 days' group by 1 order by 1 desc`));
  lines.push("", "TERMINE (er_events 'appointment', letzte 14 Tage)");
  if (!appts.ok) fail(appts); else if (!appts.v.length) lines.push("  keine bestätigten Termine erfasst"); else for (const r of appts.v) lines.push(`  ${r.d}  ${r.n}`);

  const perm = await safe("Berechtigungen", () => query<{ n: number }>(`select count(*)::int n from outbound_contact_permissions`));
  const supp = await safe("Sperrliste", () => query<{ reason: string; n: number }>(`select reason, count(*)::int n from er_suppressions where workspace='default' group by 1 order by 2 desc`));
  lines.push("", "COMPLIANCE");
  if (!perm.ok) fail(perm); else lines.push(`  dokumentierte E-Mail-Berechtigungen: ${perm.v[0].n}${perm.v[0].n === 0 ? "  <- der Versand-Worker stoppt ohne Freigabe" : ""}`);
  if (!supp.ok) fail(supp); else lines.push(`  Sperrliste: ${supp.v.map((r) => `${r.reason} ${r.n}`).join(", ") || "leer"}`);

  const queued = await safe("Offene Mails", () => query<{ status: string; n: number; next: string | null }>(
    `select status, count(*)::int n, min(scheduled_at)::text next from er_outbox where workspace='default' and status in ('queued','draft','sending','failed') group by 1 order by 1`));
  lines.push("", "OFFEN / PROBLEME (alle Zeiten)");
  if (!queued.ok) fail(queued); else if (!queued.v.length) lines.push("  nichts offen"); else for (const r of queued.v) lines.push(`  ${r.status.padEnd(9)} ${r.n}${r.next ? `  (frühester Termin ${r.next})` : ""}`);

  return new Response(lines.join("\n"), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}

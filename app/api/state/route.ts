import { readState, writeState } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    const row = await readState();
    return Response.json({ state: row?.payload ?? null, version: row?.version ?? 0, updatedAt: row?.updated_at ?? null });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Datenbank nicht erreichbar." }, { status: 503 });
  }
}

export async function PUT(request: Request) {
  try {
    const payload = await request.json();
    if (!payload || typeof payload !== "object") return Response.json({ error: "Ungültiger State." }, { status: 400 });
    // "leads" inside this JSON blob is a server-maintained mirror of sales_leads (see
    // crm/launch's mirrorToLegacy). The browser only has whatever snapshot it loaded at
    // page mount, so if we wrote payload.leads verbatim here, saving campaigns/mailboxes/
    // settings from a stale tab would silently undo any sales_leads changes (reply-cron
    // intent bumps, stage moves, etc.) that happened since. Never let a client PUT touch it.
    const { leads: _ignoredLeads, ...clientState } = payload as Record<string, unknown>;
    const current = (await readState())?.payload as Record<string, unknown> | undefined;
    const merged = { ...(current || {}), ...clientState };
    const row = await writeState(merged);
    return Response.json({ ok: true, version: row.version, updatedAt: row.updated_at });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "State konnte nicht gespeichert werden." }, { status: 503 });
  }
}

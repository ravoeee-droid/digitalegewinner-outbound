import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { query, readStateFields } from "@/lib/db";
import { adminCookieName, sessionRole } from "@/lib/admin-auth";
import { loadMailboxCredentials } from "@/lib/mailbox-credentials";
import { DG_MAILBOX_EMAILS } from "@/lib/dg-mailboxes";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Einmalig: ungesendete Loom-Drafts/-Queue-Einträge, die einem Nicht-DG-Postfach (z. B. US) zugewiesen sind,
// auf die deutschen DG-Postfächer umverteilen. Nur Admin-Login. GET = Vorschau + Button, POST = ausführen.
// Nach der Ausführung wird diese Route wieder entfernt.

const CAMPAIGNS = ["pflege-loom-150-v1", "pv-loom-150-v1"];

async function requireAdmin() {
  const store = await cookies();
  return sessionRole(store.get(adminCookieName())?.value) === "admin";
}

async function plan() {
  const creds = await loadMailboxCredentials();
  const dg = new Set<string>(DG_MAILBOX_EMAILS);
  const state = (await readStateFields(["mailboxes"]))?.payload as { mailboxes?: Array<{ email?: string; enabled?: boolean }> } | undefined;
  const enabled = new Map((state?.mailboxes || []).map((m) => [m.email?.toLowerCase(), m.enabled !== false]));
  const target = creds.filter((c) => c.provider === "smtp" && dg.has(c.email?.toLowerCase()) && enabled.get(c.email?.toLowerCase()) !== false);
  const targetIds = new Set(target.map((c) => c.id));
  const rows = await query<{ id: string; mailbox_id: string; status: string }>(
    `select id, mailbox_id, status from er_outbox
     where workspace='default' and status in ('draft','queued') and campaign_id = any($1::text[])
     order by scheduled_at, id`,
    [CAMPAIGNS],
  );
  const wrong = rows.filter((r) => !targetIds.has(r.mailbox_id));
  return { target, total: rows.length, wrong };
}

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { target, total, wrong } = await plan();
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Loom-Postfächer umverteilen</title>
<body style="font-family:system-ui;max-width:560px;margin:48px auto;padding:0 16px">
<h1>Loom-Postfächer umverteilen</h1>
<p>Aktive DE-Postfächer: <b>${target.length}</b> (erwartet 10).</p>
<p>Offene Loom-Einträge: <b>${total}</b>, davon bei Nicht-DG-Postfächern: <b>${wrong.length}</b>.</p>
<form method="post"><button type="submit" style="font-size:18px;padding:12px 20px"${wrong.length && target.length ? "" : " disabled"}>Auf DE-Postfächer umverteilen</button></form>
</body>`;
  return new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

export async function POST() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { target, wrong } = await plan();
  if (!target.length) return NextResponse.json({ error: "Keine aktiven DE-Postfächer gefunden." }, { status: 409 });
  let moved = 0;
  for (let i = 0; i < wrong.length; i++) {
    const rows = await query<{ id: string }>(
      "update er_outbox set mailbox_id=$2 where id=$1 and status in ('draft','queued') returning id",
      [wrong[i].id, target[i % target.length].id],
    );
    moved += rows.length;
  }
  return NextResponse.json({ postfaecher: target.length, umverteilt: moved, geprueft: wrong.length });
}

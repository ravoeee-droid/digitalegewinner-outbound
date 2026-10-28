import { cookies } from "next/headers";
import { adminCookieName, sessionRole } from "@/lib/admin-auth";
import { query, readState, writeState } from "@/lib/db";
import { loadMailboxCredentials } from "@/lib/mailbox-credentials";
import { US_PV_MAILBOX_EMAILS } from "@/lib/us-pv-pilot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const cookie = (await cookies()).get(adminCookieName())?.value;
  if (sessionRole(cookie) !== "admin") return Response.json({ error: "Nur Administratoren dürfen Versandpostfächer zuweisen." }, { status: 403 });
  try {
    const allowed = new Set(US_PV_MAILBOX_EMAILS.map((email) => email.toLowerCase()));
    const credentials = (await loadMailboxCredentials()).filter((mailbox) => allowed.has(mailbox.email.toLowerCase()));
    if (credentials.length !== US_PV_MAILBOX_EMAILS.length) {
      return Response.json({ error: `Nur ${credentials.length} von ${US_PV_MAILBOX_EMAILS.length} US-Postfächern sind verbunden.` }, { status: 409 });
    }
    const mailboxIds = credentials.map((mailbox) => mailbox.id);
    const rows = await query<{ id: string }>(
      `with targets as (
         select id,row_number() over(order by scheduled_at,lead_id,id)-1 as rn
         from er_outbox
         where workspace='default' and campaign_id='us-pv-calculator-pilot-v1' and status='queued'
       )
       update er_outbox o
       set mailbox_id=($1::text[])[(targets.rn % array_length($1::text[],1))+1]
       from targets where o.id=targets.id returning o.id`,
      [mailboxIds],
    );
    const stateRow = await readState("default");
    const state = (stateRow?.payload || {}) as Record<string, unknown>;
    const campaigns = Array.isArray(state.campaigns) ? state.campaigns as Array<Record<string, unknown>> : [];
    await writeState({ ...state, campaigns: campaigns.map((item) => item.id === "us-pv-calculator-pilot-v1" ? { ...item, mailboxEmails: [...US_PV_MAILBOX_EMAILS] } : item) }, "default");
    return Response.json({ ok: true, reassigned: rows.length, mailboxes: mailboxIds.length });
  } catch (error) {
    console.error("[us-pv-pilot-repair-mailboxes]", error);
    return Response.json({ error: error instanceof Error ? error.message : "Postfach-Zuordnung fehlgeschlagen." }, { status: 500 });
  }
}


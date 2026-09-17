import { z } from "zod";
import { query, readState } from "@/lib/db";
import { loadMailboxCredentials } from "@/lib/mailbox-credentials";

export const runtime = "nodejs";

const schema = z.object({ outreachId: z.string().uuid() });

type OutreachRow = { id: string; company_id: string; email: string; subject: string; body: string; status: string };
type Mailbox = { id: string; email?: string; enabled: boolean; dailyLimit: number };
type State = { mailboxes?: Mailbox[] };

export async function POST(request: Request) {
  try {
    const { outreachId } = schema.parse(await request.json());

    const [outreach] = await query<OutreachRow>(
      "select id,company_id,email,subject,body,status from pflege_email_outreach where id=$1",
      [outreachId],
    );
    if (!outreach) return Response.json({ error: "Entwurf nicht gefunden." }, { status: 404 });
    if (outreach.status !== "draft") return Response.json({ error: `Bereits bearbeitet (Status: ${outreach.status}).` }, { status: 409 });
    if (!outreach.email) return Response.json({ error: "Kein Empfänger hinterlegt." }, { status: 409 });

    const [lead] = await query<{ id: string; do_not_contact: boolean }>(
      "select id,do_not_contact from sales_leads where workspace='default' and company_id=$1 and status='active' limit 1",
      [outreach.company_id],
    );
    if (!lead) return Response.json({ error: "Lead noch nicht im CRM - Sync steht aus." }, { status: 409 });
    if (lead.do_not_contact) return Response.json({ error: "Lead ist als 'nicht kontaktieren' markiert." }, { status: 409 });

    const suppressed = await query<{ email: string }>(
      "select email from er_suppressions where workspace='default' and lower(email)=lower($1) limit 1",
      [outreach.email],
    );
    if (suppressed.length) return Response.json({ error: "Empfänger ist auf der Suppression-Liste." }, { status: 409 });

    const campaignTag = `outreach:${outreachId}`;
    const already = await query<{ id: string }>(
      "select id from er_outbox where workspace='default' and campaign_id=$1 and status not in ('failed','suppressed') limit 1",
      [campaignTag],
    );
    if (already.length) return Response.json({ error: "Bereits eingeplant." }, { status: 409 });

    // Real, sendable mailboxes are the ones with verified IMAP/SMTP credentials -
    // state.mailboxes only carries a display label/limit (same fix as campaign launch).
    const credentials = await loadMailboxCredentials();
    const state = ((await readState())?.payload || {}) as State;
    const byEmail = new Map((state.mailboxes || []).map((m) => [m.email?.toLowerCase(), m]));
    const mailbox = credentials
      .filter((c) => c.provider === "smtp")
      .map((c) => ({ id: c.id, enabled: byEmail.get(c.email?.toLowerCase())?.enabled ?? true, dailyLimit: Number(byEmail.get(c.email?.toLowerCase())?.dailyLimit || 5) }))
      .find((m) => m.enabled && m.dailyLimit > 0);
    if (!mailbox) return Response.json({ error: "Keine sendefähige Mailbox verbunden (siehe /mail)." }, { status: 409 });

    await query(
      `insert into er_outbox(id,workspace,campaign_id,lead_id,mailbox_id,recipient,subject,body,scheduled_at)
       values(gen_random_uuid(),'default',$1,$2,$3,$4,$5,$6,now())`,
      [campaignTag, lead.id, mailbox.id, outreach.email, outreach.subject, outreach.body],
    );
    await query("update pflege_email_outreach set status='approved', updated_at=now() where id=$1", [outreachId]);

    return Response.json({ ok: true, queued: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Konnte nicht eingeplant werden." }, { status: 400 });
  }
}

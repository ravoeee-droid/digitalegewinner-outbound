import { query, readState } from "@/lib/db";
import { z } from "zod";

export const runtime = "nodejs";

const schema = z.object({
  leadId: z.string().min(1),
  firstDelayMinutes: z.number().int().min(0).max(1440).default(5),
  secondDelayHours: z.number().int().min(1).max(168).default(24),
});

type Lead = { id:string; company:string; contact?:string; email?:string; stage?:string };
type Mailbox = { id:string; enabled:boolean; dailyLimit:number };
type State = {
  leads?: Lead[];
  mailboxes?: Mailbox[];
  settings?: { senderName?:string; calendarUrl?:string };
};

function render(template:string, lead:Lead, senderName:string, calendarUrl:string) {
  const firstName = String(lead.contact || "").trim().split(/\s+/)[0] || "Guten Tag";
  return template
    .replaceAll("{{first_name}}", firstName)
    .replaceAll("{{company}}", lead.company || "Ihrem Unternehmen")
    .replaceAll("{{sender_name}}", senderName)
    .replaceAll("{{calendar_url}}", calendarUrl || "");
}

export async function POST(request:Request) {
  try {
    const input = schema.parse(await request.json());
    const stateRow = await readState();
    const state = (stateRow?.payload || {}) as State;
    const lead = (state.leads || []).find((item) => item.id === input.leadId);
    if (!lead) return Response.json({ error:"Lead nicht gefunden." }, { status:404 });
    if (!lead.email) return Response.json({ error:"Lead hat keine E-Mail-Adresse." }, { status:409 });

    const suppressed = await query<{ email:string }>(
      "select email from er_suppressions where workspace='default' and lower(email)=lower($1) limit 1",
      [lead.email],
    );
    if (suppressed.length) return Response.json({ error:"Empfänger ist auf der Suppression-Liste." }, { status:409 });

    const active = (state.mailboxes || []).filter((mailbox) => mailbox.enabled && Number(mailbox.dailyLimit || 0) > 0);
    if (!active.length) return Response.json({ error:"Keine aktive Mailbox für das Follow-up." }, { status:409 });

    const sentTodayRows = await query<{ mailbox_id:string; count:string }>(
      "select mailbox_id,count(*)::text as count from er_outbox where workspace='default' and status='sent' and sent_at>=date_trunc('day',now()) group by mailbox_id",
    );
    const sentToday = new Map(sentTodayRows.map((row) => [row.mailbox_id, Number(row.count)]));
    const mailbox = [...active].sort((a,b) => {
      const aUsage = (sentToday.get(a.id) || 0) / Math.max(1, a.dailyLimit);
      const bUsage = (sentToday.get(b.id) || 0) / Math.max(1, b.dailyLimit);
      return aUsage - bUsage;
    })[0];

    const senderName = state.settings?.senderName || "Digitale Gewinner";
    const calendarUrl = state.settings?.calendarUrl || "";
    const campaignId = `noshow:${lead.id}:${Date.now()}`;
    const firstSubject = `Kurze Rückfrage zu unserem Termin`;
    const firstBody = render(
      `Hallo {{first_name}},\n\nich glaube, wir haben uns gerade beim Termin verpasst. Kein Problem.\n\nWenn das Thema für {{company}} weiterhin relevant ist, können wir einfach einen neuen Zeitpunkt finden.${calendarUrl ? "\n\nHier geht es direkt zum Kalender: {{calendar_url}}" : ""}\n\nViele Grüße\n{{sender_name}}`,
      lead,
      senderName,
      calendarUrl,
    );
    const secondSubject = `Re: Kurze Rückfrage zu unserem Termin`;
    const secondBody = render(
      `Hallo {{first_name}},\n\nnur noch einmal kurz wegen unseres verpassten Termins: Soll ich das Thema vorerst schließen oder wollen wir einen neuen Termin finden?${calendarUrl ? "\n\nFalls ja: {{calendar_url}}" : ""}\n\nViele Grüße\n{{sender_name}}`,
      lead,
      senderName,
      calendarUrl,
    );

    const firstAt = new Date(Date.now() + input.firstDelayMinutes * 60_000);
    const secondAt = new Date(Date.now() + input.secondDelayHours * 3_600_000);
    await query(
      `insert into er_outbox(id,workspace,campaign_id,lead_id,mailbox_id,recipient,subject,body,variant,scheduled_at)
       values($1,'default',$2,$3,$4,$5,$6,$7,'NOSHOW-1',$8),
             ($9,'default',$2,$3,$4,$5,$10,$11,'NOSHOW-2',$12)`,
      [crypto.randomUUID(),campaignId,lead.id,mailbox.id,lead.email,firstSubject,firstBody,firstAt,crypto.randomUUID(),secondSubject,secondBody,secondAt],
    );
    await query(
      "insert into er_events(workspace,lead_id,type,meta) values('default',$1,'appointment_no_show',$2::jsonb)",
      [lead.id, JSON.stringify({ email:lead.email, mailboxId:mailbox.id, campaignId, firstAt:firstAt.toISOString(), secondAt:secondAt.toISOString() })],
    );

    return Response.json({ ok:true, queued:2, mailboxId:mailbox.id, firstAt:firstAt.toISOString(), secondAt:secondAt.toISOString() });
  } catch (error) {
    return Response.json({ error:error instanceof Error ? error.message : "No-Show Follow-up konnte nicht angelegt werden." }, { status:400 });
  }
}

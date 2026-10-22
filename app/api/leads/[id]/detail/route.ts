import { query } from "@/lib/db";
import { videoPageUrl, videoToken } from "@/lib/email-tracking";
import { resolveSlots } from "@/lib/outreach-copy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Item = { at: string; kind: "mail" | "reply" | "event"; title: string; detail?: string; body?: string; status?: string };

const EVENT_LABELS: Record<string, string> = {
  email_open: "Mail geöffnet", email_click: "Link in der Mail geklickt", reply: "Antwort erhalten", appointment: "Termin gebucht",
  video_view: "Videoseite geöffnet", video_play: "Video gestartet", video_calendar_focus: "Kalender angeklickt", video_booking_click: "Klick auf „Termin buchen“",
  video_chat: "Chat-Frage gestellt", video_chat_open: "Chat geöffnet", video_whatsapp_click: "WhatsApp-Button geklickt", whatsapp_click: "WhatsApp-Button geklickt",
  site_view: "Website besucht", site_click: "Auf der Website geklickt", analyse_open: "Analyse-PDF geöffnet", unsubscribe: "Abgemeldet",
};

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const origin = new URL(request.url).origin;
  const [lead] = await query<{ id: string; stage: string; do_not_contact: boolean; next_action: string | null; company: string; city: string; website: string; source: string; contact: string; email: string; phone: string }>(
    `select l.id::text id, l.stage, coalesce(l.do_not_contact,false) do_not_contact, l.next_action, c.name company, coalesce(c.city,'') city,
            coalesce(nullif(c.website,''),c.domain,'') website, coalesce(c.source,'') source,
            coalesce(k.name,'') contact, coalesce(k.email,'') email, coalesce(nullif(k.phone,''),c.phone,'') phone
     from sales_leads l join sales_companies c on c.id=l.company_id and c.workspace=l.workspace
     left join lateral (select * from sales_contacts k where k.company_id=c.id and k.workspace=l.workspace order by (coalesce(k.email,'')<>'') desc, k.is_primary desc limit 1) k on true
     where l.workspace='default' and l.id::text=$1`, [id],
  ).catch(() => []);
  if (!lead) return Response.json({ error: "Lead nicht gefunden." }, { status: 404 });

  const mails = await query<{ subject: string; body: string; status: string; scheduled_at: string; sent_at: string | null; variant: string; error: string | null }>(
    "select subject, body, status, scheduled_at::text, sent_at::text, coalesce(variant,'') variant, error from er_outbox where workspace='default' and lead_id::text=$1 order by scheduled_at", [id],
  ).catch(() => []);
  const replies = await query<{ subject: string; body_text: string; at: string }>(
    `select m.subject, m.body_text, coalesce(m.received_at,m.created_at)::text at from outbound_conversation_messages m
     join outbound_conversation_threads t on t.id=m.thread_id where t.lead_id::text=$1 and m.direction='inbound' order by 3`, [id],
  ).catch(() => []);
  const events = await query<{ type: string; meta: Record<string, unknown>; at: string }>(
    `select type, meta, created_at::text at from er_events where workspace='default' and lead_id=$1 and coalesce(meta->>'bot','false')='false'
       and (type in ('email_open','email_click','reply','appointment','analyse_open','unsubscribe') or type like 'video\\_%' or type like 'site\\_%' or type='whatsapp_click')
     order by created_at desc limit 120`, [id],
  ).catch(() => []);

  const items: Item[] = [];
  for (const mail of mails) {
    const body = resolveSlots(mail.body).replaceAll("{{video_link}}", videoPageUrl(origin, id)).replaceAll("{{pv_link}}", "https://digitalegewinner.de/pv-trust");
    items.push({ at: mail.sent_at || mail.scheduled_at, kind: "mail", title: mail.subject, body, status: mail.status, detail: `${mail.status === "sent" ? "Gesendet" : mail.status === "queued" ? "Geplant" : mail.status === "suppressed" ? "Gestoppt" : mail.status}${mail.variant ? ` · Variante ${mail.variant}` : ""}${mail.error && mail.status !== "sent" ? ` · ${mail.error}` : ""}` });
  }
  for (const reply of replies) items.push({ at: reply.at, kind: "reply", title: `Antwort: ${reply.subject || "(ohne Betreff)"}`, body: reply.body_text });
  for (const event of events) {
    if (event.type === "reply") continue;
    const v = Number(event.meta?.v || 0);
    const p = String(event.meta?.p || "");
    let title = EVENT_LABELS[event.type] || "";
    let detail = "";
    if (event.type === "video_progress") title = `Video zu ${v} % gesehen`;
    else if (event.type === "video_watch") title = `Video angesehen: ${v} s`;
    else if (event.type === "video_scroll") title = `Videoseite gescrollt (${v} %)`;
    else if (event.type === "video_dwell") title = `Verweildauer auf der Videoseite: ${v} s`;
    else if (event.type === "site_dwell" || event.type === "site_scroll") title = event.type === "site_dwell" ? `Verweildauer auf der Website: ${v} s` : `Website gescrollt (${v} %)`;
    else if (event.type === "video_chat") detail = String(event.meta?.q || "");
    else if (event.type === "site_view" || event.type === "site_click") detail = p;
    else if (event.type === "email_click") detail = String(event.meta?.target || "");
    if (title) items.push({ at: event.at, kind: "event", title, detail });
  }
  items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return Response.json({ lead: { ...lead, pageUrl: `/v/${encodeURIComponent(videoToken(id))}`, analyseUrl: `/api/t/analyse/${encodeURIComponent(videoToken(id))}` }, items }, { headers: { "cache-control": "no-store" } });
}

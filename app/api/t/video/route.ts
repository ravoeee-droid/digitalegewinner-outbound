import { query } from "@/lib/db";
import { verifyVideoToken } from "@/lib/email-tracking";
import { sendAlertOnce } from "@/lib/alerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ereignisse der persönlichen Videoseite (/v/<token>): geöffnet, Play, Sehdauer, Scrollen, Verweildauer, Termin-Klick.
const TYPES = new Set(["view", "play_intent", "play", "play_confirmed", "player_error", "progress", "watch", "scroll", "dwell", "booking_click", "calendar_focus", "calendar_open", "chat_open", "whatsapp_click", "site_view", "site_scroll", "site_dwell", "site_click"]);
const CORS = { "access-control-allow-origin": "https://digitalegewinner.de", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type" };
const BOT = /(bot|crawl|spider|scan|proofpoint|mimecast|barracuda|safelinks|defender|symantec|trend ?micro|python|curl|wget|go-http|headless|preview|facebookexternalhit|slurp)/i;

export async function OPTIONS() { return new Response(null, { status: 204, headers: CORS }); }

export async function POST(request: Request) {
  let body: { t?: string; e?: string; v?: number; p?: string; a?: string; sid?: string; ts?: number; d?: {source?: string; ready?: number; network?: number; position?: number; visibility?: string} } = {};
  try { body = JSON.parse(await request.text()); } catch { return new Response(null, { status: 204, headers: CORS }); }
  const leadId = verifyVideoToken(String(body.t || ""));
  const type = String(body.e || "");
  const explainerTypes = new Set(["explainer_open", "explainer_play_confirmed", "explainer_progress", "explainer_calendar_click", "explainer_calendar_focus"]);
  if (!leadId || (!TYPES.has(type) && !explainerTypes.has(type))) return new Response(null, { status: 204, headers: CORS });
  const value = Math.max(0, Math.min(100000, Math.round(Number(body.v) || 0)));
  const arm = String(body.a || "").toUpperCase() === "B" ? "B" : "A";
  // Active interactions (play, progress, calendar, etc.) must not be
  // suppressed merely because they happen immediately after delivery.
  // Only passive events need the send-age lookup used for scanner detection.
  const passiveEvent = ["view","scroll","dwell","site_view","site_scroll","site_dwell"].includes(type);
  const knownBot = BOT.test(request.headers.get("user-agent") || "");
  let likelyImmediateScanner = false;
  if (passiveEvent && !knownBot) {
    const [sent] = await query<{ age: number | null }>(
      "select extract(epoch from (now()-max(sent_at)))::int age from er_outbox where workspace='default' and lead_id=$1 and status='sent'",
      [leadId],
    ).catch(() => []);
    likelyImmediateScanner = sent?.age != null && sent.age >= 0 && sent.age < 90;
  }
  const bot = knownBot || likelyImmediateScanner;
  // Minimal, allowlisted player diagnostics: no user agent, URL, or personal identifiers.
  const d = type === "player_error" && body.d && typeof body.d === "object" ? body.d : undefined;
  const diagnostic = d ? {
    source: d.source === "native" || d.source === "youtube" ? d.source : undefined,
    ready: Number.isInteger(d.ready) && Number(d.ready) >= 0 && Number(d.ready) <= 4 ? d.ready : undefined,
    network: Number.isInteger(d.network) && Number(d.network) >= 0 && Number(d.network) <= 3 ? d.network : undefined,
    position: Number.isFinite(d.position) && Number(d.position) >= 0 && Number(d.position) <= 36000 ? Math.round(Number(d.position)) : undefined,
    visibility: d.visibility === "visible" || d.visibility === "hidden" ? d.visibility : undefined,
  } : undefined;
  await query("insert into er_events(workspace,lead_id,type,meta) values('default',$1,$2,$3::jsonb)", [leadId, `video_${type}`, JSON.stringify({ v: value, bot, a: arm, p: String(body.p || "").replace(/[^a-zA-Z0-9/_.#:-]/g, "").slice(0, 80), session: /^[0-9a-f-]{36}$/i.test(String(body.sid||"")) ? body.sid : null, diagnostic, clientTs: Number.isFinite(Number(body.ts)) && Math.abs(Date.now()-Number(body.ts)) < 86400000 ? Math.floor(Number(body.ts)) : null })]).catch(() => null);
  const shouldNotify = type === "explainer_play_confirmed" || (type === "explainer_progress" && value >= 50)
    || type === "play_confirmed" || (type === "progress" && value >= 50)
    || type === "booking_click" || type === "calendar_focus" || type === "calendar_open"
    || type === "whatsapp_click" || type === "chat_open" || type === "site_click"
    || (type === "site_dwell" && value >= 10);
  // Most events (scroll, passive views, progress below 50%) need no company lookup.
  if (!bot && shouldNotify) {
    const [row] = await query<{ company: string }>(
      "select c.name company from sales_leads l join sales_companies c on c.id=l.company_id and c.workspace=l.workspace where l.id::text=$1 limit 1",
      [leadId],
    ).catch(() => []);
    const name = row?.company || `Lead ${leadId}`;
    const message =
      type === "explainer_play_confirmed" ? `▶️ Erklärvideo mindestens 3 Sekunden abgespielt: ${name}` :
      type === "explainer_progress" ? `🔥 Erklärvideo zu ${value} % gesehen: ${name}` :
      type === "play_confirmed" ? `▶️ Video mindestens 3 Sekunden abgespielt: ${name}` :
      type === "progress" && value >= 50 ? `🔥 Video zu ${value} % gesehen: ${name}` :
      type === "booking_click" ? `📅 Klick auf "Termin buchen": ${name}` :
      type === "calendar_focus" ? `🗓️ Kalender-iframe fokussiert: ${name}` :
      type === "calendar_open" ? `🗓️ Externer Kalender geöffnet: ${name}` :
      type === "whatsapp_click" ? `💬 WhatsApp-Button geklickt: ${name}` :
      type === "chat_open" ? `🤖 Chat geöffnet: ${name}` :
      type === "site_dwell" && value >= 10 ? `🌐 ${name} war mindestens ${value} Sekunden auf der Website: ${String(body.p || "/").slice(0, 60)}` :
      type === "site_click" ? `🖱️ ${name} hat auf der Website geklickt: ${String(body.p || "").slice(0, 60)}` : "";
    if (message) await sendAlertOnce(`video:${type}${type.endsWith("progress") ? value : ""}${type.startsWith("site_") ? String(body.p || "") : ""}:${leadId}`, message, type.startsWith("site_") ? 12 : 24 * 30).catch(() => null);
  }
  return new Response(null, { status: 204, headers: CORS });
}

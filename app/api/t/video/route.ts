import { query } from "@/lib/db";
import { verifyVideoToken } from "@/lib/email-tracking";
import { sendAlertOnce } from "@/lib/alerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ereignisse der persönlichen Videoseite (/v/<token>): geöffnet, Play, Sehdauer, Scrollen, Verweildauer, Termin-Klick.
const TYPES = new Set(["view", "play_intent", "play", "player_error", "progress", "watch", "scroll", "dwell", "booking_click", "calendar_focus", "chat_open", "whatsapp_click", "site_view", "site_scroll", "site_dwell", "site_click"]);
const CORS = { "access-control-allow-origin": "https://digitalegewinner.de", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type" };
const BOT = /(bot|crawl|spider|scan|proofpoint|mimecast|barracuda|safelinks|defender|symantec|trend ?micro|python|curl|wget|go-http|headless|preview|facebookexternalhit|slurp)/i;

export async function OPTIONS() { return new Response(null, { status: 204, headers: CORS }); }

export async function POST(request: Request) {
  let body: { t?: string; e?: string; v?: number; p?: string; a?: string } = {};
  try { body = JSON.parse(await request.text()); } catch { return new Response(null, { status: 204, headers: CORS }); }
  const leadId = verifyVideoToken(String(body.t || ""));
  const type = String(body.e || "");
  if (!leadId || !TYPES.has(type)) return new Response(null, { status: 204, headers: CORS });
  const value = Math.max(0, Math.min(100000, Math.round(Number(body.v) || 0)));
  const arm = String(body.a || "").toUpperCase() === "B" ? "B" : "A";
  // Sicherheits-Scanner öffnen Mail-Links Sekunden nach der Zustellung in einem echten Browser. Besuche kurz nach dem Versand zählen deshalb nicht als Mensch.
  const [sent] = await query<{ age: number | null }>("select extract(epoch from (now()-max(sent_at)))::int age from er_outbox where workspace='default' and lead_id=$1 and status='sent'", [leadId]).catch(() => []);
  const bot = BOT.test(request.headers.get("user-agent") || "") || (sent?.age != null && sent.age < 600);
  await query("insert into er_events(workspace,lead_id,type,meta) values('default',$1,$2,$3::jsonb)", [leadId, `video_${type}`, JSON.stringify({ v: value, bot, a: arm, p: String(body.p || "").replace(/[^a-zA-Z0-9/_.#:-]/g, "").slice(0, 80) })]).catch(() => null);
  if (!bot) {
    const [row] = await query<{ company: string }>(
      "select c.name company from sales_leads l join sales_companies c on c.id=l.company_id and c.workspace=l.workspace where l.id::text=$1 limit 1",
      [leadId],
    ).catch(() => []);
    const name = row?.company || `Lead ${leadId}`;
    const message =
      type === "view" ? `👀 Videoseite geöffnet: ${name}` :
      type === "play" ? `▶️ Video gestartet: ${name}` :
      type === "progress" && value >= 50 ? `🔥 Video zu ${value} % gesehen: ${name}` :
      type === "booking_click" ? `📅 Klick auf "Termin buchen": ${name}` :
      type === "calendar_focus" ? `🗓️ Kalender geöffnet: ${name}` :
      type === "whatsapp_click" ? `💬 WhatsApp-Button geklickt: ${name}` :
      type === "chat_open" ? `🤖 Chat geöffnet: ${name}` :
      type === "site_view" ? `🌐 ${name} ist auf der Website: ${String(body.p || "/").slice(0, 60)}` :
      type === "site_click" ? `🖱️ ${name} hat auf der Website geklickt: ${String(body.p || "").slice(0, 60)}` : "";
    if (message) await sendAlertOnce(`video:${type}${type === "progress" ? value : ""}${type.startsWith("site_") ? String(body.p || "") : ""}:${leadId}`, message, type.startsWith("site_") ? 12 : 24 * 30).catch(() => null);
  }
  return new Response(null, { status: 204, headers: CORS });
}

import { query } from "@/lib/db";
import { verifyVideoToken } from "@/lib/email-tracking";
import { sendAlertOnce } from "@/lib/alerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ereignisse der persönlichen Videoseite (/v/<token>): geöffnet, Play, Sehdauer, Scrollen, Verweildauer, Termin-Klick.
const TYPES = new Set(["view", "play", "progress", "watch", "scroll", "dwell", "booking_click", "calendar_focus"]);
const BOT = /(bot|crawl|spider|scan|proofpoint|mimecast|barracuda|safelinks|defender|symantec|trend ?micro|python|curl|wget|go-http|headless|preview|facebookexternalhit|slurp)/i;

export async function POST(request: Request) {
  let body: { t?: string; e?: string; v?: number } = {};
  try { body = JSON.parse(await request.text()); } catch { return new Response(null, { status: 204 }); }
  const leadId = verifyVideoToken(String(body.t || ""));
  const type = String(body.e || "");
  if (!leadId || !TYPES.has(type)) return new Response(null, { status: 204 });
  const value = Math.max(0, Math.min(100000, Math.round(Number(body.v) || 0)));
  const bot = BOT.test(request.headers.get("user-agent") || "");
  await query("insert into er_events(workspace,lead_id,type,meta) values('default',$1,$2,$3::jsonb)", [leadId, `video_${type}`, JSON.stringify({ v: value, bot })]).catch(() => null);
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
      type === "calendar_focus" ? `🗓️ Kalender geöffnet: ${name}` : "";
    if (message) await sendAlertOnce(`video:${type}${type === "progress" ? value : ""}:${leadId}`, message, 24 * 30).catch(() => null);
  }
  return new Response(null, { status: 204 });
}

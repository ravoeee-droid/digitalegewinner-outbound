import { query } from "@/lib/db";
import { verifyVideoToken } from "@/lib/email-tracking";
import { sendAlertOnce } from "@/lib/alerts";
import { askVideoChat } from "@/lib/video-chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type ChatMessage = { role: "user" | "assistant"; content: string };

// Chat der Videoseite: nur mit gültigem Link, höchstens 30 Nachrichten pro Lead und Tag.
export async function POST(request: Request) {
  let body: { t?: string; messages?: ChatMessage[] } = {};
  try { body = JSON.parse(await request.text()); } catch { return Response.json({ error: "Ungültige Anfrage." }, { status: 400 }); }
  const token = String(body.t || "");
  const leadId = token === "demo" ? "demo" : verifyVideoToken(token);
  if (!leadId) return Response.json({ error: "Ungültiger Link." }, { status: 400 });
  const messages = Array.isArray(body.messages) ? body.messages.slice(-12) : [];
  const valid = messages.length > 0 && messages.every((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.length <= 800);
  if (!valid || messages[messages.length - 1].role !== "user") return Response.json({ error: "Ungültige Nachricht." }, { status: 400 });

  let company = "Ihr Betrieb";
  let segment: "pflege" | "pv" = "pflege";
  if (leadId !== "demo") {
    const [used] = await query<{ n: number }>("select count(*)::int n from er_events where workspace='default' and lead_id=$1 and type='video_chat' and created_at>now()-interval '1 day'", [leadId]).catch(() => [{ n: 0 }]);
    if ((used?.n || 0) >= 30) return Response.json({ error: "Für heute ist das Limit erreicht. Schreiben Sie uns gern auf WhatsApp." }, { status: 429 });
    const [row] = await query<{ company: string; source: string }>(
      "select c.name company, coalesce(c.source,'') source from sales_leads l join sales_companies c on c.id=l.company_id and c.workspace=l.workspace where l.id::text=$1 limit 1", [leadId],
    ).catch(() => []);
    if (row) { company = row.company; segment = row.source === "ba-pv" ? "pv" : "pflege"; }
  }

  const answer = await askVideoChat(messages, segment, company);
  if (leadId !== "demo") {
    const question = messages[messages.length - 1].content.slice(0, 300);
    await query("insert into er_events(workspace,lead_id,type,meta) values('default',$1,'video_chat',$2::jsonb)", [leadId, JSON.stringify({ q: question, ok: !("error" in answer) })]).catch(() => null);
    await sendAlertOnce(`videochat:${leadId}`, `🤖 Chat-Nachricht von ${company}:\n„${question}"`, 6).catch(() => null);
  }
  return Response.json(answer, { status: "error" in answer ? 502 : 200 });
}

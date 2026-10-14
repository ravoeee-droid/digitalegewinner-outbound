import { query } from "@/lib/db";
import { getSecret } from "@/lib/secrets";

// Meldungen gehen an einen Telegram-Chat (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID, Env oder API-Tresor).
// Fehler beim Melden dürfen den Versand und die Syncs nie stören.
async function credential(envName: string, secretName: string) {
  return process.env[envName] || (await getSecret(secretName).catch(() => ""));
}

export async function sendAlert(text: string) {
  try {
    const [token, chat] = await Promise.all([
      credential("TELEGRAM_BOT_TOKEN", "telegram_bot_token"),
      credential("TELEGRAM_CHAT_ID", "telegram_chat_id"),
    ]);
    if (!token || !chat) return false;
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: text.slice(0, 3500), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// Gleiche Störung höchstens einmal pro Zeitfenster melden, damit der Chat nicht zugespammt wird.
export async function sendAlertOnce(key: string, text: string, hours = 6) {
  try {
    const recent = await query<{ id: number }>(
      "select id from er_events where workspace='default' and type='alert' and meta->>'key'=$1 and created_at>now()-($2::text||' hours')::interval limit 1",
      [key, String(hours)],
    );
    if (recent.length) return false;
    const sent = await sendAlert(text);
    await query("insert into er_events(workspace,type,meta) values('default','alert',$1::jsonb)", [JSON.stringify({ key, sent })]);
    return sent;
  } catch {
    return false;
  }
}

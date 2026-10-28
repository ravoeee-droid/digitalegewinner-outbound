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

// Atomic de-duplication: concurrent serverless invocations must never both
// send the same notification. A single insert/upsert claims the key before
// contacting Telegram. If the DB is unavailable, fail closed, not spam.
let claimTableReady: Promise<unknown> | null = null;
async function ensureClaimsTable() {
  claimTableReady ||= query(`create table if not exists outbound_alert_claims (
    workspace text not null,
    alert_key text not null,
    claimed_at timestamptz not null default now(),
    primary key (workspace, alert_key)
  )`).catch(error => {
    claimTableReady = null;
    throw error;
  });
  await claimTableReady;
}

// Same alert key may be sent again only after its requested cooldown.
export async function sendAlertOnce(key: string, message: string, hours = 6) {
  try {
    await ensureClaimsTable();
    const claims = await query<{ alert_key: string }>(
      `insert into outbound_alert_claims(workspace,alert_key,claimed_at)
       values('default',$1,now())
       on conflict(workspace,alert_key) do update
       set claimed_at=excluded.claimed_at
       where outbound_alert_claims.claimed_at < now()-($2::double precision * interval '1 hour')
       returning alert_key`,
      [key, hours],
    );
    if (!claims.length) return false;
    const sent = await sendAlert(message);
    await query("insert into er_events(workspace,type,meta) values('default','alert',$1::jsonb)", [
      JSON.stringify({ key, sent, atomic: true }),
    ]).catch(() => null);
    return sent;
  } catch (error) {
    console.error("[alerts] atomic claim failed", error instanceof Error ? error.message : "unknown");
    return false;
  }
}

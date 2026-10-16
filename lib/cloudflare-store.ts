import { d1Query } from "./cloudflare-d1";

export type D1State = { payload: Record<string, unknown>; version: number; updated_at: string };
type StateRow = { payload: string; version: number; updated_at: string };
const timestamp = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

function decode(row: StateRow): D1State {
  return { ...row, payload: JSON.parse(row.payload) as Record<string, unknown> };
}

export async function readD1State(workspace = "default"): Promise<D1State | null> {
  const [row] = await d1Query<StateRow>("SELECT payload,version,updated_at FROM er_state WHERE workspace=?", [workspace]);
  return row ? decode(row) : null;
}

export async function writeD1State(payload: Record<string, unknown>, workspace = "default"): Promise<D1State> {
  const [row] = await d1Query<StateRow>(`INSERT INTO er_state(workspace,payload) VALUES(?,?)
    ON CONFLICT(workspace) DO UPDATE SET payload=excluded.payload,version=er_state.version+1,updated_at=${timestamp}
    RETURNING payload,version,updated_at`, [workspace, JSON.stringify(payload)]);
  if (!row) throw new Error("Cloudflare-D1-Status wurde nicht gespeichert.");
  return decode(row);
}

export async function readD1Secret(name: string, workspace = "default") {
  const [row] = await d1Query<{ encrypted_value: string }>("SELECT encrypted_value FROM er_secrets WHERE workspace=? AND key=?", [workspace, name]);
  return row?.encrypted_value ?? "";
}

// Encryption/decryption stays in the existing server vault; D1 only receives ciphertext.
export async function writeD1Secret(name: string, ciphertext: string, workspace = "default") {
  await d1Query(`INSERT INTO er_secrets(workspace,key,encrypted_value) VALUES(?,?,?)
    ON CONFLICT(workspace,key) DO UPDATE SET encrypted_value=excluded.encrypted_value,updated_at=${timestamp}`, [workspace, name, ciphertext]);
}

export async function deleteD1Secret(name: string, workspace = "default") {
  await d1Query("DELETE FROM er_secrets WHERE workspace=? AND key=?", [workspace, name]);
}

export async function listD1Secrets(workspace = "default") {
  return d1Query<{ key: string; updated_at: string }>("SELECT key,updated_at FROM er_secrets WHERE workspace=? ORDER BY key", [workspace]);
}

export type SentMailRow = { id: number; recipient: string; subject: string; body: string; sent_at: string };

export async function listD1SentMail(mailboxId: string, limit: number, workspace = "default") {
  return d1Query<SentMailRow>("SELECT id,recipient,subject,body,sent_at FROM mail_sent WHERE workspace=? AND mailbox_id=? ORDER BY sent_at DESC,id DESC LIMIT ?", [workspace,mailboxId,limit]);
}

export async function saveD1SentMail(input: { mailboxId: string; to: string; subject: string; body: string; messageId: string }, workspace = "default") {
  await d1Query("INSERT INTO mail_sent(workspace,mailbox_id,recipient,subject,body,provider_message_id) VALUES(?,?,?,?,?,?)", [workspace,input.mailboxId,input.to,input.subject,input.body,input.messageId]);
}

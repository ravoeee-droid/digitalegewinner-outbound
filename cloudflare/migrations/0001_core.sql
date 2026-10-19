CREATE TABLE IF NOT EXISTS er_state (
  workspace TEXT PRIMARY KEY NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(payload)),
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS er_secrets (
  workspace TEXT NOT NULL,
  key TEXT NOT NULL,
  encrypted_value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY(workspace,key)
);
CREATE TABLE IF NOT EXISTS er_outbox (
  id TEXT PRIMARY KEY NOT NULL,
  workspace TEXT NOT NULL,
  campaign_id TEXT,
  lead_id TEXT,
  mailbox_id TEXT,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  variant TEXT NOT NULL DEFAULT 'A',
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  scheduled_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  sent_at TEXT,
  provider_message_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  campaign_version_id TEXT,
  experiment_id TEXT,
  experiment_arm_key TEXT
);
CREATE INDEX IF NOT EXISTS er_outbox_due_idx ON er_outbox(status,scheduled_at);
CREATE INDEX IF NOT EXISTS er_outbox_campaign_idx ON er_outbox(campaign_id,variant,status);
CREATE TABLE IF NOT EXISTS er_suppressions (
  workspace TEXT NOT NULL,
  email TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY(workspace,email)
);
CREATE TABLE IF NOT EXISTS er_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace TEXT NOT NULL,
  lead_id TEXT,
  type TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(meta)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS mail_sent (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace TEXT NOT NULL DEFAULT 'default',
  mailbox_id TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  provider_message_id TEXT NOT NULL DEFAULT '',
  sent_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS mail_sent_mailbox_idx ON mail_sent(workspace,mailbox_id,sent_at DESC);

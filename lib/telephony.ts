import { query } from "./db";

let telephonySchemaReady = false;

export type CloudTalkEventInput = {
  workspace?: string;
  leadId?: string;
  company?: string;
  event: string;
  properties?: Record<string, unknown>;
};

function asText(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function asNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizePhone(value: string) {
  if (!value) return "";
  const cleaned = value.replace(/[^\d+]/g, "");
  if (cleaned.startsWith("00")) return `+${cleaned.slice(2)}`;
  return cleaned;
}

export async function ensureTelephonySchema() {
  if (telephonySchemaReady) return;
  await query(`
    create table if not exists sales_calls (
      id bigserial primary key,
      workspace text not null default 'default',
      provider text not null default 'cloudtalk',
      provider_call_id text not null,
      lead_ref text not null default '',
      company text not null default '',
      direction text not null default 'outgoing',
      status text not null default 'dialing',
      external_number text not null default '',
      internal_number text not null default '',
      started_at timestamptz,
      answered_at timestamptz,
      ended_at timestamptz,
      duration_seconds integer not null default 0,
      raw_payload jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique(workspace, provider, provider_call_id)
    );
    create index if not exists sales_calls_lead_idx on sales_calls(workspace, lead_ref, created_at desc);
    create index if not exists sales_calls_created_idx on sales_calls(workspace, created_at desc);
  `);
  telephonySchemaReady = true;
}

export async function recordCloudTalkEvent(input: CloudTalkEventInput) {
  await ensureTelephonySchema();
  const workspace = input.workspace || "default";
  const properties = input.properties || {};
  const event = input.event.toLowerCase();
  const providerCallId =
    asText(properties.call_id) ||
    asText(properties.callId) ||
    asText(properties.sessionId) ||
    asText(properties.id) ||
    `${input.leadId || "unmatched"}-${Date.now()}`;
  const externalNumber = normalizePhone(
    asText(properties.external_number) ||
      asText(properties.remote_number) ||
      asText(properties.phone) ||
      asText(properties.number) ||
      asText(properties.dialedNumber),
  );
  const internalNumber = normalizePhone(asText(properties.internal_number) || asText(properties.agent_number));
  const direction = event.includes("incoming") || asText(properties.direction).toLowerCase() === "incoming" ? "incoming" : "outgoing";
  const durationSeconds = Math.max(0, Math.round(asNumber(properties.duration_seconds) || asNumber(properties.duration)));
  const startsCall = ["dialing", "ringing", "calling", "started", "call_start"].includes(event);
  const answersCall = ["calling", "answered", "connected", "call_answered"].includes(event);
  const endsCall = ["hangup", "ended", "completed", "call_end"].includes(event);

  const rows = await query<{ id: number; provider_call_id: string; status: string; duration_seconds: number }>(
    `insert into sales_calls(
       workspace,provider,provider_call_id,lead_ref,company,direction,status,external_number,internal_number,
       started_at,answered_at,ended_at,duration_seconds,raw_payload
     ) values(
       $1,'cloudtalk',$2,$3,$4,$5,$6,$7,$8,
       case when $9 then now() else null end,
       case when $10 then now() else null end,
       case when $11 then now() else null end,
       $12,$13::jsonb
     )
     on conflict(workspace,provider,provider_call_id) do update set
       lead_ref=case when excluded.lead_ref<>'' then excluded.lead_ref else sales_calls.lead_ref end,
       company=case when excluded.company<>'' then excluded.company else sales_calls.company end,
       direction=excluded.direction,
       status=excluded.status,
       external_number=case when excluded.external_number<>'' then excluded.external_number else sales_calls.external_number end,
       internal_number=case when excluded.internal_number<>'' then excluded.internal_number else sales_calls.internal_number end,
       started_at=case when $9 then coalesce(sales_calls.started_at,now()) else sales_calls.started_at end,
       answered_at=case when $10 then coalesce(sales_calls.answered_at,now()) else sales_calls.answered_at end,
       ended_at=case when $11 then coalesce(sales_calls.ended_at,now()) else sales_calls.ended_at end,
       duration_seconds=greatest(sales_calls.duration_seconds,$12),
       raw_payload=excluded.raw_payload,
       updated_at=now()
     returning id,provider_call_id,status,duration_seconds`,
    [
      workspace,
      providerCallId,
      input.leadId || "",
      input.company || "",
      direction,
      event,
      externalNumber,
      internalNumber,
      startsCall,
      answersCall,
      endsCall,
      durationSeconds,
      JSON.stringify({ event: input.event, properties }),
    ],
  );

  return rows[0];
}

export async function getCallSummary(workspace = "default") {
  await ensureTelephonySchema();
  const [stats] = await query<{ today: number; connected: number; talk_seconds: number }>(
    `select
       count(*) filter(where created_at >= date_trunc('day',now()))::int as today,
       count(*) filter(where created_at >= date_trunc('day',now()) and answered_at is not null)::int as connected,
       coalesce(sum(duration_seconds) filter(where created_at >= date_trunc('day',now())),0)::int as talk_seconds
     from sales_calls where workspace=$1`,
    [workspace],
  );
  return stats || { today: 0, connected: 0, talk_seconds: 0 };
}

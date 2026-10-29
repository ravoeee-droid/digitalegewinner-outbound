import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { adminCookieName, sessionRole } from "@/lib/admin-auth";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const enabled = () => process.env.EVOLUTION_INBOUND_ENABLED === "1";
const configured = () => Boolean(process.env.EVOLUTION_WEBHOOK_SECRET && process.env.EVOLUTION_INSTANCE_NAME);
function equalSecret(provided: string | null, secret: string) {
  if (!provided || !secret) return false;
  const a = Buffer.from(provided), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a,b);
}
async function ensureTables() {
  await query(`create table if not exists dg_wa_inbound_events (
    id bigserial primary key,
    workspace text not null default 'default',
    instance_name text not null,
    event_name text not null,
    external_id text not null,
    phone text not null default '',
    direction text not null default 'unknown',
    body_text text not null default '',
    occurred_at timestamptz,
    created_at timestamptz not null default now(),
    unique(workspace,instance_name,event_name,external_id)
  );
  create index if not exists dg_wa_inbound_events_phone_idx
    on dg_wa_inbound_events(workspace,phone,created_at desc);`);
}
type Raw = Record<string, unknown>;
function obj(v: unknown): Raw { return v !== null && typeof v === "object" && !Array.isArray(v) ? v as Raw : {}; }
function str(v: unknown): string { return typeof v === "string" ? v : ""; }
function parseMessage(message: unknown, event: string, instance: string) {
  const row = obj(message);
  const key = obj(row.key);
  const rawJid = str(key.remoteJid || row.remoteJid);
  if (!rawJid.endsWith("@s.whatsapp.net")) return null; // no groups, channels or broadcasts
  const phone = rawJid.split("@")[0].replace(/\D/g, "");
  if (phone.length < 9 || phone.length > 15) return null;
  const msg = obj(row.message);
  const extended = obj(msg.extendedTextMessage);
  const body = str(msg.conversation || extended.text || row.body || row.text).slice(0, 16000);
  const id = str(key.id || row.id);
  if (!id || id.length > 250) return null;
  const fromMe = key.fromMe === true;
  const unix = Number(row.messageTimestamp || row.timestamp);
  const occurredAt = Number.isFinite(unix) && unix > 1000000000 && unix < 9999999999 ? new Date(unix * 1000).toISOString() : null;
  return { id, instance, event, phone, direction: fromMe ? "outbound" : "inbound", body, occurredAt };
}
export async function POST(request: Request) {
  if (!enabled() || !configured()) return Response.json({ error: "Integration inactive" }, {status: 503});
  const secret = process.env.EVOLUTION_WEBHOOK_SECRET || "";
  // Configure Evolution webhook custom header x-dg-evolution-secret.
  if (!equalSecret(request.headers.get("x-dg-evolution-secret"),secret))
    return Response.json({error:"Unauthorized"},{status:401});
  const raw = await request.text();
  if (Buffer.byteLength(raw,"utf8") > 1024 * 1024) return Response.json({error:"Payload too large"},{status:413});
  let payload: Raw;
  try { payload = obj(JSON.parse(raw)); } catch { return Response.json({error:"Invalid JSON"},{status:400}); }
  const event = str(payload.event).toLowerCase().replace(/[_-]/g,".");
  const instance = str(payload.instance || payload.instanceName);
  if (instance !== process.env.EVOLUTION_INSTANCE_NAME) return Response.json({error:"Unknown instance"},{status:403});
  if (!["messages.upsert","messages.set"].includes(event)) return Response.json({ok:true,ignored:true});
  const data = payload.data;
  const messages = Array.isArray(data) ? data : Array.isArray(obj(data).messages) ? obj(data).messages as unknown[] : [data];
  if (messages.length > 100) return Response.json({error:"Batch too large"},{status:413});
  const parsed = messages.map(msg=>parseMessage(msg,event,instance)).filter((m):m is NonNullable<typeof m>=>Boolean(m));
  await ensureTables();
  let inserted = 0;
  for (const msg of parsed) {
    const rows = await query<{id:number}>(`insert into dg_wa_inbound_events
      (workspace,instance_name,event_name,external_id,phone,direction,body_text,occurred_at)
      values ('default',$1,$2,$3,$4,$5,$6,$7)
      on conflict do nothing returning id`,
      [msg.instance,msg.event,msg.id,msg.phone,msg.direction,msg.body,msg.occurredAt]);
    inserted += rows.length;
  }
  // No automated replies, no pipeline writes and no calendar actions at this stage.
  return Response.json({ok:true,received:parsed.length,inserted});
}
export async function GET() {
  const role = sessionRole((await cookies()).get(adminCookieName())?.value);
  if (role !== "admin") return Response.json({error:"Unauthorized"},{status:401});
  if (!enabled() || !configured()) return Response.json({enabled:false,configured:configured(),messages:0,contacts:0});
  await ensureTables();
  const counts=await query<{messages:number;contacts:number}>(`select count(*)::int messages, count(distinct phone)::int contacts from dg_wa_inbound_events where workspace='default' and instance_name=$1`,[process.env.EVOLUTION_INSTANCE_NAME]);
  return Response.json({enabled:true,configured:true,...counts[0]});
}

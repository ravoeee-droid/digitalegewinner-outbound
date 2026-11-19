import { Webhook } from "svix";
import { dgDialerCampaign, dialerDisposition, ensureDialerInbox } from "@/lib/cloudtalk-dialer";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 10;

export async function POST(request: Request) {
  const secret = process.env.CLOUDTALK_DIALER_WEBHOOK_SECRET;
  if (!secret) return new Response(null, { status: 503 });

  const body = await request.text();
  if (body.length > 128_000) return new Response(null, { status: 413 });

  try {
    new Webhook(secret).verify(body, Object.fromEntries(request.headers));
  } catch {
    return new Response(null, { status: 401 });
  }

  let event: unknown;
  try {
    event = JSON.parse(body);
  } catch {
    return new Response(null, { status: 400 });
  }
  const parsed = dialerDisposition.safeParse(event);
  if (!parsed.success) return new Response(null, { status: 400 });
  const { event_id, occurred_at, data } = parsed.data;
  if (data.dialer.campaign.id !== dgDialerCampaign) return new Response(null, { status: 204 });

  await ensureDialerInbox();
  await query(`
    insert into dg_cloudtalk_dialer_inbox(id,call_uuid,occurred_at,contact_id,tag,note,callback_at,attempt)
    values($1,$2,$3,$4,$5,$6,$7,$8) on conflict do nothing
  `, [
    event_id, data.call_uuid, occurred_at, data.contact?.id ?? null,
    (data.disposition.tag.name ?? "").replaceAll("\u0000", ""),
    (data.disposition.notes ?? "").replaceAll("\u0000", ""),
    data.disposition.rescheduled_at ?? null, data.disposition.attempt_no ?? null,
  ]);
  return new Response(null, { status: 204 });
}

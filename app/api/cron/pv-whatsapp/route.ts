import { preparePVWhatsAppDaily, sendConsentedPVWhatsApp } from "@/lib/pv-whatsapp-outreach";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected || request.headers.get("authorization") !== "Bearer " + expected) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    // Always prepare 30 daily drafts. Automatic sending requires opt-in, an approved
    // WhatsApp Business template and WHATSAPP_AUTO_SEND_ENABLED=1.
    const prepared = await preparePVWhatsAppDaily();
    const delivered = await sendConsentedPVWhatsApp();
    return Response.json({ ok: true, prepared, delivered });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "PV WhatsApp worker error" }, { status: 503 });
  }
}

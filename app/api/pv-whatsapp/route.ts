import { cookies } from "next/headers";
import { adminCookieName, sessionRole } from "@/lib/admin-auth";
import { preparePVWhatsAppDaily, pvWhatsAppDashboard } from "@/lib/pv-whatsapp-outreach";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function role() {
  const jar = await cookies();
  return sessionRole(jar.get(adminCookieName())?.value);
}
export async function GET() {
  if (!await role()) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return Response.json({ ok: true, ...await pvWhatsAppDashboard() }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "WhatsApp-Pool nicht verfügbar" }, { status: 503 });
  }
}
export async function POST() {
  if (await role() !== "admin") return Response.json({ error: "Admin-Zugriff erforderlich" }, { status: 403 });
  try {
    const result = await preparePVWhatsAppDaily();
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Pool konnte nicht vorbereitet werden" }, { status: 503 });
  }
}

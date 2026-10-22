import { verifyVideoToken } from "@/lib/email-tracking";
import { loadScreenshot } from "@/lib/lead-screenshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Liefert den Website-Screenshot eines Leads für die Videoseite (nur mit gültigem, signiertem Token).
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const leadId = verifyVideoToken(decodeURIComponent(token));
  if (!leadId) return new Response("Not found", { status: 404 });
  const data = await loadScreenshot(leadId);
  if (!data) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(data), { headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=86400, immutable" } });
}

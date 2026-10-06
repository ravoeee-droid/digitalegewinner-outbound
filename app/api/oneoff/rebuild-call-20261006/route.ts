export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ ok:false, error:"CRON_SECRET fehlt" }, { status:500 });
  const url = new URL("/api/cron/call-quality-gate", request.url);
  const response = await fetch(url, { headers: { authorization: `Bearer ${secret}` }, cache:"no-store" });
  const body = await response.text();
  return new Response(body, { status: response.status, headers: { "content-type": response.headers.get("content-type") || "application/json" } });
}

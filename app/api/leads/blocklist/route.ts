import { query } from "@/lib/db";
import { applyBlocklist, ensureBlocklist } from "@/lib/lead-blocklist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  await ensureBlocklist();
  const rows = await query<{ id: string; pattern: string; note: string }>("select id::text id, pattern, note from lead_blocklist order by pattern");
  return Response.json({ rows }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { pattern?: string; note?: string };
  const pattern = String(body.pattern || "").trim().slice(0, 80);
  if (pattern.length < 3) return Response.json({ error: "Bitte mindestens 3 Zeichen eingeben (Firmenname, Website oder E-Mail-Teil)." }, { status: 400 });
  await ensureBlocklist();
  await query("insert into lead_blocklist(pattern,note) values($1,$2) on conflict (pattern) do nothing", [pattern.toLowerCase(), String(body.note || "").slice(0, 120)]);
  const blocked = await applyBlocklist();
  return Response.json({ ok: true, blocked });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id") || "";
  await query("delete from lead_blocklist where id::text=$1", [id]);
  return Response.json({ ok: true });
}

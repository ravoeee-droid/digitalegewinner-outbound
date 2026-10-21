import { enrichPflegeContacts, enrichedToday } from "@/lib/pflege-enrich";
import { ensureSalesOsSchema } from "@/lib/sales-os";

export const runtime = "nodejs";
export const maxDuration = 300;

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET;
  return Boolean(expected && (request.headers.get("authorization") || "") === `Bearer ${expected}`);
}

async function run(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await ensureSalesOsSchema();
    const target = Number(process.env.BA_LEADS_PER_DAY) || 150;
    const today = await enrichedToday();
    const result = today >= target ? { checked: 0, added: 0, seconds: 0 } : await enrichPflegeContacts({ limit: Math.min(60, target - today) });
    console.log("[pflege-enrich]", JSON.stringify({ today, ...result }));
    return Response.json({ ok: true, today, ...result });
  } catch (error) {
    console.error("[pflege-enrich-error]", error);
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Pflege-Anreicherung fehlgeschlagen." }, { status: 500 });
  }
}

export async function GET(request: Request) { return run(request); }
export async function POST(request: Request) { return run(request); }

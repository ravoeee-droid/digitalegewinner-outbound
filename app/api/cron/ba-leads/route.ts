import { collectBaLeads } from "@/lib/ba-lead-source";
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
    const result = await collectBaLeads({ target: Number(process.env.BA_LEADS_PER_DAY) || 100, budgetMs: 240_000 });
    console.log("[ba-leads]", JSON.stringify(result));
    return Response.json({ ok: true, ...result });
  } catch (error) {
    console.error("[ba-leads-error]", error);
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Lead-Suche fehlgeschlagen." }, { status: 500 });
  }
}

export async function GET(request: Request) { return run(request); }
export async function POST(request: Request) { return run(request); }

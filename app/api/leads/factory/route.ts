import { getLeadFactoryStats, runLeadFactoryCycle } from "@/lib/daily-lead-factory";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  try {
    return Response.json(await getLeadFactoryStats());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Lead-Factory-Status konnte nicht geladen werden." }, { status: 500 });
  }
}

export async function POST() {
  try {
    return Response.json(await runLeadFactoryCycle(3));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Lead Factory konnte nicht gestartet werden." }, { status: 500 });
  }
}

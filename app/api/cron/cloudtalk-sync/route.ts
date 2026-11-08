import { cloudtalkConfigured } from "@/lib/cloudtalk-api";
import { syncCallQueue } from "@/lib/cloudtalk-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET;
  return Boolean(expected && (request.headers.get("authorization") || "") === `Bearer ${expected}`);
}

// Täglich automatisch: Call-Queue von Raphael (Tag pflege-heute) in CloudTalk bereitstellen, damit die Kampagne morgens fertig gefüllt ist.
export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!cloudtalkConfigured()) return Response.json({ error: "CLOUDTALK_API_ID / CLOUDTALK_API_SECRET fehlen." }, { status: 503 });
  const startedAt = Date.now();
  let gesendet = 0, last = null as Awaited<ReturnType<typeof syncCallQueue>> | null;
  try {
    while (Date.now() - startedAt < 150_000) {
      last = await syncCallQueue({ owner: "Raphael", tag: "pflege-heute", limit: 20 });
      gesendet += last.gesendet;
      if ((!last.verbleibend && !last.umbenennenOffen && !last.namenOffen) || (!last.gesendet && !last.umbenannt && !last.namenVersucht) || last.rateLimited) break;
    }
    return Response.json({ ok: true, gesendet, offeneCalls: last?.offeneCalls ?? 0, verbleibend: last?.verbleibend ?? 0, fehler: last?.fehler ?? [], sekunden: Math.round((Date.now() - startedAt) / 1000) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Sync fehlgeschlagen.", gesendet }, { status: 500 });
  }
}

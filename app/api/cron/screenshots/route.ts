import { query } from "@/lib/db";
import { capture, ensureScreenshotTable, launch, purgeOldScreenshots, screenshotCandidates, websiteFor } from "@/lib/lead-screenshot";

export const runtime = "nodejs";
export const maxDuration = 300;

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET;
  return Boolean(expected && (request.headers.get("authorization") || "") === `Bearer ${expected}`);
}

// Erstellt Website-Screenshots für die nächsten Leads (für die persönliche Videoseite).
async function run(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const startedAt = Date.now();
  let ok = 0, failed = 0;
  try {
    await ensureScreenshotTable();
    const purged = await purgeOldScreenshots();
    const leads = await screenshotCandidates(60);
    if (leads.length) {
      const browser = await launch();
      try {
        for (const lead of leads) {
          if (Date.now() - startedAt > 230_000) break;
          const website = websiteFor(lead.website, lead.email);
          if (!website) { await query("insert into lead_screenshots(lead_id,status,error) values($1,'none','keine Website') on conflict (lead_id) do nothing", [lead.lead_id]); failed++; continue; }
          try {
            const jpg = await capture(browser, website);
            if (!jpg) throw new Error("Seite leer oder nicht darstellbar");
            await query("insert into lead_screenshots(lead_id,url,status,data) values($1,$2,'ok',$3) on conflict (lead_id) do update set url=excluded.url,status='ok',data=excluded.data,error=null", [lead.lead_id, website, jpg]);
            ok++;
          } catch (error) {
            await query("insert into lead_screenshots(lead_id,url,status,error) values($1,$2,'failed',$3) on conflict (lead_id) do nothing", [lead.lead_id, website, String(error instanceof Error ? error.message : error).slice(0, 200)]).catch(() => null);
            failed++;
          }
        }
      } finally { await browser.close().catch(() => null); }
    }
    console.log("[screenshots]", JSON.stringify({ candidates: leads.length, ok, failed, purged, seconds: Math.round((Date.now() - startedAt) / 1000) }));
    return Response.json({ ok: true, candidates: leads.length, created: ok, failed });
  } catch (error) {
    console.error("[screenshots-error]", error);
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Screenshots fehlgeschlagen." }, { status: 500 });
  }
}

export async function GET(request: Request) { return run(request); }
export async function POST(request: Request) { return run(request); }

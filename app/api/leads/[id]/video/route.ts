import { query } from "@/lib/db";
import { videoToken } from "@/lib/email-tracking";
import { leadSegmentSql, type LeadSegment } from "@/lib/lead-segment";
import { capture, ensureScreenshotTable, hasScreenshot, launch, websiteFor } from "@/lib/lead-screenshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

type Lead = { id: string; website: string; email: string; segment: LeadSegment };

async function findLead(id: string): Promise<Lead | null> {
  if (!id || id.length > 180) return null;
  const [lead] = await query<Lead>(
    `select l.id::text id, coalesce(nullif(c.website,''),c.domain,'') website, coalesce(ct.email,'') email, ${leadSegmentSql("c")} segment ` +
    "from sales_leads l join sales_companies c on c.id=l.company_id and c.workspace=l.workspace " +
    "left join lateral (select email from sales_contacts k where k.company_id=c.id and k.workspace=l.workspace " +
    "order by k.is_primary desc, (coalesce(k.email,'')<>'') desc limit 1) ct on true " +
    "where l.workspace='default' and l.id::text=$1 limit 1",
    [id],
  );
  return lead || null;
}

function pageInfo(id: string, ready: boolean, websiteAvailable: boolean, segment: LeadSegment) {
  const token = videoToken(id);
  return {
    ready,
    websiteAvailable,
    segment,
    pageUrl: "/v/" + encodeURIComponent(token),
    previewUrl: "/v/" + encodeURIComponent(token) + "?preview=1",
    screenshotUrl: "/api/t/shot/" + encodeURIComponent(token),
  };
}

// Diese Route ist durch den Session-Proxy geschützt. Es wird ausschließlich die bereits
// im CRM hinterlegte Firmen-Website verarbeitet, niemals eine frei übermittelte URL.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const lead = await findLead(id);
    if (!lead) return Response.json({ error: "Lead nicht gefunden." }, { status: 404 });
    return Response.json(pageInfo(id, await hasScreenshot(id), Boolean(websiteFor(lead.website, lead.email)) && lead.segment !== "other", lead.segment), {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return Response.json({ error: "Videoseite konnte nicht geladen werden." }, { status: 500 });
  }
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const lead = await findLead(id);
    if (!lead) return Response.json({ error: "Lead nicht gefunden." }, { status: 404 });
    if (lead.segment === "other") return Response.json({ error: "Branche nicht sicher zugeordnet. Bitte erst als PV oder Pflege klassifizieren." }, { status: 422 });
    const website = websiteFor(lead.website, lead.email);
    if (!website) return Response.json({ error: "Keine gültige Firmenwebsite hinterlegt. Bitte zuerst die Website ergänzen." }, { status: 422 });

    await ensureScreenshotTable();
    const browser = await launch();
    let jpg: Buffer | null;
    try {
      jpg = await capture(browser, website);
    } finally {
      await browser.close().catch(() => null);
    }
    if (!jpg) return Response.json({ error: "Website nicht darstellbar. Bitte die Firmenwebsite überprüfen." }, { status: 422 });
    await query(
      "insert into lead_screenshots(lead_id,url,status,data,error,attempts,created_at) " +
      "values($1,$2,'ok',$3,null,0,now()) " +
      "on conflict (lead_id) do update set url=excluded.url,status='ok',data=excluded.data,error=null,attempts=0,created_at=now()",
      [id, website, jpg],
    );
    return Response.json(pageInfo(id, true, true, lead.segment), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("[lead-video-create]", error);
    return Response.json({ error: "Screenshot konnte nicht erstellt werden. Website oder Screenshot-Dienst prüfen." }, { status: 502 });
  }
}

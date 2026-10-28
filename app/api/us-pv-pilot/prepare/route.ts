import { cookies } from "next/headers";
import { z } from "zod";
import { adminCookieName, sessionRole } from "@/lib/admin-auth";
import { query, readState, writeState } from "@/lib/db";
import { persistRadarLead } from "@/lib/sales-os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const recordSchema = z.object({
  company: z.string().min(1).max(300),
  website: z.string().max(800).optional().default(""),
  email_candidate: z.string().email().max(500),
  city: z.string().max(200).optional().default(""),
  state: z.string().max(120).optional().default("California"),
  country: z.string().max(10).optional().default("US"),
  category: z.string().max(300).optional().default("Solar energy company"),
  phone: z.string().max(120).optional().default(""),
  maps_url: z.string().max(1200).optional().default(""),
  place_id: z.string().max(300).optional().default(""),
  rating: z.number().min(0).max(5).optional(),
  review_count: z.number().int().min(0).optional(),
  review_reason: z.string().max(1000).optional().default(""),
});

const inputSchema = z.object({
  records: z.array(recordSchema).min(1).max(100),
  limit: z.number().int().min(1).max(100).default(10),
});

const campaign = (leadIds: string[]) => ({
  id: "us-pv-calculator-pilot-v1",
  name: "California Solar Calculator · Pilot",
  audience: "Selected California residential solar installers without a clearly visible calculator",
  status: "Entwurf" as const,
  dailyLimit: Math.min(10, leadIds.length),
  sent: 0,
  replies: 0,
  positive: 0,
  appointments: 0,
  leadIds,
  steps: [
    {
      waitDays: 0,
      subject: "More homeowner inquiries for {{company}}?",
      body: `Hi there,\n\nWould you like to see how {{company}} could get more homeowner inquiries with a simple solar savings calculator?\n\nI can build a free personalized preview first. If you like it, we can discuss the next step. If not, no problem.\n\nWorth showing you?\n\nBest,\nRaphael Hermann\nDigitale Gewinner · Rosenfeld, Germany\nBrahmsweg 6, 72348 Rosenfeld, Germany\n\nIf this isn't relevant, reply “no” and I won't contact you again.`,
    },
    {
      waitDays: 3,
      subject: "Re: More homeowner inquiries for {{company}}?",
      body: `Hi there,\n\nJust following up — the idea is a simple calculator that gives homeowners a useful ballpark estimate before they request a consultation.\n\nI can create a free preview tailored to {{company}}. Would you like to see it?\n\nBest,\nRaphael\n\nIf this isn't relevant, reply “no” and I won't contact you again.`,
    },
    {
      waitDays: 7,
      subject: "Re: More homeowner inquiries for {{company}}?",
      body: `Hi there,\n\nShould I close the loop, or would a free calculator preview for {{company}} be useful?\n\nBest,\nRaphael\n\nIf this isn't relevant, reply “no” and I won't contact you again.`,
    },
  ],
});

export async function POST(request: Request) {
  const cookie = (await cookies()).get(adminCookieName())?.value;
  if (sessionRole(cookie) !== "admin") return Response.json({ error: "Nur Administratoren dürfen US-Leads importieren." }, { status: 403 });

  try {
    const input = inputSchema.parse(await request.json());
    const unique = new Map<string, z.infer<typeof recordSchema>>();
    for (const record of input.records) {
      const key = record.place_id || record.email_candidate.toLowerCase();
      if (!unique.has(key)) unique.set(key, record);
    }
    const selected = [...unique.values()].slice(0, input.limit);
    const imported: Array<{ leadId: string; company: string; email: string }> = [];

    for (const record of selected) {
      const sourceId = `apify-us:${record.place_id || record.email_candidate.toLowerCase()}`;
      const result = await persistRadarLead({
        id: sourceId,
        company: record.company,
        email: record.email_candidate,
        phone: record.phone,
        website: record.website,
        city: record.city,
        industry: "Photovoltaik",
        source: "apify-us-pv",
        metadata: {
          business_segment: "pv",
          business_segment_verified_at: new Date().toISOString(),
          market: "US",
          country: record.country,
          state: record.state,
          maps_url: record.maps_url,
          place_id: record.place_id,
          rating: record.rating ?? null,
          review_count: record.review_count ?? null,
          calculator_review: record.review_reason,
          campaign_key: "us-pv-calculator-pilot-v1",
        },
      }, { email: record.email_candidate, phone: record.phone } as never, undefined, "default");
      await query(
        "update sales_leads set deal_value=500, notes=$2, updated_at=now() where id=$1 and workspace='default'",
        [result.leadId, `US Solar Calculator Pilot · ${record.city}, ${record.state}\nPublic business email: ${record.email_candidate}\nSource: ${record.maps_url || record.website}`],
      );
      imported.push({ leadId: result.leadId, company: record.company, email: record.email_candidate });
    }

    const nextCampaign = campaign(imported.map((item) => item.leadId));
    const stateRow = await readState("default");
    const state = (stateRow?.payload || {}) as Record<string, unknown>;
    const campaigns = Array.isArray(state.campaigns) ? state.campaigns as Array<Record<string, unknown>> : [];
    await writeState({
      ...state,
      campaigns: [...campaigns.filter((item) => item.id !== nextCampaign.id), nextCampaign],
    }, "default");

    return Response.json({ ok: true, imported, campaign: nextCampaign, message: `${imported.length} US-PV-Leads importiert; Kampagne als Entwurf vorbereitet. Es wurde nichts versendet.` });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "Lead-Datei ist ungültig.", details: error.issues }, { status: 400 });
    console.error("[us-pv-pilot-prepare]", error);
    return Response.json({ error: error instanceof Error ? error.message : "US-PV-Pilot konnte nicht vorbereitet werden." }, { status: 500 });
  }
}


import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { firecrawlConfigured, scrapeWithFirecrawl, type FirecrawlDocument } from "@/lib/oss/firecrawl-client";
import { researchWithStagehand, stagehandConfigured, type StagehandResearch } from "@/lib/oss/stagehand-client";
import { buildAutopilotIntelligence } from "@/lib/oss/autopilot-intelligence";
import { capturePosthogEvent } from "@/lib/oss/posthog-client";
import { triggerConfigured, triggerTask } from "@/lib/oss/trigger-client";
import { assertPublicHttpUrl } from "@/lib/oss/url-safety";

export const dynamic = "force-dynamic";

const Input = z.object({
  url: z.string().url(),
  company: z.string().trim().max(200).optional(),
  leadId: z.string().trim().max(200).optional(),
  queueDurableWorkflow: z.boolean().optional().default(true),
});

function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 30_000);
}

async function nativeFallback(url: string): Promise<FirecrawlDocument> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "DigitaleGewinner-Research/1.0" },
      cache: "no-store",
      redirect: "follow",
    });
    if (!response.ok) throw new Error(`Website HTTP ${response.status}`);
    const finalUrl = await assertPublicHttpUrl(response.url || url);
    const html = await response.text();
    return {
      markdown: stripHtml(html),
      html: html.slice(0, 80_000),
      metadata: { source: "native-fallback", status: response.status, finalUrl },
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function getFirecrawl(url: string) {
  if (!firecrawlConfigured()) return { document: await nativeFallback(url), engine: "native-fallback" as const };
  const document = await scrapeWithFirecrawl(url, {
    formats: ["markdown", "links"],
    onlyMainContent: false,
    blockAds: true,
    removeBase64Images: true,
    maxAge: 3_600_000,
  });
  return { document, engine: "firecrawl-v2" as const };
}

export async function POST(request: Request) {
  const parsed = Input.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Ungültige Eingabe", issues: parsed.error.issues }, { status: 400 });

  const { company, leadId, queueDurableWorkflow } = parsed.data;
  let url: string;
  try {
    url = await assertPublicHttpUrl(parsed.data.url);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Website wurde aus Sicherheitsgründen blockiert." }, { status: 400 });
  }

  const distinctId = leadId || `research:${new URL(url).hostname}`;
  const startedAt = Date.now();

  const [firecrawlResult, stagehandResult] = await Promise.allSettled([
    getFirecrawl(url),
    stagehandConfigured() ? researchWithStagehand(url) : Promise.resolve(undefined),
  ]);

  if (firecrawlResult.status === "rejected" && stagehandResult.status === "rejected") {
    return NextResponse.json({
      error: "Website-Recherche fehlgeschlagen",
      firecrawl: firecrawlResult.reason instanceof Error ? firecrawlResult.reason.message : String(firecrawlResult.reason),
      stagehand: stagehandResult.reason instanceof Error ? stagehandResult.reason.message : String(stagehandResult.reason),
    }, { status: 502 });
  }

  const firecrawl = firecrawlResult.status === "fulfilled" ? firecrawlResult.value.document : undefined;
  const sourceEngine = firecrawlResult.status === "fulfilled" ? firecrawlResult.value.engine : "stagehand-only";
  const stagehand = stagehandResult.status === "fulfilled" ? stagehandResult.value as StagehandResearch | undefined : undefined;
  const intelligence = buildAutopilotIntelligence({ company, url, firecrawl, stagehand });
  const elapsedMs = Date.now() - startedAt;

  const eventMeta = {
    url,
    company: company || stagehand?.companyName || null,
    score: intelligence.score,
    temperature: intelligence.temperature,
    sourceEngine,
    stagehand: Boolean(stagehand),
    elapsedMs,
    signals: intelligence.signals.map(item => ({ id: item.id, weight: item.weight })),
  };

  await Promise.allSettled([
    query(
      `insert into er_events(workspace, lead_id, type, meta) values($1,$2,$3,$4::jsonb)`,
      ["default", leadId || null, "autopilot_research", JSON.stringify(eventMeta)],
    ),
    capturePosthogEvent("dg_autopilot_research_completed", distinctId, eventMeta),
  ]);

  let durableRun: Record<string, unknown> | null = null;
  let durableError: string | null = null;
  if (queueDurableWorkflow && triggerConfigured()) {
    try {
      durableRun = await triggerTask(
        process.env.TRIGGER_AUTOPILOT_TASK_ID || "dg-lead-autopilot",
        {
          leadId: leadId || null,
          url,
          company: company || stagehand?.companyName || null,
          intelligence,
          stagehand: stagehand || null,
        },
        {
          idempotencyKey: `dg-autopilot:${leadId || new URL(url).hostname}:${new Date().toISOString().slice(0, 10)}`,
          tags: ["dg-autopilot", intelligence.temperature],
        },
      );
    } catch (error) {
      durableError = error instanceof Error ? error.message : String(error);
    }
  }

  return NextResponse.json({
    ok: true,
    company: company || stagehand?.companyName || null,
    url,
    engine: {
      primary: sourceEngine,
      firecrawlConfigured: firecrawlConfigured(),
      stagehandConfigured: stagehandConfigured(),
      stagehandUsed: Boolean(stagehand),
      durableWorkflowQueued: Boolean(durableRun),
      durableError,
    },
    intelligence,
    evidence: {
      title: String(firecrawl?.metadata?.title || stagehand?.headline || ""),
      description: String(firecrawl?.metadata?.description || ""),
      links: Array.isArray(firecrawl?.links) ? firecrawl.links.slice(0, 20) : [],
      jobs: stagehand?.openJobs || [],
      contacts: stagehand?.contacts || [],
      conversionIssues: stagehand?.conversionIssues || [],
      trustSignals: stagehand?.trustSignals || [],
      notableFacts: stagehand?.notableFacts || [],
      markdownPreview: String(firecrawl?.markdown || "").slice(0, 2400),
    },
    durableRun,
    elapsedMs,
  });
}

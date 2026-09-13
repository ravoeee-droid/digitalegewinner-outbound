export type StagehandResearch = {
  companyName?: string;
  headline?: string;
  services?: string[];
  openJobs?: string[];
  contacts?: Array<{ name?: string; role?: string; email?: string; phone?: string }>;
  hasCareerArea?: boolean;
  hasApplicationCta?: boolean;
  conversionIssues?: string[];
  trustSignals?: string[];
  notableFacts?: string[];
  sourceUrl?: string;
  engine?: string;
};

export function stagehandConfigured() {
  return Boolean(process.env.STAGEHAND_WORKER_URL?.trim());
}

export async function researchWithStagehand(url: string): Promise<StagehandResearch> {
  const workerUrl = process.env.STAGEHAND_WORKER_URL?.trim()?.replace(/\/$/, "");
  if (!workerUrl) throw new Error("STAGEHAND_WORKER_URL fehlt.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);
  try {
    const response = await fetch(`${workerUrl}/research`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.STAGEHAND_WORKER_SECRET
          ? { authorization: `Bearer ${process.env.STAGEHAND_WORKER_SECRET}` }
          : {}),
      },
      body: JSON.stringify({ url }),
      signal: controller.signal,
      cache: "no-store",
    });
    const body = (await response.json().catch(() => ({}))) as { ok?: boolean; data?: StagehandResearch; error?: string };
    if (!response.ok || !body.ok) throw new Error(body.error || `Stagehand worker HTTP ${response.status}`);
    return body.data || {};
  } finally {
    clearTimeout(timeout);
  }
}

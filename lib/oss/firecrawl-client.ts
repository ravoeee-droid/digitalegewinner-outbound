/*
 * Firecrawl v2 adapter for DG Autopilot.
 *
 * Upstream source used directly as implementation reference:
 * - firecrawl/firecrawl apps/js-sdk/firecrawl/src/v2/methods/scrape.ts
 *   commit/source observed 2026-09-11, file sha 14a3577af3985a295dcfafbce0b8abc5a2f9c825
 * - firecrawl/firecrawl apps/js-sdk/firecrawl/src/v2/methods/crawl.ts
 *   file sha 7a46c5aadf71d4ec9e40030b0ddb0c6e972c83ee
 * SDK license: MIT (apps/js-sdk/firecrawl/LICENSE)
 *
 * This file intentionally preserves the official v2 endpoint shapes, payload
 * preparation, bounded resume behavior and crawl polling semantics instead of
 * inventing a second crawler implementation inside DG.
 */

export type FirecrawlDocument = {
  markdown?: string;
  html?: string;
  rawHtml?: string;
  links?: string[];
  screenshot?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
};

export type FirecrawlScrapeOptions = {
  formats?: Array<string | Record<string, unknown>>;
  onlyMainContent?: boolean;
  includeTags?: string[];
  excludeTags?: string[];
  waitFor?: number;
  timeout?: number;
  actions?: Array<Record<string, unknown>>;
  mobile?: boolean;
  skipTlsVerification?: boolean;
  removeBase64Images?: boolean;
  blockAds?: boolean;
  proxy?: "basic" | "stealth" | "auto";
  storeInCache?: boolean;
  maxAge?: number;
  headers?: Record<string, string>;
  location?: Record<string, unknown>;
  zeroDataRetention?: boolean;
};

export type FirecrawlCrawlRequest = {
  url: string;
  prompt?: string;
  excludePaths?: string[];
  includePaths?: string[];
  maxDiscoveryDepth?: number;
  sitemap?: "include" | "skip" | "only";
  robotsUserAgent?: string;
  ignoreQueryParameters?: boolean;
  deduplicateSimilarURLs?: boolean;
  limit?: number;
  crawlEntireDomain?: boolean;
  allowExternalLinks?: boolean;
  allowSubdomains?: boolean;
  delay?: number;
  maxConcurrency?: number;
  regexOnFullURL?: boolean;
  webhook?: string | Record<string, unknown>;
  integration?: string;
  origin?: string;
  scrapeOptions?: FirecrawlScrapeOptions;
  zeroDataRetention?: boolean;
};

export type FirecrawlCrawlJob = {
  id: string;
  status: string;
  completed: number;
  total: number;
  creditsUsed?: number;
  expiresAt?: string;
  next?: string | null;
  data: FirecrawlDocument[];
};

const RESUME_MAX_ATTEMPTS = 5;
const RESUME_MAX_TOTAL_WAIT_MS = 20 * 60 * 1000;
const RESUME_MIN_DELAY_MS = 5 * 1000;
const RESUME_MAX_DELAY_MS = 10 * 60 * 1000;

function baseUrl() {
  return (process.env.FIRECRAWL_BASE_URL || "https://api.firecrawl.dev").replace(/\/$/, "");
}

function apiKey() {
  const key = process.env.FIRECRAWL_API_KEY?.trim();
  if (!key) throw new Error("FIRECRAWL_API_KEY fehlt.");
  return key;
}

async function request<T>(path: string, init: RequestInit, timeoutMs = 330_000): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl()}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${apiKey()}`,
        "content-type": "application/json",
        ...(init.headers || {}),
      },
      cache: "no-store",
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const error = new Error(String(body.error || body.message || `Firecrawl HTTP ${response.status}`)) as Error & {
        status?: number;
        code?: string;
        details?: unknown;
        retryAfter?: string | null;
      };
      error.status = response.status;
      error.code = typeof body.code === "string" ? body.code : undefined;
      error.details = body.details;
      error.retryAfter = response.headers.get("retry-after");
      throw error;
    }
    return body as T;
  } finally {
    clearTimeout(timeout);
  }
}

function processingContinuesDelayMs(error: unknown): number | undefined {
  const err = error as { status?: number; code?: string; details?: { state?: string; retryAfterSeconds?: number }; retryAfter?: string | null };
  if (err?.status !== 408 || err?.code !== "SCRAPE_TIMEOUT" || err?.details?.state !== "processing_continues") return undefined;
  const headerSeconds = Number(err.retryAfter);
  const seconds = typeof err.details.retryAfterSeconds === "number" && Number.isFinite(err.details.retryAfterSeconds)
    ? err.details.retryAfterSeconds
    : Number.isFinite(headerSeconds)
      ? headerSeconds
      : 60;
  return Math.min(RESUME_MAX_DELAY_MS, Math.max(RESUME_MIN_DELAY_MS, seconds * 1000));
}

export function firecrawlConfigured() {
  return Boolean(process.env.FIRECRAWL_API_KEY?.trim());
}

export async function scrapeWithFirecrawl(url: string, options: FirecrawlScrapeOptions = {}): Promise<FirecrawlDocument> {
  if (!url?.trim()) throw new Error("URL cannot be empty");
  const payload = { url: url.trim(), ...options };
  const requestTimeout = Math.max(typeof options.timeout === "number" ? options.timeout : 300_000, 300_000) + 30_000;
  let resumes = 0;
  let resumeWaitedMs = 0;

  while (true) {
    try {
      const response = await request<{ success: boolean; data?: FirecrawlDocument; error?: string }>(
        "/v2/scrape",
        { method: "POST", body: JSON.stringify(payload) },
        requestTimeout,
      );
      if (!response.success) throw new Error(response.error || "Firecrawl scrape failed");
      return response.data || {};
    } catch (error) {
      const delayMs = processingContinuesDelayMs(error);
      if (delayMs !== undefined && resumes < RESUME_MAX_ATTEMPTS && resumeWaitedMs + delayMs <= RESUME_MAX_TOTAL_WAIT_MS) {
        resumes += 1;
        resumeWaitedMs += delayMs;
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }
      throw error;
    }
  }
}

function prepareCrawlPayload(input: FirecrawlCrawlRequest): Record<string, unknown> {
  if (!input.url?.trim()) throw new Error("URL cannot be empty");
  const data: Record<string, unknown> = { url: input.url.trim() };
  if (input.prompt) data.prompt = input.prompt;
  if (input.excludePaths) data.excludePaths = input.excludePaths;
  if (input.includePaths) data.includePaths = input.includePaths;
  if (input.maxDiscoveryDepth != null) data.maxDiscoveryDepth = input.maxDiscoveryDepth;
  if (input.sitemap != null) data.sitemap = input.sitemap;
  if (input.robotsUserAgent != null) data.robotsUserAgent = input.robotsUserAgent;
  if (input.ignoreQueryParameters != null) data.ignoreQueryParameters = input.ignoreQueryParameters;
  if (input.deduplicateSimilarURLs != null) data.deduplicateSimilarURLs = input.deduplicateSimilarURLs;
  if (input.limit != null) data.limit = input.limit;
  if (input.crawlEntireDomain != null) data.crawlEntireDomain = input.crawlEntireDomain;
  if (input.allowExternalLinks != null) data.allowExternalLinks = input.allowExternalLinks;
  if (input.allowSubdomains != null) data.allowSubdomains = input.allowSubdomains;
  if (input.delay != null) data.delay = input.delay;
  if (input.maxConcurrency != null) data.maxConcurrency = input.maxConcurrency;
  if (input.regexOnFullURL != null) data.regexOnFullURL = input.regexOnFullURL;
  if (input.webhook != null) data.webhook = input.webhook;
  if (input.integration?.trim()) data.integration = input.integration.trim();
  if (input.origin) data.origin = input.origin;
  if (input.scrapeOptions) data.scrapeOptions = input.scrapeOptions;
  if (input.zeroDataRetention != null) data.zeroDataRetention = input.zeroDataRetention;
  return data;
}

export async function startFirecrawlCrawl(input: FirecrawlCrawlRequest) {
  const response = await request<{ success: boolean; id: string; url: string; error?: string }>(
    "/v2/crawl",
    { method: "POST", body: JSON.stringify(prepareCrawlPayload(input)) },
  );
  if (!response.success || !response.id) throw new Error(response.error || "Firecrawl crawl failed to start");
  return { id: response.id, url: response.url };
}

export async function getFirecrawlCrawlStatus(jobId: string): Promise<FirecrawlCrawlJob> {
  if (!jobId?.trim()) throw new Error("jobId fehlt.");
  const body = await request<{
    success: boolean;
    status: string;
    completed?: number;
    total?: number;
    creditsUsed?: number;
    expiresAt?: string;
    next?: string | null;
    data?: FirecrawlDocument[];
    error?: string;
  }>(`/v2/crawl/${encodeURIComponent(jobId)}`, { method: "GET" });
  if (!body.success) throw new Error(body.error || "Firecrawl crawl status failed");
  return {
    id: jobId,
    status: body.status,
    completed: body.completed ?? 0,
    total: body.total ?? 0,
    creditsUsed: body.creditsUsed,
    expiresAt: body.expiresAt,
    next: body.next ?? null,
    data: body.data || [],
  };
}

export async function waitForFirecrawlCrawl(jobId: string, pollIntervalSeconds = 2, timeoutSeconds = 180): Promise<FirecrawlCrawlJob> {
  const started = Date.now();
  while (true) {
    const status = await getFirecrawlCrawlStatus(jobId);
    if (["completed", "failed", "cancelled"].includes(status.status)) return status;
    if (Date.now() - started > timeoutSeconds * 1000) throw new Error(`Firecrawl crawl ${jobId} timed out after ${timeoutSeconds}s`);
    await new Promise(resolve => setTimeout(resolve, Math.max(1000, pollIntervalSeconds * 1000)));
  }
}

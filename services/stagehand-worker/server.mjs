/*
 * DG Stagehand research worker.
 * Uses the real @browserbasehq/stagehand v4 SDK, pinned to 4.1.0.
 * Upstream implementation/example source:
 * browserbase/stagehand README.md (commit observed 2026-09-11, MIT)
 *
 * This is intentionally a sidecar service so the main Next/Vercel build does
 * not pull Chromium/browser-agent dependencies into serverless functions.
 */

import http from "node:http";
import { browserbase, Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod/v4";

const PORT = Number(process.env.PORT || 8788);
const SECRET = process.env.STAGEHAND_WORKER_SECRET || "";

const CompanyResearch = z.object({
  companyName: z.string().optional(),
  headline: z.string().optional(),
  services: z.array(z.string()).default([]),
  openJobs: z.array(z.string()).default([]),
  contacts: z.array(z.object({
    name: z.string().optional(),
    role: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
  })).default([]),
  hasCareerArea: z.boolean().default(false),
  hasApplicationCta: z.boolean().default(false),
  conversionIssues: z.array(z.string()).default([]),
  trustSignals: z.array(z.string()).default([]),
  notableFacts: z.array(z.string()).default([]),
});

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function research(url) {
  const BROWSERBASE_API_KEY = process.env.BROWSERBASE_API_KEY;
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!BROWSERBASE_API_KEY) throw new Error("BROWSERBASE_API_KEY fehlt im Stagehand Worker.");
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY fehlt im Stagehand Worker.");

  // Browserbase + Stagehand lifecycle follows the official v4 README example.
  const browser = await browserbase.launch({ apiKey: BROWSERBASE_API_KEY });
  try {
    const stagehand = await Stagehand.create({
      browser,
      model: {
        modelName: process.env.STAGEHAND_MODEL || "openai/gpt-5.4-mini",
        apiKey: OPENAI_API_KEY,
      },
    });

    const [page] = await browser.context.pages();
    if (!page) throw new Error("Stagehand started without a browser page.");
    await page.goto(url);

    const { data } = await stagehand.extract(
      [
        "Research this company website for a sales operator.",
        "Extract the company identity, key services, visible open jobs, contacts, career/application CTAs,",
        "specific conversion problems, trust signals and concrete facts that can be used in a personalized outreach message.",
        "Do not invent facts. Only return evidence visible on the website.",
      ].join(" "),
      CompanyResearch,
    );

    return {
      ...data,
      sourceUrl: url,
      engine: "@browserbasehq/stagehand@4.1.0",
    };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    return json(res, 200, { ok: true, engine: "stagehand", version: "4.1.0" });
  }

  if (req.method !== "POST" || req.url !== "/research") {
    return json(res, 404, { error: "not_found" });
  }

  if (SECRET && req.headers.authorization !== `Bearer ${SECRET}`) {
    return json(res, 401, { error: "unauthorized" });
  }

  try {
    const body = await readBody(req);
    const url = String(body.url || "").trim();
    if (!/^https?:\/\//i.test(url)) return json(res, 400, { error: "valid_url_required" });
    const data = await research(url);
    return json(res, 200, { ok: true, data });
  } catch (error) {
    return json(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`DG Stagehand worker listening on :${PORT}`);
});

import { NextResponse } from "next/server";
import { firecrawlConfigured } from "@/lib/oss/firecrawl-client";
import { stagehandConfigured } from "@/lib/oss/stagehand-client";
import { triggerConfigured } from "@/lib/oss/trigger-client";
import { posthogConfigured } from "@/lib/oss/posthog-client";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    branch: "feature/dg-autopilot-oss-stack",
    engines: {
      firecrawl: {
        configured: firecrawlConfigured(),
        version: "v2 API / JS SDK 4.39.0 semantics",
        upstream: "firecrawl/firecrawl",
        license: "MIT (JS SDK)",
      },
      stagehand: {
        configured: stagehandConfigured(),
        version: "4.1.0",
        upstream: "browserbase/stagehand",
        license: "MIT",
      },
      trigger: {
        configured: triggerConfigured(),
        version: "v3 REST",
        upstream: "triggerdotdev/trigger.dev",
        license: "Apache-2.0",
      },
      posthog: {
        configured: posthogConfigured(),
        version: "capture API",
        upstream: "PostHog/posthog",
      },
    },
  });
}

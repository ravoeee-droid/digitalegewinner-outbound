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
        version: "@trigger.dev/sdk 4.5.16 / v3 REST API",
        upstream: "triggerdotdev/trigger.dev",
        license: "MIT (SDK)",
      },
      posthog: {
        configured: posthogConfigured(),
        version: "capture API",
        upstream: "PostHog/posthog",
      },
    },
  });
}

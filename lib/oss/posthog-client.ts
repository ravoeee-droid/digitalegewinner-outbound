export function posthogConfigured() {
  return Boolean(process.env.POSTHOG_PROJECT_KEY?.trim());
}

export async function capturePosthogEvent(event: string, distinctId: string, properties: Record<string, unknown> = {}) {
  const apiKey = process.env.POSTHOG_PROJECT_KEY?.trim();
  if (!apiKey) return { skipped: true } as const;
  const host = (process.env.POSTHOG_HOST || "https://eu.i.posthog.com").replace(/\/$/, "");
  const response = await fetch(`${host}/capture/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      event,
      properties: {
        distinct_id: distinctId,
        source: "dg-autopilot",
        ...properties,
      },
    }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`PostHog capture failed (${response.status})`);
  return { skipped: false } as const;
}

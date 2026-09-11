/*
 * Trigger.dev v3 REST adapter for DG Autopilot.
 *
 * Upstream source used directly as implementation reference:
 * triggerdotdev/trigger.dev packages/core/src/v3/apiClient/index.ts
 * Apache-2.0. The official client calls
 * POST /api/v1/tasks/{taskIdentifier}/trigger and uses exponential retry
 * defaults of 5 attempts, 1s min, 30s max, factor 1.6.
 */

const DEFAULT_RETRY = {
  maxAttempts: 5,
  minTimeoutInMs: 1000,
  maxTimeoutInMs: 30_000,
  factor: 1.6,
} as const;

function triggerBaseUrl() {
  return (process.env.TRIGGER_API_URL || "https://api.trigger.dev").replace(/\/$/, "");
}

export function triggerConfigured() {
  return Boolean(process.env.TRIGGER_SECRET_KEY?.trim());
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function triggerTask<TPayload extends Record<string, unknown>>(
  taskIdentifier: string,
  payload: TPayload,
  options: { idempotencyKey?: string; tags?: string[]; maxAttempts?: number } = {},
) {
  const secret = process.env.TRIGGER_SECRET_KEY?.trim();
  if (!secret) throw new Error("TRIGGER_SECRET_KEY fehlt.");
  if (!taskIdentifier?.trim()) throw new Error("Trigger.dev task identifier fehlt.");

  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_RETRY.maxAttempts);
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(
        `${triggerBaseUrl()}/api/v1/tasks/${encodeURIComponent(taskIdentifier)}/trigger`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${secret}`,
            "content-type": "application/json",
            ...(options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {}),
          },
          body: JSON.stringify({
            payload,
            ...(options.tags?.length ? { options: { tags: options.tags } } : {}),
          }),
          cache: "no-store",
        },
      );

      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        const error = new Error(String(body.error || body.message || `Trigger.dev HTTP ${response.status}`));
        if (response.status < 500 && response.status !== 429) throw error;
        throw Object.assign(error, { retryable: true });
      }
      return body;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      lastError = err;
      const retryable = Boolean((err as Error & { retryable?: boolean }).retryable) || err.name === "TypeError";
      if (!retryable || attempt === maxAttempts) break;
      const delay = Math.min(
        DEFAULT_RETRY.maxTimeoutInMs,
        Math.round(DEFAULT_RETRY.minTimeoutInMs * DEFAULT_RETRY.factor ** (attempt - 1)),
      );
      await sleep(delay);
    }
  }

  throw lastError || new Error("Trigger.dev task could not be triggered");
}

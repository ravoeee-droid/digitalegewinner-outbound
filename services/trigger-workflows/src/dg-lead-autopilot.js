import { task } from "@trigger.dev/sdk";

async function emit(stage, payload) {
  const url = process.env.DG_AUTOPILOT_CALLBACK_URL?.trim();
  if (!url) return { skipped: true };
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(process.env.DG_AUTOPILOT_CALLBACK_SECRET
        ? { authorization: `Bearer ${process.env.DG_AUTOPILOT_CALLBACK_SECRET}` }
        : {}),
    },
    body: JSON.stringify({ stage, ...payload }),
  });
  if (!response.ok) throw new Error(`DG Autopilot callback failed (${response.status})`);
  return response.json().catch(() => ({ ok: true }));
}

function buildExecutionPlan(payload) {
  const temperature = payload?.intelligence?.temperature || "cold";
  const score = Number(payload?.intelligence?.score || 0);
  const signals = Array.isArray(payload?.intelligence?.signals) ? payload.intelligence.signals : [];
  const strongest = [...signals].sort((a, b) => Number(b?.weight || 0) - Number(a?.weight || 0)).slice(0, 3);

  const channels = temperature === "very-hot"
    ? ["call", "personalized-video", "email", "follow-up"]
    : temperature === "hot"
      ? ["personalized-video", "email", "call"]
      : temperature === "warm"
        ? ["email", "call-if-engaged"]
        : ["qualify-first"];

  return {
    score,
    temperature,
    priority: temperature === "very-hot" ? "P0" : temperature === "hot" ? "P1" : temperature === "warm" ? "P2" : "P3",
    channels,
    strongestSignals: strongest.map(signal => ({
      id: signal.id,
      label: signal.label,
      detail: signal.detail,
      weight: signal.weight,
    })),
    opener: payload?.intelligence?.opener || null,
    nextBestAction: payload?.intelligence?.nextBestAction || null,
    assets: {
      personalizedLandingPage: score >= 35,
      personalizedVideo: score >= 55,
      immediateCallTask: score >= 75,
      followUpSequence: score >= 55,
    },
  };
}

export const dgLeadAutopilot = task({
  id: "dg-lead-autopilot",
  retry: {
    maxAttempts: 5,
    factor: 1.6,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 30_000,
    randomize: false,
  },
  run: async payload => {
    const executionPlan = buildExecutionPlan(payload);
    const identity = {
      leadId: payload?.leadId || null,
      company: payload?.company || null,
      url: payload?.url || null,
    };

    await emit("workflow_started", {
      ...identity,
      score: executionPlan.score,
      temperature: executionPlan.temperature,
    });

    await emit("execution_plan_ready", {
      ...identity,
      executionPlan,
    });

    await emit("workflow_completed", {
      ...identity,
      executionPlan,
    });

    return {
      ok: true,
      ...identity,
      executionPlan,
    };
  },
});

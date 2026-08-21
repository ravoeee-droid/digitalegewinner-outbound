"use client";

import { useEffect } from "react";
import PflegeProOS from "./PflegeProOS";

const SESSION_KEY = "dg.pflege.auto-research.v4";
const SESSION_BUDGET = 20;
const PAUSE_MS = 1400;

function idleDelay(ms = 900) {
  return new Promise<void>((resolve) => {
    window.setTimeout(() => {
      const idle = (window as Window & { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number }).requestIdleCallback;
      if (idle) idle(() => resolve(), { timeout: 1600 });
      else resolve();
    }, ms);
  });
}

function AutoResearchBridge() {
  useEffect(() => {
    let cancelled = false;

    async function run() {
      await idleDelay(2400);
      if (cancelled) return;

      const used = Number(window.sessionStorage.getItem(SESSION_KEY) || "0");
      if (used >= SESSION_BUDGET) return;

      try {
        const queueResponse = await fetch(`/api/crm/research-queue?limit=${SESSION_BUDGET - used}`, { cache: "no-store" });
        if (!queueResponse.ok) return;
        const queue = await queueResponse.json() as { ids?: string[] };
        const ids = Array.isArray(queue.ids) ? queue.ids.slice(0, SESSION_BUDGET - used) : [];
        if (!ids.length) {
          window.sessionStorage.setItem(SESSION_KEY, String(SESSION_BUDGET));
          return;
        }

        let processed = used;
        for (const leadId of ids) {
          if (cancelled || processed >= SESSION_BUDGET) return;
          await idleDelay(PAUSE_MS);
          if (cancelled) return;

          const response = await fetch("/api/crm/enrichment", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ leadIds: [leadId], ai: false }),
          });
          if (!response.ok) continue;

          processed += 1;
          window.sessionStorage.setItem(SESSION_KEY, String(processed));
          window.dispatchEvent(new CustomEvent("dg:research-progress", { detail: { processed, budget: SESSION_BUDGET } }));
        }

        window.dispatchEvent(new CustomEvent("dg:research-complete"));
      } catch {
        return;
      }
    }

    void run();
    return () => { cancelled = true; };
  }, []);

  return null;
}

export default function PflegeProRuntime() {
  return (
    <>
      <PflegeProOS />
      <AutoResearchBridge />
    </>
  );
}

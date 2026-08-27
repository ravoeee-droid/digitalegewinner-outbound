"use client";

import { useEffect } from "react";
import PflegeCloserOS from "./PflegeCloserOS";

const SESSION_KEY = "dg.pflege.closer.auto-research.v1";
const SESSION_BUDGET = 12;

function AutoResearchBridge() {
  useEffect(() => {
    let cancelled = false;

    async function run() {
      const used = Number(window.sessionStorage.getItem(SESSION_KEY) || "0");
      if (used >= SESSION_BUDGET) return;
      await new Promise((resolve) => window.setTimeout(resolve, 2200));
      if (cancelled) return;

      try {
        const response = await fetch(`/api/crm/research-queue?limit=${SESSION_BUDGET - used}`, { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json() as { ids?: string[] };
        const ids = Array.isArray(payload.ids) ? payload.ids.slice(0, SESSION_BUDGET - used) : [];
        let processed = used;

        for (const leadId of ids) {
          if (cancelled) return;
          await new Promise((resolve) => window.setTimeout(resolve, 1200));
          const research = await fetch("/api/crm/enrichment", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ leadIds: [leadId], ai: false }),
          });
          if (!research.ok) continue;
          processed += 1;
          window.sessionStorage.setItem(SESSION_KEY, String(processed));
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

export default function PflegeCloserRuntime() {
  return <><PflegeCloserOS /><AutoResearchBridge /></>;
}

"use client";

import { useEffect } from "react";
import PflegeProOS from "./PflegeProOS";

type LeadSnapshot = {
  id: string;
  stage: string;
  metadata?: Record<string, unknown> | null;
};

type CrmSnapshot = { leads?: LeadSnapshot[] };
type EnrichmentMeta = { enrichedAt?: string };

const SESSION_KEY = "dg.pflege.auto-research.v3";
const SESSION_BUDGET = 20;
const BATCH_SIZE = 1;
const PAUSE_MS = 1400;

function hasResearch(lead: LeadSnapshot) {
  const value = lead.metadata?.enrichment;
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && (value as EnrichmentMeta).enrichedAt);
}

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
      await idleDelay(2200);
      if (cancelled) return;

      const used = Number(window.sessionStorage.getItem(SESSION_KEY) || "0");
      if (used >= SESSION_BUDGET) return;
      let processed = used;

      while (!cancelled && processed < SESSION_BUDGET) {
        try {
          const snapshotResponse = await fetch("/api/crm/launch", { cache: "no-store" });
          if (!snapshotResponse.ok) return;
          const snapshot = await snapshotResponse.json() as CrmSnapshot;
          const missing = (snapshot.leads || []).filter((lead) => !hasResearch(lead) && !["Gewonnen", "Verloren"].includes(lead.stage));

          if (!missing.length) {
            window.sessionStorage.setItem(SESSION_KEY, String(SESSION_BUDGET));
            window.dispatchEvent(new CustomEvent("dg:research-complete"));
            return;
          }

          const remaining = SESSION_BUDGET - processed;
          const batch = missing.slice(0, Math.min(BATCH_SIZE, remaining));
          const response = await fetch("/api/crm/enrichment", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ leadIds: batch.map((lead) => lead.id), ai: false }),
          });
          if (!response.ok) return;

          processed += batch.length;
          window.sessionStorage.setItem(SESSION_KEY, String(processed));
          window.dispatchEvent(new CustomEvent("dg:research-progress", { detail: { processed, budget: SESSION_BUDGET } }));
          await idleDelay(PAUSE_MS);
        } catch {
          return;
        }
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

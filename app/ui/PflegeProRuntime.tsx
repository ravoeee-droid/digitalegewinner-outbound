"use client";

import { useCallback, useEffect, useState } from "react";
import PflegeProOS from "./PflegeProOS";

type LeadSnapshot = {
  id: string;
  stage: string;
  metadata?: Record<string, unknown> | null;
};

type CrmSnapshot = { leads?: LeadSnapshot[] };

type EnrichmentMeta = { enrichedAt?: string };

const SESSION_KEY = "dg.pflege.auto-research.v2";
const SESSION_BUDGET = 20;
const BATCH_SIZE = 2;

function hasResearch(lead: LeadSnapshot) {
  const value = lead.metadata?.enrichment;
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && (value as EnrichmentMeta).enrichedAt);
}

function AutoResearchBridge({ onBatch }: { onBatch: () => void }) {
  useEffect(() => {
    let cancelled = false;

    async function run() {
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
            return;
          }

          const remaining = SESSION_BUDGET - processed;
          const batch = missing.slice(0, Math.min(BATCH_SIZE, remaining));
          const response = await fetch("/api/crm/enrichment", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ leadIds: batch.map((lead) => lead.id), ai: true }),
          });
          if (!response.ok) return;

          processed += batch.length;
          window.sessionStorage.setItem(SESSION_KEY, String(processed));
          if (!cancelled) onBatch();
          await new Promise((resolve) => window.setTimeout(resolve, 700));
        } catch {
          return;
        }
      }
    }

    void run();
    return () => { cancelled = true; };
  }, [onBatch]);

  return null;
}

export default function PflegeProRuntime() {
  const [revision, setRevision] = useState(0);
  const refreshWorkspace = useCallback(() => setRevision((value) => value + 1), []);

  return (
    <>
      <PflegeProOS key={revision} />
      <AutoResearchBridge onBatch={refreshWorkspace} />
    </>
  );
}

"use client";

import { useState } from "react";

export default function QualityLeadRunner() {
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [message, setMessage] = useState("Lauf startet nur auf Knopfdruck und füllt niemals mit schwächeren Leads auf.");

  async function run() {
    if (state === "running") return;
    setState("running");
    setMessage("Quality-Lauf aktiv: offene Stellen, Website, Telefon und Dubletten werden geprüft …");
    try {
      const response = await fetch("/api/leads/daily-quality", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(String(data?.error || `HTTP ${response.status}`));
      const ready = Number(data?.after?.ready || 0);
      const target = Number(data?.target || 60);
      setState("done");
      setMessage(`${ready}/${target} strenge Quality-Leads bereit. Ansicht wird aktualisiert …`);
      window.setTimeout(() => window.location.reload(), 900);
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Quality-Lauf fehlgeschlagen.");
    }
  }

  return (
    <div className="qualityRunner">
      <button type="button" onClick={run} disabled={state === "running"}>
        {state === "running" ? "Quality-Lauf läuft …" : "Jetzt bis 60 nachqualifizieren"}
      </button>
      <span data-state={state}>{message}</span>
    </div>
  );
}

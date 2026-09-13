"use client";

import { useState } from "react";
import styles from "./quality-leads.module.css";

export default function QualityLeadRunner() {
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [message, setMessage] = useState("Lauf startet nur auf Knopfdruck und füllt niemals mit schwächeren Leads auf.");

  async function run() {
    if (state === "running") return;
    setState("running");
    setMessage("Quality-Lauf aktiv: Recruiting-Pain, Website, Telefon, Dubletten und Reserve werden geprüft …");
    try {
      const response = await fetch("/api/leads/daily-quality", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(String(data?.error || `HTTP ${response.status}`));
      const ready = Number(data?.after?.ready || 0);
      const target = Number(data?.target || 120);
      const bufferTarget = Number(data?.bufferTarget || 240);
      setState("done");
      setMessage(`${ready} strenge Leads bereit · Tagesziel ${target} · Sicherheitsbestand ${bufferTarget}. Ansicht wird aktualisiert …`);
      window.setTimeout(() => window.location.reload(), 900);
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Quality-Lauf fehlgeschlagen.");
    }
  }

  return (
    <div className={styles.runner}>
      <button type="button" onClick={run} disabled={state === "running"}>
        {state === "running" ? "Quality-Lauf läuft …" : "120 Tagesziel + Reserve auffüllen"}
      </button>
      <span data-state={state}>{message}</span>
    </div>
  );
}

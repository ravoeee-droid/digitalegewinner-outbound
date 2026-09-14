"use client";

import { useState } from "react";

export default function OpenOutreachSyncButton() {
  const [state, setState] = useState("OpenOutreach +50");

  async function sync() {
    setState("OpenOutreach läuft …");
    try {
      const response = await fetch("/api/outbound-engine", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "openoutreach-sync", count: 50 }),
      });
      const data = await response.json();
      if (!response.ok || data?.ok === false) throw new Error(data?.error || "Worker nicht verbunden");
      setState(`+${Number(data?.imported || 0)} importiert`);
      window.setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      setState(error instanceof Error ? error.message : "Worker fehlt");
    }
  }

  return (
    <button
      type="button"
      onClick={() => void sync()}
      style={{
        position: "fixed",
        right: 24,
        top: 20,
        zIndex: 120,
        border: "1px solid rgba(213,255,89,.3)",
        background: "rgba(8,11,15,.92)",
        color: "#34c759",
        borderRadius: 999,
        padding: "9px 13px",
        fontSize: 11,
        fontWeight: 850,
        cursor: "pointer",
        boxShadow: "0 12px 40px rgba(0,0,0,.35)",
        backdropFilter: "blur(16px)",
      }}
      title="OpenOutreach Worker: zusätzliche Entscheider und LinkedIn-Profile in das CRM synchronisieren"
    >
      {state}
    </button>
  );
}

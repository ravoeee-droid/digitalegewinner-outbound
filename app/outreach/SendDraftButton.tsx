"use client";

import { useState } from "react";

export default function SendDraftButton({ outreachId }: { outreachId: string }) {
  const [state, setState] = useState<"idle" | "busy" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  async function send() {
    setState("busy");
    try {
      const response = await fetch("/api/outreach/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ outreachId }),
      });
      const json = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !json.ok) throw new Error(json.error || "Konnte nicht eingeplant werden.");
      setState("sent");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Konnte nicht eingeplant werden.");
      setState("error");
    }
  }

  if (state === "sent") {
    return <span style={{ fontSize: 12, color: "#34c759" }}>Eingeplant ✓</span>;
  }
  return (
    <div>
      <button
        type="button"
        onClick={() => void send()}
        disabled={state === "busy"}
        style={{
          padding: "6px 10px",
          borderRadius: 8,
          border: "1px solid rgba(93,240,184,.3)",
          background: "rgba(93,240,184,.1)",
          color: "#5df0b8",
          fontSize: 12,
          cursor: state === "busy" ? "default" : "pointer",
        }}
      >
        {state === "busy" ? "Plant ein…" : "Senden"}
      </button>
      {state === "error" && <div style={{ marginTop: 6, fontSize: 11, color: "#ff97a3", maxWidth: 220 }}>{message}</div>}
    </div>
  );
}

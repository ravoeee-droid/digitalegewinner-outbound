"use client";

import { useState } from "react";

type Segment = "pflege" | "pv" | "other";

export default function LeadSegmentEditor({ leadId, segment }: { leadId: string; segment: Segment }) {
  const [current, setCurrent] = useState(segment);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function change(next: Segment) {
    if (saving || next === current) return;
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/leads/" + encodeURIComponent(leadId) + "/segment", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ segment: next }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Zuordnung fehlgeschlagen.");
      setCurrent(next);
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Zuordnung fehlgeschlagen.");
    } finally { setSaving(false); }
  }
  return (
    <div style={{ padding: "10px 12px", border: "1px solid #5b493a", borderRadius: 10, display: "grid", gap: 7, background: "#1c1712" }}>
      <label style={{ display: "grid", gap: 5, fontSize: 12, color: "#f5eee5" }}>
        <strong>Geschäftsfeld / Lead-Zuordnung</strong>
        <select value={current} disabled={saving} onChange={(event) => void change(event.target.value as Segment)}
          style={{ color: "#f8eee4", background: "#302720", padding: 10, borderRadius: 8, border: "1px solid #9b724b", font: "inherit" }}>
          <option value="pflege">Pflege-Recruiting</option>
          <option value="pv">PV-Trust</option>
          <option value="other">Unzugeordnet / prüfen</option>
        </select>
      </label>
      {saving && <span style={{ fontSize: 12 }}>Speichere Geschäftsfeld …</span>}
      {current === "other" && <span style={{ color: "#ffad91", fontSize: 12 }}>Bitte prüfen: Nicht für automatische Pflege-/PV-Nachrichten freigeben.</span>}
      {error && <span role="alert" style={{ color: "#ffad91", fontSize: 12 }}>{error}</span>}
    </div>
  );
}

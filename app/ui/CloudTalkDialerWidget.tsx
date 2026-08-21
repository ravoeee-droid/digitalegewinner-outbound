"use client";

import { useEffect, useMemo, useState } from "react";

type Lead = {
  id: string;
  company: string;
  city: string;
  industry: string;
  website: string;
  email: string;
  phone: string;
  stage: string;
  priority_score: number;
};

type Overview = {
  leads: Lead[];
  stats?: { companies: number; leads: number; hot: number; avg_priority: number };
};

type CallState = "idle" | "dialing" | "ringing" | "calling" | "ended";

const dispositions = [
  ["no_answer", "Nicht erreicht"],
  ["callback", "Rückruf"],
  ["interested", "Interesse"],
  ["appointment", "Termin"],
  ["offer", "Angebot senden"],
  ["not_interested", "Kein Interesse"],
  ["wrong_number", "Falsche Nummer"],
] as const;

function cleanPhone(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const cleaned = trimmed.replace(/[^\d+]/g, "");
  if (cleaned.startsWith("00")) return `+${cleaned.slice(2)}`;
  return cleaned;
}

function formatSeconds(total: number) {
  const minutes = Math.floor(total / 60).toString().padStart(2, "0");
  const seconds = (total % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export default function CloudTalkDialerWidget() {
  const [open, setOpen] = useState(false);
  const [overview, setOverview] = useState<Overview>({ leads: [] });
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [callState, setCallState] = useState<CallState>("idle");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [note, setNote] = useState("");
  const [callbackAt, setCallbackAt] = useState("");

  const callable = useMemo(
    () => overview.leads.filter((lead) => cleanPhone(lead.phone) && !["Gewonnen", "Verloren"].includes(lead.stage)),
    [overview.leads],
  );
  const current = callable.find((lead) => lead.id === selectedId) || callable[0];

  async function load() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/crm/overview", { cache: "no-store" });
      const json = await response.json() as Overview & { error?: string };
      if (!response.ok) throw new Error(json.error || "Call-Queue konnte nicht geladen werden.");
      setOverview(json);
      const first = json.leads.find((lead) => cleanPhone(lead.phone) && !["Gewonnen", "Verloren"].includes(lead.stage));
      setSelectedId((value) => value || first?.id || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Call-Queue konnte nicht geladen werden.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!startedAt || callState !== "calling") return;
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [startedAt, callState]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!String(event.origin || "").includes("cloudtalk.io")) return;
      const raw = typeof event.data === "string" ? event.data : event.data?.event || event.data?.type || event.data?.name;
      const eventName = String(raw || "").toLowerCase();
      if (!["dialing", "ringing", "calling", "hangup", "ended"].includes(eventName)) return;
      if (eventName === "calling") {
        setCallState("calling");
        setStartedAt((value) => value || Date.now());
      } else if (eventName === "hangup" || eventName === "ended") {
        setCallState("ended");
      } else {
        setCallState(eventName as CallState);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  async function logEvent(type: string, extra: Record<string, unknown> = {}) {
    if (!current) return;
    try {
      await fetch("/api/crm/call-result", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leadId: current.id, event: type, durationSeconds: elapsed, ...extra }),
      });
    } catch {}
  }

  function startCall() {
    if (!current) return;
    const phone = cleanPhone(current.phone);
    if (!phone) return;
    setCallState("dialing");
    setStartedAt(null);
    setElapsed(0);
    void logEvent("dialing", { phone });
    window.location.href = `ct+tel:${phone}`;
  }

  async function saveDisposition(disposition: string) {
    if (!current) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/crm/call-result", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          leadId: current.id,
          disposition,
          note,
          callbackAt: disposition === "callback" ? callbackAt : "",
          durationSeconds: elapsed,
        }),
      });
      const json = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok) throw new Error(json.error || "Call-Ergebnis konnte nicht gespeichert werden.");
      const index = callable.findIndex((lead) => lead.id === current.id);
      const next = callable[index + 1] || callable[0];
      setNote("");
      setCallbackAt("");
      setCallState("idle");
      setStartedAt(null);
      setElapsed(0);
      await load();
      if (next && next.id !== current.id) setSelectedId(next.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Call-Ergebnis konnte nicht gespeichert werden.");
    } finally {
      setBusy(false);
    }
  }

  const stateLabel: Record<CallState, string> = {
    idle: "Bereit",
    dialing: "Wählt…",
    ringing: "Klingelt…",
    calling: `Im Gespräch · ${formatSeconds(elapsed)}`,
    ended: `Beendet · ${formatSeconds(elapsed)}`,
  };

  return <>
    <button
      onClick={() => { setOpen(true); void load(); }}
      style={{ position: "fixed", right: 24, bottom: 132, zIndex: 85, border: "1px solid #2f6f58", background: "#0d241b", color: "#70f0b3", padding: "12px 15px", borderRadius: 13, fontWeight: 950, cursor: "pointer", boxShadow: "0 18px 45px rgba(0,0,0,.35)" }}
    >☎ CloudTalk Calls</button>

    {open && <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 160, background: "rgba(2,5,9,.88)", backdropFilter: "blur(10px)", padding: 18, overflow: "auto" }}>
      <div onClick={(event) => event.stopPropagation()} style={{ width: "min(1180px,100%)", margin: "20px auto", background: "#08111a", border: "1px solid #243747", borderRadius: 24, padding: 20, color: "#eef7ff", fontFamily: "Inter,system-ui", boxShadow: "0 35px 90px rgba(0,0,0,.45)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "start" }}>
          <div><div style={{ color: "#61e6a5", fontSize: 10, fontWeight: 950, letterSpacing: ".16em" }}>PFLEGE OUTBOUND · CLOUDTALK</div><h2 style={{ margin: "7px 0 4px", fontSize: 28 }}>Call Session</h2><p style={{ margin: 0, color: "#8194a8", fontSize: 12 }}>Priority Queue → anrufen → Ergebnis speichern → nächster Lead.</p></div>
          <div style={{ display: "flex", gap: 8 }}><button onClick={() => void load()} disabled={busy} style={{ border: "1px solid #2d4356", background: "#101c28", color: "#d8e8f5", borderRadius: 10, padding: "9px 12px", cursor: "pointer", fontWeight: 850 }}>↻</button><button onClick={() => setOpen(false)} style={{ border: 0, background: "#172533", color: "white", width: 38, height: 38, borderRadius: 10, cursor: "pointer" }}>×</button></div>
        </div>

        {error && <div style={{ marginTop: 14, border: "1px solid #66323b", background: "#281319", color: "#ff9ca8", borderRadius: 12, padding: 12, fontSize: 12 }}>{error}</div>}

        <div style={{ display: "grid", gridTemplateColumns: "minmax(300px,.75fr) minmax(700px,1.6fr)", gap: 16, marginTop: 18, alignItems: "start" }}>
          <section style={{ border: "1px solid #1e3142", borderRadius: 17, overflow: "hidden", background: "#0b1620" }}>
            <div style={{ padding: 14, borderBottom: "1px solid #1e3142", display: "flex", justifyContent: "space-between" }}><strong>Call Queue</strong><small style={{ color: "#6fe8ab" }}>{callable.length} erreichbar</small></div>
            <div style={{ maxHeight: 270, overflow: "auto" }}>
              {callable.map((lead, index) => <button key={lead.id} onClick={() => { setSelectedId(lead.id); setCallState("idle"); setElapsed(0); setStartedAt(null); }} style={{ display: "block", width: "100%", textAlign: "left", border: 0, borderBottom: "1px solid #152636", padding: 12, background: current?.id === lead.id ? "#123025" : "transparent", color: "#eef7ff", cursor: "pointer" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><strong style={{ fontSize: 12 }}>{index + 1}. {lead.company}</strong><span style={{ color: "#69e7aa", fontSize: 10, fontWeight: 900 }}>{lead.priority_score}</span></div>
                <div style={{ marginTop: 4, color: "#73879a", fontSize: 10 }}>{[lead.city, lead.phone].filter(Boolean).join(" · ")}</div>
              </button>)}
              {!callable.length && <div style={{ padding: 18, color: "#77899b", fontSize: 12 }}>Keine Leads mit Telefonnummer vorhanden.</div>}
            </div>

            {current && <div style={{ padding: 15 }}>
              <div style={{ color: "#8395a8", fontSize: 10, fontWeight: 850 }}>AKTUELLER LEAD</div>
              <h3 style={{ margin: "6px 0 4px", fontSize: 20 }}>{current.company}</h3>
              <div style={{ color: "#9fb0bf", fontSize: 12 }}>{current.phone}</div>
              <div style={{ color: "#687d91", fontSize: 11, marginTop: 4 }}>{[current.city, current.industry, current.stage].filter(Boolean).join(" · ")}</div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14, gap: 8 }}><span style={{ padding: "7px 10px", borderRadius: 999, background: callState === "calling" ? "#163629" : "#142331", color: callState === "calling" ? "#68efad" : "#9fc0da", fontSize: 11, fontWeight: 900 }}>{stateLabel[callState]}</span><button onClick={startCall} style={{ border: 0, background: "#62e9a7", color: "#062116", borderRadius: 11, padding: "11px 15px", fontWeight: 950, cursor: "pointer" }}>☎ Jetzt anrufen</button></div>
              <p style={{ margin: "10px 0 0", color: "#62788c", fontSize: 10, lineHeight: 1.5 }}>Öffnet CloudTalk Desktop per Click-to-Call. Falls die Desktop-App nicht installiert ist, kannst du rechts direkt das eingebettete CloudTalk Phone nutzen.</p>
            </div>}
          </section>

          <section style={{ display: "grid", gap: 12 }}>
            <div style={{ border: "1px solid #1e3142", borderRadius: 17, overflow: "hidden", background: "#0b1620" }}>
              <div style={{ padding: "11px 14px", borderBottom: "1px solid #1e3142", display: "flex", justifyContent: "space-between", alignItems: "center" }}><strong style={{ fontSize: 12 }}>CloudTalk Phone</strong><span style={{ color: "#6e8295", fontSize: 10 }}>Eingebettet · dauerhaft in der Session</span></div>
              <iframe title="CloudTalk Phone" src="https://phone.cloudtalk.io?partner=digitalegewinner-outbound" allow="microphone; autoplay" style={{ width: "100%", minWidth: 700, height: 440, border: 0, background: "#fff" }} />
            </div>

            {current && <div style={{ border: "1px solid #1e3142", borderRadius: 17, padding: 14, background: "#0b1620" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 220px", gap: 10 }}>
                <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Gesprächsnotiz…" rows={2} style={{ width: "100%", resize: "vertical", border: "1px solid #293e51", background: "#08121b", color: "#fff", borderRadius: 10, padding: 10, font: "inherit", fontSize: 12 }} />
                <input type="datetime-local" value={callbackAt} onChange={(event) => setCallbackAt(event.target.value)} style={{ border: "1px solid #293e51", background: "#08121b", color: "#dce8f2", borderRadius: 10, padding: 10, font: "inherit", fontSize: 11 }} />
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 10 }}>
                {dispositions.map(([value, label]) => <button key={value} onClick={() => void saveDisposition(value)} disabled={busy || (value === "callback" && !callbackAt)} style={{ border: "1px solid #294258", background: value === "appointment" ? "#17422f" : value === "interested" ? "#18344d" : "#101e2b", color: value === "appointment" ? "#7bf2b7" : "#d6e6f3", borderRadius: 10, padding: "9px 11px", fontWeight: 850, cursor: "pointer", fontSize: 11, opacity: busy || (value === "callback" && !callbackAt) ? .45 : 1 }}>{label}</button>)}
              </div>
            </div>}
          </section>
        </div>
      </div>
    </div>}
  </>;
}

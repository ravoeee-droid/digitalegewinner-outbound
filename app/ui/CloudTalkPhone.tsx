"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type DialTarget = { leadId: string; company: string; phone: string };
type CloudTalkMessage = Record<string, unknown>;

function readEvent(data: CloudTalkMessage) {
  const value = data.event ?? data.type ?? data.action;
  return typeof value === "string" ? value.toLowerCase() : "";
}

function labelForStatus(status: string) {
  if (["calling", "answered", "connected"].includes(status)) return "Im Gespräch";
  if (["dialing", "ringing"].includes(status)) return "Wählt…";
  if (["hangup", "ended", "completed"].includes(status)) return "Beendet";
  return "Bereit";
}

export default function CloudTalkPhone() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("ready");
  const [target, setTarget] = useState<DialTarget | null>(null);
  const [sessionId, setSessionId] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const targetRef = useRef<DialTarget | null>(null);
  const sessionRef = useRef("");

  useEffect(() => { targetRef.current = target; }, [target]);
  useEffect(() => { sessionRef.current = sessionId; }, [sessionId]);

  useEffect(() => {
    if (!startedAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  useEffect(() => {
    function onDial(event: Event) {
      const detail = (event as CustomEvent<DialTarget>).detail;
      if (!detail?.phone) return;
      const nextSession = crypto.randomUUID();
      setTarget(detail);
      setSessionId(nextSession);
      setStatus("dialing");
      setStartedAt(Date.now());
      setNow(Date.now());
      setOpen(true);
    }
    function onOpen() { setOpen(true); }
    function onClose() { setOpen(false); }
    window.addEventListener("cloudtalk:dial", onDial);
    window.addEventListener("cloudtalk:open", onOpen);
    window.addEventListener("cloudtalk:close", onClose);
    return () => {
      window.removeEventListener("cloudtalk:dial", onDial);
      window.removeEventListener("cloudtalk:open", onOpen);
      window.removeEventListener("cloudtalk:close", onClose);
    };
  }, []);

  useEffect(() => {
    async function persist(event: string, data: CloudTalkMessage) {
      const active = targetRef.current;
      try {
        await fetch("/api/integrations/cloudtalk/event", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            leadId: active?.leadId || "",
            company: active?.company || "",
            event,
            properties: {
              ...data,
              sessionId: sessionRef.current || undefined,
              dialedNumber: active?.phone || undefined,
            },
          }),
        });
      } catch {
        // Telefonie darf durch Telemetriefehler nicht blockiert werden.
      }
    }

    function onMessage(message: MessageEvent<unknown>) {
      if (message.origin !== "https://phone.cloudtalk.io") return;
      if (!message.data || typeof message.data !== "object" || Array.isArray(message.data)) return;
      const data = message.data as CloudTalkMessage;
      const event = readEvent(data);
      if (!event) return;
      setStatus(event);
      if (["dialing", "ringing", "calling", "answered", "connected"].includes(event)) {
        setStartedAt(current => current || Date.now());
      }
      if (["hangup", "ended", "completed"].includes(event)) setStartedAt(null);
      void persist(event, data);
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const duration = useMemo(() => startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0, [now, startedAt]);
  const durationLabel = `${String(Math.floor(duration / 60)).padStart(2, "0")}:${String(duration % 60).padStart(2, "0")}`;

  return <div className={`cloudtalk-shell ${open ? "is-open" : ""}`}>
    <button className="cloudtalk-launcher" onClick={() => setOpen(value => !value)} aria-label="CloudTalk öffnen">
      <span className="cloudtalk-launcher-icon">☎</span>
      <span><strong>CloudTalk</strong><small>{labelForStatus(status)}</small></span>
      <i className="cloudtalk-live-dot" />
    </button>

    {open && <section className="cloudtalk-panel" aria-label="CloudTalk Phone">
      <header className="cloudtalk-panel-head">
        <div>
          <span className="eyebrow">PHONE · LIVE</span>
          <strong>{target?.company || "CloudTalk Phone"}</strong>
          <small>{target?.phone || "Bereit für den nächsten Anruf"}</small>
        </div>
        <div className="cloudtalk-head-actions">
          {startedAt && <span className="cloudtalk-timer">{durationLabel}</span>}
          <button onClick={() => setOpen(false)} aria-label="Schließen">×</button>
        </div>
      </header>
      <div className="cloudtalk-frame-wrap">
        <iframe
          title="CloudTalk Phone"
          src="https://phone.cloudtalk.io?partner=digitalegewinner-outbound"
          allow="microphone; autoplay"
          className="cloudtalk-frame"
        />
      </div>
      <footer className="cloudtalk-panel-foot">
        <span><i className="cloudtalk-live-dot" /> {labelForStatus(status)}</span>
        <small>Calls werden dem aktiven Lead zugeordnet.</small>
      </footer>
    </section>}
  </div>;
}

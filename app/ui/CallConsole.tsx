"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Task = {
  id: string;
  rank: number;
  status: string;
  score: number;
  lead_id: string;
  payload: Record<string, unknown>;
};

type Outcome = "not_reached" | "callback" | "pain" | "appointment" | "no_fit" | "dnc" | "website_requested" | "info_mail";

const outcomes: Array<{ key: string; value: Outcome; label: string }> = [
  { key: "1", value: "not_reached", label: "Nicht erreicht" },
  { key: "2", value: "callback", label: "Rückruf" },
  { key: "3", value: "pain", label: "Pain gefunden" },
  { key: "4", value: "appointment", label: "TERMIN" },
  { key: "5", value: "no_fit", label: "Kein Fit" },
  { key: "6", value: "dnc", label: "Nicht kontaktieren" },
  { key: "7", value: "website_requested", label: "Entwurf gewünscht" },
  { key: "8", value: "info_mail", label: "Info-Mail" },
];

function value(payload: Record<string, unknown>, key: string) {
  const raw = payload?.[key];
  if (Array.isArray(raw)) return raw.map(String).join(" · ");
  return typeof raw === "string" || typeof raw === "number" ? String(raw) : "";
}

function firstNameForScript(contact: string) {
  if (!contact || /geschäftsführung|inhaber|leitung/i.test(contact)) return "";
  return contact.split("/")[0]?.trim() || "";
}

export default function CallConsole() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [callbackOpen, setCallbackOpen] = useState(false);
  const [callbackTime, setCallbackTime] = useState("15:00");
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);

  const pending = useMemo(() => {
    const now = Date.now();
    return tasks
      .filter((task) => !["done", "sent", "completed", "skipped"].includes(task.status))
      .filter((task) => {
        const callbackAt = value(task.payload || {}, "callbackAt");
        return !callbackAt || new Date(callbackAt).getTime() <= now;
      })
      .sort((a, b) => {
        const aCb = value(a.payload || {}, "callbackAt");
        const bCb = value(b.payload || {}, "callbackAt");
        const aDue = aCb && new Date(aCb).getTime() <= now ? 0 : 1;
        const bDue = bCb && new Date(bCb).getTime() <= now ? 0 : 1;
        return aDue - bDue || a.rank - b.rank;
      });
  }, [tasks]);
  const completedCalls = useMemo(() => tasks.filter((task) => ["done", "sent", "completed"].includes(task.status)).length, [tasks]);
  const scheduledCallbacks = useMemo(() => tasks.filter((task) => {
    const callbackAt = value(task.payload || {}, "callbackAt");
    return callbackAt && new Date(callbackAt).getTime() > Date.now();
  }).length, [tasks]);
  const totalCalls = completedCalls + pending.length + scheduledCallbacks;
  const progress = totalCalls ? Math.round((completedCalls / totalCalls) * 100) : 100;
  const active = pending[0] || null;
  const p = active?.payload || {};
  const company = value(p, "company") || "Keine Calls mehr offen";
  const city = value(p, "city");
  const phone = value(p, "phone");
  const website = value(p, "website");
  const contact = value(p, "contactName") || value(p, "contact");
  const contactEmail = value(p, "contactEmail");
  const contactPhone = value(p, "contactPhone");
  const extremeHot = p?.extremeHot === true;
  const campaign = value(p, "campaign");
  const baJobsUrl = company && company !== "Keine Calls mehr offen"
    ? `https://www.arbeitsagentur.de/jobsuche/suche?angebotsart=1&suchbereich=jobs&was=${encodeURIComponent(company)}`
    : "";
  const isPflegeRecruiting = true; // Sales focus: Pflege only
  const hook = value(p, "message") || value(p, "reasons") || (isPflegeRecruiting
    ? "Kurz den aktuellen Recruiting-Bedarf und den Bewerberweg über die Website prüfen."
    : "Im Gespräch kurz prüfen, was mit verpassten oder parallelen Anrufen passiert.");
  const scriptName = firstNameForScript(contact);
  const opener = isPflegeRecruiting
    ? `„Hallo${scriptName ? ` ${scriptName}` : ""}, Raphael Hermann hier, grüße Sie. Ich hab gesehen, dass Sie aktuell Pflegekräfte suchen und hab mir deshalb kurz Ihren Online-Auftritt angesehen. Kann ich Ihnen in 30 Sekunden sagen, was mir aufgefallen ist?“`
    : `„Hallo${scriptName ? ` ${scriptName}` : ""}, Raphael Hermann hier, grüße Sie. Ich wollte Ihnen eigentlich erst eine Mail schicken, dann dachte ich, ich ruf lieber kurz an. Kann ich kurz sagen, warum ich anrufe?“`;
  const question = isPflegeRecruiting
    ? "„Woher kommen Ihre Bewerbungen aktuell hauptsächlich – Jobportale, Empfehlungen oder tatsächlich über Ihre eigene Website?“"
    : "„Was passiert bei Ihnen aktuell, wenn zwei Kunden gleichzeitig anrufen und keiner rangehen kann?“";

  const load = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/call-console", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Call Queue konnte nicht geladen werden.");
      setTasks(data.tasks || []);
    } catch (e) { setError(e instanceof Error ? e.message : "Call Queue konnte nicht geladen werden."); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      fetch("/api/call-console", { cache: "no-store" })
        .then((res) => res.json())
        .then((data) => { if (Array.isArray(data?.tasks)) setTasks(data.tasks); })
        .catch(() => undefined);
    }, 30000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(""), 2800); return () => window.clearTimeout(timer); }, [toast]);

  const dial = useCallback(() => {
    if (!active || !phone) return;
    window.dispatchEvent(new CustomEvent("cloudtalk:dial", { detail: { leadId: active.lead_id, company, phone } }));
    window.location.href = `tel:${phone.replace(/[^+\d]/g, "")}`;
  }, [active, company, phone]);

  const markExtremeHot = useCallback(async () => {
    if (!active || busy) return;
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/call-console", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: active.id, action: "extreme_hot", value: !extremeHot }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Extrem-Hot-Status konnte nicht gespeichert werden.");
      setTasks(data.tasks || []);
      setToast(!extremeHot ? `🔥 ${company} ist jetzt Extrem Hot` : `${company}: Extrem Hot entfernt`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Extrem-Hot-Status konnte nicht gespeichert werden.");
    } finally { setBusy(false); }
  }, [active, busy, company, extremeHot]);

  const enableNotifications = useCallback(async () => {
    try {
      if ("serviceWorker" in navigator) {
        await navigator.serviceWorker.register("/callback-sw.js");
      }
      if (!("Notification" in window)) {
        setError("Browser-Benachrichtigungen werden auf diesem Gerät nicht unterstützt.");
        return;
      }
      const permission = await Notification.requestPermission();
      setNotificationsEnabled(permission === "granted");
      setToast(permission === "granted" ? "🔔 Rückruf-Erinnerungen aktiviert" : "Benachrichtigungen nicht freigegeben");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Benachrichtigungen konnten nicht aktiviert werden.");
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setNotificationsEnabled("Notification" in window && Notification.permission === "granted");
  }, []);

  useEffect(() => {
    const now = Date.now();
    for (const task of tasks) {
      const callbackAt = value(task.payload || {}, "callbackAt");
      if (!callbackAt || new Date(callbackAt).getTime() > now) continue;
      const key = `callback-notified:${task.id}:${callbackAt}`;
      if (window.localStorage.getItem(key)) continue;
      window.localStorage.setItem(key, "1");
      const taskCompany = value(task.payload || {}, "company") || "Lead";
      setToast(`🔔 Rückruf fällig: ${taskCompany}`);
      if ("Notification" in window && Notification.permission === "granted") {
        if ("serviceWorker" in navigator) {
          navigator.serviceWorker.ready
            .then((reg) => reg.showNotification("Rückruf jetzt fällig", {
              body: `${taskCompany} wartet auf deinen Rückruf.`,
              tag: `callback-${task.id}`,
              data: { url: "/call" },
            }))
            .catch(() => undefined);
        } else {
          new Notification("Rückruf jetzt fällig", { body: `${taskCompany} wartet auf deinen Rückruf.` });
        }
      }
    }
  }, [tasks]);

  const saveOutcome = useCallback(async (outcome: Outcome, callbackPreset?: "30m" | "afternoon" | "time") => {
    if (!active || busy) return;
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/call-console", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: active.id, outcome, note, opener: "A", callbackPreset, callbackTime: callbackPreset === "time" ? callbackTime : undefined }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Ergebnis konnte nicht gespeichert werden.");
      setTasks(data.tasks || []); setNote(""); setCallbackOpen(false);
      if (outcome === "website_requested") {
        setToast(data.websiteProject ? `✓ ${company}: Website-Projekt im Build Stream angelegt` : `Call gespeichert · Build-Verknüpfung prüfen${data.integrationWarning ? `: ${data.integrationWarning}` : ""}`);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Ergebnis konnte nicht gespeichert werden."); }
    finally { setBusy(false); }
  }, [active, busy, callbackTime, company, note]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT" || tag === "BUTTON" || tag === "A") return;
      if (e.key === "Enter") { e.preventDefault(); dial(); return; }
      const hit = outcomes.find((item) => item.key === e.key);
      if (hit) {
        e.preventDefault();
        if (hit.value === "callback") setCallbackOpen(true);
        else void saveOutcome(hit.value);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dial, saveOutcome]);

  return (
    <main className="rapid-root" aria-busy={busy}>
      <style>{css}</style>
      <a className="skip-link" href="#call-script">Direkt zum Gesprächsskript</a>
      <header className="rapid-head">
        <div className="rapid-brand">
          <div className="rapid-brand-mark">DG</div>
          <div><span>PFLEGE · CALL COCKPIT</span><strong>Fokus auf den nächsten Abschluss.</strong></div>
        </div>
        <div className="rapid-head-actions">
          <button className="rapid-notify" onClick={() => void enableNotifications()}>{notificationsEnabled ? "🔔 Erinnerungen aktiv" : "🔔 Erinnerungen aktivieren"}</button>
          <div className="rapid-keys" aria-label="Tastaturkürzel">ENTER = CALL · 1–8 = ERGEBNIS</div>
        </div>
      </header>
      <section className="rapid-progress" aria-label="Fortschritt der Call Queue">
        <div><span>Heute erledigt</span><strong>{completedCalls}</strong></div>
        <div><span>Noch offen</span><strong>{pending.length}</strong></div>
        <div><span>Rückrufe geplant</span><strong>{scheduledCallbacks}</strong></div>
        <div className="rapid-progress-bar"><span><i style={{ width: `${progress}%` }} /></span><strong>{progress}%</strong></div>
      </section>
      {error && <div className="rapid-error" role="alert">{error}</div>}
      {toast && <div className="rapid-toast" role="status">{toast}</div>}

      {!active ? (
        <section className="rapid-done" aria-live="polite"><div aria-hidden="true">✓</div><h1>Queue leer.</h1><p>Alle vorbereiteten Calls sind durch.</p></section>
      ) : (
        <section className="rapid-card" aria-label={`Aktiver Lead: ${company}`}>
          <div className="rapid-topline">
            <span className="rapid-live-dot"><i /> LIVE QUEUE</span>
            <div><span>Lead #{active.rank}</span><span className="rapid-score">Score {active.score}/100</span></div>
          </div>
          <div className="rapid-main">
            <section className="rapid-company" aria-labelledby="company-name">
              <p>AKTUELLER LEAD</p><h1 id="company-name">{company}</h1>
              <div className="rapid-meta">
                {city && <span>{city}</span>}
                <span className={contact ? "" : "missing"}>👤 {contact || "Ansprechpartner fehlt"}</span>
                {contactPhone && <span>☎ {contactPhone}</span>}
                {contactEmail && <span>✉ {contactEmail}</span>}
                {extremeHot && <span className="extreme-hot-pill">🔥 EXTREM HOT</span>}
              </div>
              <div className="rapid-primary-actions">
                <button className="rapid-phone" onClick={dial} disabled={!phone || busy} aria-label={`${company} unter ${phone || "unbekannter Nummer"} anrufen`}>
                  <small>ENTER · JETZT ANRUFEN</small><strong>{phone || "Keine Nummer"}</strong>
                </button>
                <button className={`rapid-hot ${extremeHot ? "active" : ""}`} onClick={() => void markExtremeHot()} disabled={busy}>
                  <span>{extremeHot ? "🔥" : "♨"}</span>
                  <div><strong>{extremeHot ? "EXTREM HOT" : "Extrem Hot"}</strong><small>{extremeHot ? "Im Closing-Fokus" : "Lead priorisieren"}</small></div>
                </button>
              </div>
              <div className="rapid-links">
                {website && <a className="rapid-site" href={website} target="_blank" rel="noreferrer">Website öffnen <span aria-hidden="true">↗</span></a>}
                {baJobsUrl && <a className="rapid-ba" href={baJobsUrl} target="_blank" rel="noreferrer" title={`Offene Stellen von ${company} in der Jobsuche der Bundesagentur prüfen`}>🔎 BA Jobs prüfen <span aria-hidden="true">↗</span></a>}
              </div>
            </section>
            <section className="rapid-script" id="call-script" aria-labelledby="script-title" tabIndex={-1}>
              <p id="script-title">DU SAGST</p><blockquote>{opener}</blockquote>
              <div className="rapid-hook"><span>AUFHÄNGER FÜR DIESEN BETRIEB</span><strong>{hook}</strong></div>
              <div className="rapid-question"><span>DANN FRAGEN</span><strong>{question}</strong></div>
            </section>
          </div>
          <section className="rapid-bottom" aria-label="Call-Ergebnis erfassen">
            <div className="rapid-bottom-head"><div><span>CALL ABSCHLIESSEN</span><strong>Was ist passiert?</strong></div><small>Ein Klick speichert und lädt den nächsten Lead.</small></div>
            <label className="sr-only" htmlFor="call-note">Kurze Notiz zum Gespräch</label>
            <textarea id="call-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Kurze Notiz: Bedarf, Einwand, Rückrufgrund …" rows={2} />
            <div className="rapid-outcomes" role="group" aria-label="Call-Ergebnis auswählen">
              {outcomes.map((item) => <button key={item.value} className={item.value === "appointment" ? "appointment" : item.value === "website_requested" ? "website-request" : item.value === "info_mail" ? "info-mail" : item.value === "callback" ? "callback" : item.value === "pain" ? "pain" : item.value === "dnc" ? "dnc" : ""} onClick={() => item.value === "callback" ? setCallbackOpen(true) : void saveOutcome(item.value)} disabled={busy} aria-label={`${item.key}: ${item.label}. Ergebnis speichern und zum nächsten Lead wechseln.`}><kbd aria-hidden="true">{item.key}</kbd><span>{item.label}</span></button>)}
            </div>
          </section>
          {callbackOpen && (
            <div className="callback-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setCallbackOpen(false); }}>
              <section className="callback-panel" role="dialog" aria-modal="true" aria-label="Rückruf planen">
                <div className="callback-title"><div><span>RÜCKRUF PLANEN</span><strong>Wann soll dieser Lead wieder auftauchen?</strong></div><button onClick={() => setCallbackOpen(false)} aria-label="Schließen">×</button></div>
                <p>Bis dahin verschwindet der Lead aus der Call Queue. Zur Fälligkeit kommt er automatisch wieder nach vorne.</p>
                <div className="callback-actions">
                  <button className="quick" onClick={() => void saveOutcome("callback", "30m")} disabled={busy}><span>⏱</span><div><strong>In 30 Minuten</strong><small>Schneller Rückruf</small></div></button>
                  <button className="quick" onClick={() => void saveOutcome("callback", "afternoon")} disabled={busy}><span>☀</span><div><strong>Heute Nachmittag</strong><small>15:00 Uhr DE</small></div></button>
                  <div className="callback-custom">
                    <label><span>Konkrete Uhrzeit · Deutschland</span><input type="time" value={callbackTime} onChange={(e) => setCallbackTime(e.target.value)} /></label>
                    <button className="save-time" onClick={() => void saveOutcome("callback", "time")} disabled={busy}>Rückruf speichern →</button>
                  </div>
                </div>
              </section>
            </div>
          )}
        </section>
      )}
    </main>
  );
}

const css = `
*{box-sizing:border-box}html{font-size:16px;background:#07090c}body{margin:0;background:#07090c;color:#f7f8fa}button,a,textarea,input{font:inherit}button,a{touch-action:manipulation}
.rapid-root{min-height:100vh;background:radial-gradient(circle at 75% -10%,rgba(52,199,89,.09),transparent 28%),linear-gradient(180deg,#090c10 0%,#06080b 100%);color:#f7f8fa;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:.9rem 1rem 1.2rem;overflow-x:hidden}.skip-link{position:absolute;left:.75rem;top:.5rem;z-index:1000;transform:translateY(-180%);background:#fff;color:#000;padding:.65rem .8rem;border-radius:.5rem;font-weight:900;text-decoration:none}.skip-link:focus{transform:translateY(0)}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.rapid-head{max-width:1440px;margin:0 auto;min-height:4.1rem;display:flex;align-items:center;justify-content:space-between;gap:1rem;border-bottom:1px solid rgba(255,255,255,.08);padding:.2rem .1rem .8rem}.rapid-brand{display:flex!important;align-items:center!important;gap:.75rem!important}.rapid-brand-mark{display:grid;place-items:center;width:2.35rem;height:2.35rem;border-radius:.7rem;background:linear-gradient(145deg,#4be078,#24a94d);color:#031007;font-size:.76rem;font-weight:1000;letter-spacing:-.03em;box-shadow:0 8px 28px rgba(52,199,89,.18)}.rapid-brand>div:last-child{display:flex;flex-direction:column;gap:.08rem}.rapid-brand span{font-size:.68rem!important;letter-spacing:.12em!important;color:#65e78b!important}.rapid-brand strong{font-size:1rem!important;letter-spacing:-.01em;color:#f3f5f7}.rapid-head-actions{display:flex;align-items:center;gap:.7rem}.rapid-notify{border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.045);color:#e9edf1;border-radius:.65rem;padding:.58rem .75rem;font-size:.76rem;font-weight:800;cursor:pointer;transition:.18s ease}.rapid-notify:hover{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.2)}.rapid-keys{font-size:.7rem;color:#7e8791;font-weight:800;letter-spacing:.04em;line-height:1.3}
.rapid-progress{max-width:1440px;margin:.75rem auto 0;display:grid;grid-template-columns:repeat(3,minmax(8rem,.55fr)) minmax(15rem,1.4fr);gap:.5rem}.rapid-progress>div{border:1px solid rgba(255,255,255,.075);background:rgba(255,255,255,.025);border-radius:.75rem;padding:.65rem .8rem;display:flex;justify-content:space-between;align-items:baseline}.rapid-progress span{font-size:.72rem;color:#8e98a2;font-weight:750}.rapid-progress strong{font-size:1rem;color:#f7f8fa}.rapid-progress-bar{gap:.7rem!important}.rapid-progress-bar>span{position:relative;flex:1;height:.36rem;border-radius:999px;background:#171c22;overflow:hidden}.rapid-progress-bar i{position:absolute;inset:0 auto 0 0;border-radius:999px;background:linear-gradient(90deg,#27b954,#54e17e)}
.rapid-error,.rapid-toast{position:sticky;top:.5rem;z-index:40;max-width:56rem;margin:.65rem auto;border-radius:.75rem;padding:.72rem .9rem;font-size:.86rem;font-weight:800;box-shadow:0 18px 50px rgba(0,0,0,.38);backdrop-filter:blur(14px)}.rapid-error{background:rgba(86,12,24,.95);border:1px solid #ff6b7c}.rapid-toast{background:rgba(17,45,27,.96);border:1px solid #3bd36b;color:#c6f9d4}
.rapid-card{display:flex;flex-direction:column;max-width:1440px;margin:0 auto;padding-top:.65rem}.rapid-topline{display:flex;justify-content:space-between;align-items:center;color:#89929c;font-size:.73rem;font-weight:800;padding:0 .1rem .5rem}.rapid-topline>div{display:flex;gap:.65rem}.rapid-live-dot{display:flex;align-items:center;gap:.38rem;letter-spacing:.08em;color:#70dc91}.rapid-live-dot i{width:.42rem;height:.42rem;border-radius:50%;background:#34c759;box-shadow:0 0 0 .22rem rgba(52,199,89,.11)}.rapid-score{border-left:1px solid #2b3138;padding-left:.65rem}
.rapid-main{display:grid;grid-template-columns:minmax(20rem,.82fr) minmax(31rem,1.28fr);gap:.75rem}.rapid-company,.rapid-script{border:1px solid rgba(255,255,255,.09);background:linear-gradient(180deg,rgba(17,21,26,.96),rgba(11,14,18,.96));border-radius:1rem;padding:1.15rem;box-shadow:0 22px 60px rgba(0,0,0,.18)}.rapid-company{display:flex;flex-direction:column;min-height:25rem}.rapid-company>p,.rapid-script>p{margin:0 0 .65rem;font-size:.68rem;color:#7f8993;font-weight:950;letter-spacing:.14em}.rapid-company h1{font-size:clamp(2rem,3.1vw,3.25rem);line-height:1.02;letter-spacing:-.045em;margin:0 0 .8rem;max-width:42rem}.rapid-meta{display:flex;gap:.42rem;flex-wrap:wrap}.rapid-meta span{border:1px solid rgba(255,255,255,.105);background:#11161b;border-radius:999px;padding:.4rem .6rem;font-size:.78rem;color:#dfe4e8;font-weight:720;line-height:1.25}.rapid-meta span.missing{border-color:#715522;color:#f2c66f}.rapid-meta span.extreme-hot-pill{border-color:#a94222;background:#2a1109;color:#ff9c75}
.rapid-primary-actions{margin-top:auto;display:grid;grid-template-columns:minmax(0,1fr) 9.5rem;gap:.55rem;align-items:stretch}.rapid-phone{min-height:4.8rem;border:1px solid #55da7d;border-radius:.85rem;background:linear-gradient(145deg,#43d36d,#2bbb57);color:#031008;padding:.72rem .95rem;text-align:left;cursor:pointer;font-weight:950;box-shadow:0 14px 34px rgba(52,199,89,.16);transition:.18s ease}.rapid-phone:hover{transform:translateY(-1px);filter:brightness(1.05)}.rapid-phone:disabled{opacity:.5;cursor:not-allowed;transform:none}.rapid-phone small{display:block;font-size:.66rem;font-weight:950;letter-spacing:.09em;margin-bottom:.18rem;opacity:.76}.rapid-phone strong{display:block;font-size:clamp(1.35rem,2vw,2.15rem);line-height:1.05;letter-spacing:-.025em;overflow-wrap:anywhere}.rapid-hot{min-height:4.8rem;border:1px solid #814326;border-radius:.85rem;background:linear-gradient(180deg,#24130d,#190d09);color:#ffb08f;font-weight:900;cursor:pointer;padding:.65rem .7rem;display:flex;align-items:center;gap:.55rem;text-align:left}.rapid-hot>span{font-size:1.25rem}.rapid-hot>div{display:flex;flex-direction:column}.rapid-hot strong{font-size:.78rem;letter-spacing:.04em}.rapid-hot small{font-size:.65rem;color:#b98169;margin-top:.12rem}.rapid-hot:hover{border-color:#b55e34}.rapid-hot.active{background:linear-gradient(145deg,#ef6a36,#ff7e47);border-color:#ff8f64;color:#1d0802}.rapid-hot.active small{color:#4b1809}.rapid-hot:disabled{opacity:.5;cursor:not-allowed}
.rapid-links{display:flex;gap:.45rem;flex-wrap:wrap;margin-top:.5rem}.rapid-site,.rapid-ba{display:inline-flex;align-items:center;min-height:2.45rem;color:#dbe0e5;font-size:.76rem;font-weight:800;text-decoration:none;border-radius:.6rem;padding:.42rem .65rem;transition:.18s ease}.rapid-site{border:1px solid rgba(255,255,255,.1);background:#11161b}.rapid-site:hover{background:#171d23}.rapid-ba{border:1px solid #6a2630;background:#220c10;color:#f2cbd0}.rapid-ba:hover{background:#321116;border-color:#993645}
.rapid-script{display:flex;flex-direction:column;justify-content:center;scroll-margin-top:.75rem}.rapid-script blockquote{margin:0;color:#f7f9fa;font-size:clamp(1.1rem,1.7vw,1.55rem);line-height:1.38;letter-spacing:-.018em;font-weight:700;max-width:58rem}.rapid-hook,.rapid-question{margin-top:1rem;border-top:1px solid rgba(255,255,255,.08);padding-top:.8rem}.rapid-hook span,.rapid-question span{display:block;color:#5fdc85;font-size:.66rem;font-weight:950;letter-spacing:.11em;margin-bottom:.4rem}.rapid-hook strong{display:block;font-size:clamp(.96rem,1.12vw,1.14rem);line-height:1.42;color:#e6eaed;font-weight:700}.rapid-question strong{display:block;font-size:clamp(1.02rem,1.24vw,1.24rem);line-height:1.4;color:#fff}
.rapid-bottom{position:sticky;bottom:.55rem;z-index:15;margin-top:.75rem;padding:.82rem;border:1px solid rgba(255,255,255,.1);background:rgba(10,13,17,.94);border-radius:1rem;box-shadow:0 -12px 50px rgba(0,0,0,.24),0 20px 50px rgba(0,0,0,.28);backdrop-filter:blur(18px)}.rapid-bottom-head{display:flex;align-items:end;justify-content:space-between;gap:1rem;margin-bottom:.55rem}.rapid-bottom-head>div{display:flex;flex-direction:column}.rapid-bottom-head span{font-size:.64rem;color:#69737d;letter-spacing:.12em;font-weight:950}.rapid-bottom-head strong{font-size:.96rem;color:#f5f7f8;margin-top:.08rem}.rapid-bottom-head small{font-size:.69rem;color:#707983}.rapid-bottom textarea{width:100%;min-height:2.9rem;max-height:7rem;resize:vertical;border:1px solid rgba(255,255,255,.11);background:#0d1115;color:#f5f7f8;border-radius:.65rem;padding:.62rem .75rem;outline:none;margin-bottom:.5rem;font-size:.82rem;line-height:1.35;transition:.18s ease}.rapid-bottom textarea:focus{border-color:#4c6f59;background:#10161a}.rapid-bottom textarea::placeholder{color:#626c75}.rapid-outcomes{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:.42rem}.rapid-outcomes button{min-height:3.2rem;border:1px solid rgba(255,255,255,.11);background:#12171c;color:#dfe4e8;border-radius:.65rem;font-size:.73rem;font-weight:900;cursor:pointer;padding:.45rem .32rem;line-height:1.12;transition:.15s ease}.rapid-outcomes button:hover{transform:translateY(-1px);background:#1a2026;border-color:rgba(255,255,255,.2)}.rapid-outcomes button:disabled{opacity:.5;transform:none}.rapid-outcomes button.appointment{background:linear-gradient(145deg,#43d36d,#2bbb57);color:#031008;border-color:#62e289;box-shadow:0 9px 24px rgba(52,199,89,.14)}.rapid-outcomes button.callback{border-color:#7f5d22;background:#251a08;color:#f1cf8a}.rapid-outcomes button.pain{border-color:#415d87;background:#0e1829;color:#c9dcff}.rapid-outcomes button.website-request{border-color:#665080;background:#181223;color:#ddcff2}.rapid-outcomes button.info-mail{border-color:#2f7662;background:#0d221c;color:#aaf3db}.rapid-outcomes button.dnc{color:#9ea5ac}.rapid-outcomes kbd{display:inline-grid;place-items:center;min-width:1.35rem;height:1.35rem;margin-right:.28rem;border:1px solid currentColor;border-radius:.3rem;background:transparent;font-family:inherit;font-size:.65rem;font-weight:950;opacity:.72}
.callback-backdrop{position:fixed;inset:0;z-index:100;background:rgba(2,4,6,.72);backdrop-filter:blur(8px);display:grid;place-items:center;padding:1rem}.callback-panel{width:min(38rem,100%);border:1px solid rgba(255,255,255,.12);background:linear-gradient(180deg,#15191e,#0d1115);border-radius:1.1rem;padding:1rem;box-shadow:0 30px 100px rgba(0,0,0,.55)}.callback-title{display:flex;justify-content:space-between;gap:1rem;align-items:flex-start}.callback-title>div{display:flex;flex-direction:column;gap:.15rem}.callback-title span{font-size:.65rem;letter-spacing:.12em;color:#d1a34b;font-weight:950}.callback-title strong{font-size:1.18rem;letter-spacing:-.015em}.callback-title>button{width:2.1rem;height:2.1rem;border:1px solid rgba(255,255,255,.1);background:#11161b;color:#d9dee2;border-radius:.6rem;cursor:pointer;font-size:1.2rem}.callback-panel>p{margin:.65rem 0 .8rem;color:#87919a;font-size:.8rem;line-height:1.45}.callback-actions{display:grid;grid-template-columns:1fr 1fr;gap:.55rem}.callback-actions .quick{min-height:4.6rem;border:1px solid #72531c;background:#221806;color:#f4d395;border-radius:.8rem;padding:.65rem;display:flex;align-items:center;gap:.65rem;text-align:left;cursor:pointer}.callback-actions .quick>span{font-size:1.4rem}.callback-actions .quick>div{display:flex;flex-direction:column}.callback-actions .quick strong{font-size:.86rem}.callback-actions .quick small{font-size:.68rem;color:#ad915c;margin-top:.12rem}.callback-custom{grid-column:1/-1;display:grid;grid-template-columns:1fr auto;gap:.55rem;align-items:end;border-top:1px solid rgba(255,255,255,.08);padding-top:.7rem}.callback-custom label{display:flex;flex-direction:column;gap:.28rem}.callback-custom label span{font-size:.68rem;color:#808a94;font-weight:800}.callback-custom input{min-height:2.8rem;border:1px solid rgba(255,255,255,.12);background:#0a0e12;color:#fff;border-radius:.6rem;padding:.4rem .6rem}.callback-custom .save-time{min-height:2.8rem;border:1px solid #5bd87e;background:#34c759;color:#041008;border-radius:.6rem;padding:.45rem .8rem;font-weight:950;cursor:pointer}
.rapid-done{min-height:calc(100vh - 9rem);display:grid;place-content:center;text-align:center}.rapid-done div{font-size:3.6rem;color:#34c759}.rapid-done h1{font-size:2rem;margin:.25rem 0}.rapid-done p{color:#7f8992;font-size:.9rem}
button:focus-visible,a:focus-visible,textarea:focus-visible,input:focus-visible,.rapid-script:focus-visible{outline:2px solid #fff;outline-offset:3px;box-shadow:0 0 0 5px rgba(50,108,255,.6)}
@media(max-width:1200px){.rapid-progress{grid-template-columns:repeat(3,1fr)}.rapid-progress-bar{grid-column:1/-1}.rapid-outcomes{grid-template-columns:repeat(4,1fr)}}
@media(max-width:1100px){html{font-size:15px}.rapid-main{grid-template-columns:1fr}.rapid-company{min-height:auto}.rapid-primary-actions{margin-top:1rem}.rapid-outcomes{grid-template-columns:repeat(3,1fr)}}
@media(max-width:700px){html{font-size:15px}.rapid-root{padding:.55rem}.rapid-head{align-items:flex-start}.rapid-head-actions{align-items:flex-end}.rapid-keys{display:none}.rapid-progress{grid-template-columns:repeat(3,1fr);gap:.35rem}.rapid-progress>div{padding:.55rem .5rem;flex-direction:column;gap:.1rem}.rapid-progress-bar{grid-column:1/-1;flex-direction:row!important}.rapid-company,.rapid-script{padding:.9rem}.rapid-company h1{font-size:1.9rem}.rapid-primary-actions{grid-template-columns:1fr}.rapid-hot{min-height:3.7rem}.rapid-bottom{bottom:.25rem;padding:.65rem}.rapid-bottom-head small{display:none}.rapid-outcomes{grid-template-columns:repeat(2,1fr)}.rapid-outcomes button{min-height:3.4rem}.rapid-topline{font-size:.72rem}.callback-actions{grid-template-columns:1fr}.callback-custom{grid-column:1;grid-template-columns:1fr}.callback-custom .save-time{width:100%}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;transition:none!important;animation:none!important}}
@media(forced-colors:active){.rapid-phone,.rapid-outcomes button.appointment,.rapid-outcomes button.website-request{forced-color-adjust:auto}.rapid-company,.rapid-script,.rapid-meta span,.rapid-bottom textarea,.rapid-outcomes button{border:2px solid CanvasText}}
`;

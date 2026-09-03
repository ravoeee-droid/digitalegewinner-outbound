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

type Outcome = "not_reached" | "callback" | "pain" | "appointment" | "no_fit" | "dnc";

const outcomes: Array<{ key: string; value: Outcome; label: string }> = [
  { key: "1", value: "not_reached", label: "Nicht erreicht" },
  { key: "2", value: "callback", label: "Rückruf" },
  { key: "3", value: "pain", label: "Pain gefunden" },
  { key: "4", value: "appointment", label: "TERMIN" },
  { key: "5", value: "no_fit", label: "Kein Fit" },
  { key: "6", value: "dnc", label: "Nicht kontaktieren" },
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

  const pending = useMemo(
    () => tasks.filter((task) => !["done", "sent", "completed", "skipped"].includes(task.status)),
    [tasks],
  );
  const active = pending[0] || null;
  const p = active?.payload || {};

  const company = value(p, "company") || "Keine Calls mehr offen";
  const city = value(p, "city");
  const phone = value(p, "phone");
  const website = value(p, "website");
  const contact = value(p, "contactName");
  const hook = value(p, "message") || value(p, "reasons") || "Im Gespräch kurz prüfen, was mit verpassten oder parallelen Anrufen passiert.";
  const scriptName = firstNameForScript(contact);

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/call-console", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Call Queue konnte nicht geladen werden.");
      setTasks(data.tasks || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Call Queue konnte nicht geladen werden.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const dial = useCallback(() => {
    if (!active || !phone) return;
    window.dispatchEvent(new CustomEvent("cloudtalk:dial", {
      detail: { leadId: active.lead_id, company, phone },
    }));
    window.location.href = `tel:${phone.replace(/[^+\d]/g, "")}`;
  }, [active, company, phone]);

  const saveOutcome = useCallback(async (outcome: Outcome) => {
    if (!active || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/call-console", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: active.id, outcome, note, opener: "A" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Ergebnis konnte nicht gespeichert werden.");
      setTasks(data.tasks || []);
      setNote("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ergebnis konnte nicht gespeichert werden.");
    } finally {
      setBusy(false);
    }
  }, [active, busy, note]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT" || tag === "BUTTON" || tag === "A") return;
      if (e.key === "Enter") {
        e.preventDefault();
        dial();
        return;
      }
      const hit = outcomes.find((item) => item.key === e.key);
      if (hit) {
        e.preventDefault();
        void saveOutcome(hit.value);
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
        <div>
          <span>SHK · RAPID CALL</span>
          <strong aria-live="polite">{pending.length} offen</strong>
        </div>
        <div className="rapid-keys" aria-label="Tastaturkürzel">ENTER = CALL · 1–6 = ERGEBNIS → NÄCHSTER</div>
      </header>

      {error && <div className="rapid-error" role="alert">{error}</div>}

      {!active ? (
        <section className="rapid-done" aria-live="polite">
          <div aria-hidden="true">✓</div>
          <h1>Queue leer.</h1>
          <p>Alle vorbereiteten SHK-Calls sind durch.</p>
        </section>
      ) : (
        <section className="rapid-card" aria-label={`Aktiver Lead: ${company}`}>
          <div className="rapid-topline">
            <span>Lead #{active.rank}</span>
            <span>Score {active.score} von 100</span>
          </div>

          <div className="rapid-main">
            <section className="rapid-company" aria-labelledby="company-name">
              <p>NÄCHSTER LEAD</p>
              <h1 id="company-name">{company}</h1>
              <div className="rapid-meta">
                {city && <span>{city}</span>}
                {contact && <span>{contact}</span>}
              </div>

              <button
                className="rapid-phone"
                onClick={dial}
                disabled={!phone || busy}
                aria-label={`${company} unter ${phone || "unbekannter Nummer"} anrufen`}
              >
                <small>ENTER · ANRUFEN</small>
                <strong>{phone || "Keine Nummer"}</strong>
              </button>

              {website && (
                <a className="rapid-site" href={website} target="_blank" rel="noreferrer">
                  Website öffnen <span aria-hidden="true">↗</span>
                </a>
              )}
            </section>

            <section className="rapid-script" id="call-script" aria-labelledby="script-title" tabIndex={-1}>
              <p id="script-title">DU SAGST</p>
              <blockquote>
                „Hallo{scriptName ? ` ${scriptName}` : ""}, Raphael Hermann hier, grüße Sie. Ich wollte Ihnen eigentlich erst eine Mail schicken, dann dachte ich, ich ruf lieber kurz an. Kann ich kurz sagen, warum ich anrufe?“
              </blockquote>

              <div className="rapid-hook">
                <span>AUFHÄNGER FÜR DIESEN BETRIEB</span>
                <strong>{hook}</strong>
              </div>

              <div className="rapid-question">
                <span>DANN FRAGEN</span>
                <strong>„Was passiert bei Ihnen aktuell, wenn zwei Kunden gleichzeitig anrufen und keiner rangehen kann?“</strong>
              </div>
            </section>
          </div>

          <section className="rapid-bottom" aria-label="Call-Ergebnis erfassen">
            <label className="sr-only" htmlFor="call-note">Kurze Notiz zum Gespräch</label>
            <textarea
              id="call-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional: kurze Notiz zum Gespräch …"
              rows={2}
            />

            <div className="rapid-outcomes" role="group" aria-label="Call-Ergebnis auswählen">
              {outcomes.map((item) => (
                <button
                  key={item.value}
                  className={item.value === "appointment" ? "appointment" : ""}
                  onClick={() => void saveOutcome(item.value)}
                  disabled={busy}
                  aria-label={`${item.key}: ${item.label}. Ergebnis speichern und zum nächsten Lead wechseln.`}
                >
                  <kbd aria-hidden="true">{item.key}</kbd>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </section>
        </section>
      )}
    </main>
  );
}

const css = `
*{box-sizing:border-box}
html{font-size:18px;background:#050607}
body{margin:0;background:#050607;color:#fff}
button,a,textarea{font:inherit}
button,a{touch-action:manipulation}
.rapid-root{min-height:100vh;background:#050607;color:#fff;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:1rem 1.25rem;overflow-x:hidden}
.skip-link{position:absolute;left:.75rem;top:.5rem;z-index:1000;transform:translateY(-180%);background:#fff;color:#000;padding:.8rem 1rem;border-radius:.6rem;font-weight:900;text-decoration:none}.skip-link:focus{transform:translateY(0)}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.rapid-head{min-height:4rem;display:flex;align-items:center;justify-content:space-between;gap:1rem;border-bottom:2px solid #394047;padding-bottom:.8rem}
.rapid-head>div:first-child{display:flex;align-items:baseline;gap:1rem;flex-wrap:wrap}.rapid-head span{font-size:.9rem;font-weight:900;letter-spacing:.08em;color:#c8ff63}.rapid-head strong{font-size:1.35rem}.rapid-keys{font-size:.9rem;color:#d1d6da;font-weight:800;line-height:1.4}
.rapid-error{position:sticky;top:.5rem;z-index:20;max-width:50rem;margin:.75rem auto;background:#4a0e16;border:2px solid #ff7f8e;color:#fff;border-radius:.7rem;padding:.8rem 1rem;font-size:1rem;font-weight:800}
.rapid-card{display:flex;flex-direction:column;max-width:1600px;margin:0 auto;padding-top:.8rem}.rapid-topline{display:flex;justify-content:space-between;color:#d0d5d9;font-size:.95rem;font-weight:800;padding:0 .25rem .75rem}
.rapid-main{display:grid;grid-template-columns:minmax(22rem,.9fr) minmax(30rem,1.35fr);gap:.9rem}.rapid-company,.rapid-script{border:2px solid #363c42;background:#0b0e10;border-radius:1rem;padding:1.6rem}
.rapid-company{display:flex;flex-direction:column;min-height:31rem}.rapid-company>p,.rapid-script>p{margin:0 0 .8rem;font-size:.9rem;color:#e2e6e9;font-weight:900;letter-spacing:.1em}.rapid-company h1{font-size:clamp(2.35rem,4.2vw,4.4rem);line-height:1.02;letter-spacing:-.04em;margin:0 0 1.2rem;max-width:48rem}.rapid-meta{display:flex;gap:.6rem;flex-wrap:wrap}.rapid-meta span{border:2px solid #48515a;background:#11161a;border-radius:999px;padding:.55rem .8rem;font-size:1rem;color:#fff;font-weight:700;line-height:1.3}
.rapid-phone{margin-top:auto;width:100%;min-height:6rem;border:3px solid #d8ff91;border-radius:1rem;background:#c8ff63;color:#071000;padding:1rem 1.25rem;text-align:left;cursor:pointer;font-weight:900}.rapid-phone:hover{background:#d7ff8a}.rapid-phone:disabled{opacity:.55;cursor:not-allowed}.rapid-phone small{display:block;font-size:.9rem;font-weight:950;letter-spacing:.08em;margin-bottom:.25rem}.rapid-phone strong{display:block;font-size:clamp(1.8rem,3vw,3.2rem);line-height:1.1;letter-spacing:-.025em;overflow-wrap:anywhere}.rapid-site{display:inline-flex;align-items:center;min-height:3rem;margin-top:.7rem;color:#fff;font-size:1rem;font-weight:800;text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:4px}
.rapid-script{display:flex;flex-direction:column;justify-content:center;scroll-margin-top:1rem}.rapid-script blockquote{margin:0;color:#fff;font-size:clamp(1.4rem,2.1vw,2.15rem);line-height:1.4;letter-spacing:-.015em;font-weight:750}.rapid-hook,.rapid-question{margin-top:1.35rem;border-top:2px solid #3c4349;padding-top:1.1rem}.rapid-hook span,.rapid-question span{display:block;color:#c8ff63;font-size:.88rem;font-weight:950;letter-spacing:.09em;margin-bottom:.55rem}.rapid-hook strong{display:block;font-size:clamp(1.15rem,1.55vw,1.55rem);line-height:1.45;color:#fff}.rapid-question strong{display:block;font-size:clamp(1.25rem,1.7vw,1.7rem);line-height:1.42;color:#fff}
.rapid-bottom{padding-top:.85rem}.rapid-bottom textarea{width:100%;min-height:4rem;resize:vertical;border:2px solid #4a5259;background:#0b0e10;color:#fff;border-radius:.7rem;padding:.85rem 1rem;outline:none;margin-bottom:.7rem;font-size:1rem;line-height:1.4}.rapid-bottom textarea::placeholder{color:#c1c6ca}.rapid-outcomes{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:.55rem}.rapid-outcomes button{min-height:4rem;border:2px solid #4d555c;background:#111519;color:#fff;border-radius:.75rem;font-size:.96rem;font-weight:900;cursor:pointer;padding:.65rem .55rem;line-height:1.2}.rapid-outcomes button:hover{background:#22282d}.rapid-outcomes button:disabled{opacity:.55}.rapid-outcomes button.appointment{background:#c8ff63;color:#071000;border-color:#d8ff91}.rapid-outcomes kbd{display:inline-grid;place-items:center;min-width:1.8rem;height:1.8rem;margin-right:.45rem;border:2px solid currentColor;border-radius:.4rem;background:transparent;font-family:inherit;font-size:.9rem;font-weight:950}.rapid-outcomes .appointment kbd{background:rgba(0,0,0,.08)}
.rapid-done{min-height:calc(100vh - 6rem);display:grid;place-content:center;text-align:center}.rapid-done div{font-size:5rem;color:#c8ff63}.rapid-done h1{font-size:3rem;margin:.4rem 0}.rapid-done p{color:#fff;font-size:1.2rem}
button:focus-visible,a:focus-visible,textarea:focus-visible,.rapid-script:focus-visible{outline:4px solid #fff;outline-offset:4px;box-shadow:0 0 0 7px #326cff}
@media(max-width:1100px){html{font-size:17px}.rapid-main{grid-template-columns:1fr}.rapid-company{min-height:auto}.rapid-phone{margin-top:1.5rem}.rapid-outcomes{grid-template-columns:repeat(3,1fr)}}
@media(max-width:700px){html{font-size:16px}.rapid-root{padding:.75rem}.rapid-head{align-items:flex-start}.rapid-keys{display:none}.rapid-company,.rapid-script{padding:1.1rem}.rapid-company h1{font-size:2.35rem}.rapid-outcomes{grid-template-columns:repeat(2,1fr)}.rapid-outcomes button{min-height:4.4rem}.rapid-topline{font-size:.9rem}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;transition:none!important;animation:none!important}}
@media(forced-colors:active){.rapid-phone,.rapid-outcomes button.appointment{forced-color-adjust:auto}.rapid-company,.rapid-script,.rapid-meta span,.rapid-bottom textarea,.rapid-outcomes button{border:2px solid CanvasText}}
`;

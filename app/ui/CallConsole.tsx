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
html{font-size:16px;background:#050607}
body{margin:0;background:#050607;color:#fff}
button,a,textarea{font:inherit}
button,a{touch-action:manipulation}
.rapid-root{min-height:100vh;background:#050607;color:#fff;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:.7rem .85rem;overflow-x:hidden}
.skip-link{position:absolute;left:.75rem;top:.5rem;z-index:1000;transform:translateY(-180%);background:#fff;color:#000;padding:.65rem .8rem;border-radius:.5rem;font-weight:900;text-decoration:none}.skip-link:focus{transform:translateY(0)}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.rapid-head{min-height:3rem;display:flex;align-items:center;justify-content:space-between;gap:.75rem;border-bottom:1px solid #394047;padding-bottom:.55rem}
.rapid-head>div:first-child{display:flex;align-items:baseline;gap:.75rem;flex-wrap:wrap}.rapid-head span{font-size:.76rem;font-weight:900;letter-spacing:.07em;color:#c8ff63}.rapid-head strong{font-size:1.05rem}.rapid-keys{font-size:.76rem;color:#d1d6da;font-weight:800;line-height:1.3}
.rapid-error{position:sticky;top:.35rem;z-index:20;max-width:46rem;margin:.5rem auto;background:#4a0e16;border:2px solid #ff7f8e;color:#fff;border-radius:.6rem;padding:.65rem .8rem;font-size:.9rem;font-weight:800}
.rapid-card{display:flex;flex-direction:column;max-width:1440px;margin:0 auto;padding-top:.5rem}.rapid-topline{display:flex;justify-content:space-between;color:#d0d5d9;font-size:.8rem;font-weight:800;padding:0 .2rem .45rem}
.rapid-main{display:grid;grid-template-columns:minmax(18rem,.82fr) minmax(27rem,1.28fr);gap:.65rem}.rapid-company,.rapid-script{border:1px solid #363c42;background:#0b0e10;border-radius:.8rem;padding:1rem}
.rapid-company{display:flex;flex-direction:column;min-height:23rem}.rapid-company>p,.rapid-script>p{margin:0 0 .5rem;font-size:.75rem;color:#e2e6e9;font-weight:900;letter-spacing:.08em}.rapid-company h1{font-size:clamp(1.9rem,3.3vw,3.15rem);line-height:1.03;letter-spacing:-.035em;margin:0 0 .75rem;max-width:42rem}.rapid-meta{display:flex;gap:.4rem;flex-wrap:wrap}.rapid-meta span{border:1px solid #48515a;background:#11161a;border-radius:999px;padding:.35rem .55rem;font-size:.82rem;color:#fff;font-weight:700;line-height:1.25}
.rapid-phone{margin-top:auto;width:100%;min-height:4.4rem;border:2px solid #d8ff91;border-radius:.8rem;background:#c8ff63;color:#071000;padding:.7rem .9rem;text-align:left;cursor:pointer;font-weight:900}.rapid-phone:hover{background:#d7ff8a}.rapid-phone:disabled{opacity:.55;cursor:not-allowed}.rapid-phone small{display:block;font-size:.72rem;font-weight:950;letter-spacing:.07em;margin-bottom:.15rem}.rapid-phone strong{display:block;font-size:clamp(1.35rem,2.2vw,2.25rem);line-height:1.08;letter-spacing:-.02em;overflow-wrap:anywhere}.rapid-site{display:inline-flex;align-items:center;min-height:2.3rem;margin-top:.35rem;color:#fff;font-size:.82rem;font-weight:800;text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:3px}
.rapid-script{display:flex;flex-direction:column;justify-content:center;scroll-margin-top:.75rem}.rapid-script blockquote{margin:0;color:#fff;font-size:clamp(1.08rem,1.6vw,1.48rem);line-height:1.32;letter-spacing:-.01em;font-weight:720}.rapid-hook,.rapid-question{margin-top:.8rem;border-top:1px solid #3c4349;padding-top:.7rem}.rapid-hook span,.rapid-question span{display:block;color:#c8ff63;font-size:.72rem;font-weight:950;letter-spacing:.075em;margin-bottom:.35rem}.rapid-hook strong{display:block;font-size:clamp(.95rem,1.15vw,1.15rem);line-height:1.36;color:#fff}.rapid-question strong{display:block;font-size:clamp(1rem,1.25vw,1.25rem);line-height:1.34;color:#fff}
.rapid-bottom{padding-top:.55rem}.rapid-bottom textarea{width:100%;min-height:2.8rem;resize:vertical;border:1px solid #4a5259;background:#0b0e10;color:#fff;border-radius:.55rem;padding:.55rem .7rem;outline:none;margin-bottom:.45rem;font-size:.86rem;line-height:1.3}.rapid-bottom textarea::placeholder{color:#c1c6ca}.rapid-outcomes{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:.4rem}.rapid-outcomes button{min-height:3.15rem;border:1px solid #4d555c;background:#111519;color:#fff;border-radius:.6rem;font-size:.82rem;font-weight:900;cursor:pointer;padding:.45rem .35rem;line-height:1.15}.rapid-outcomes button:hover{background:#22282d}.rapid-outcomes button:disabled{opacity:.55}.rapid-outcomes button.appointment{background:#c8ff63;color:#071000;border-color:#d8ff91}.rapid-outcomes kbd{display:inline-grid;place-items:center;min-width:1.45rem;height:1.45rem;margin-right:.3rem;border:1px solid currentColor;border-radius:.3rem;background:transparent;font-family:inherit;font-size:.72rem;font-weight:950}.rapid-outcomes .appointment kbd{background:rgba(0,0,0,.08)}
.rapid-done{min-height:calc(100vh - 5rem);display:grid;place-content:center;text-align:center}.rapid-done div{font-size:4rem;color:#c8ff63}.rapid-done h1{font-size:2.2rem;margin:.3rem 0}.rapid-done p{color:#fff;font-size:1rem}
button:focus-visible,a:focus-visible,textarea:focus-visible,.rapid-script:focus-visible{outline:3px solid #fff;outline-offset:3px;box-shadow:0 0 0 5px #326cff}
@media(max-width:1100px){html{font-size:15px}.rapid-main{grid-template-columns:1fr}.rapid-company{min-height:auto}.rapid-phone{margin-top:1rem}.rapid-outcomes{grid-template-columns:repeat(3,1fr)}}
@media(max-width:700px){html{font-size:15px}.rapid-root{padding:.55rem}.rapid-head{align-items:flex-start}.rapid-keys{display:none}.rapid-company,.rapid-script{padding:.9rem}.rapid-company h1{font-size:1.9rem}.rapid-outcomes{grid-template-columns:repeat(2,1fr)}.rapid-outcomes button{min-height:3.4rem}.rapid-topline{font-size:.78rem}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;transition:none!important;animation:none!important}}
@media(forced-colors:active){.rapid-phone,.rapid-outcomes button.appointment{forced-color-adjust:auto}.rapid-company,.rapid-script,.rapid-meta span,.rapid-bottom textarea,.rapid-outcomes button{border:2px solid CanvasText}}
`;

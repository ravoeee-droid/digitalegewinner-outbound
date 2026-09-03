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
  { key: "3", value: "pain", label: "Pain" },
  { key: "4", value: "appointment", label: "TERMIN" },
  { key: "5", value: "no_fit", label: "Kein Fit" },
  { key: "6", value: "dnc", label: "DNC" },
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
      if (tag === "TEXTAREA" || tag === "INPUT") return;
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
    <main className="rapid-root">
      <style>{css}</style>

      <header className="rapid-head">
        <div>
          <span>SHK · RAPID CALL</span>
          <strong>{pending.length} offen</strong>
        </div>
        <div className="rapid-keys">ENTER = CALL &nbsp; · &nbsp; 1–6 = ERGEBNIS → NÄCHSTER</div>
      </header>

      {error && <div className="rapid-error">{error}</div>}

      {!active ? (
        <section className="rapid-done">
          <div>✓</div>
          <h1>Queue leer.</h1>
          <p>Alle vorbereiteten SHK-Calls sind durch.</p>
        </section>
      ) : (
        <section className="rapid-card">
          <div className="rapid-topline">
            <span>#{active.rank}</span>
            <span>Score {active.score}/100</span>
          </div>

          <div className="rapid-main">
            <div className="rapid-company">
              <p>NÄCHSTER LEAD</p>
              <h1>{company}</h1>
              <div className="rapid-meta">
                {city && <span>{city}</span>}
                {contact && <span>{contact}</span>}
              </div>
              <button className="rapid-phone" onClick={dial} disabled={!phone || busy}>
                <small>ENTER · ANRUFEN</small>
                <strong>{phone || "Keine Nummer"}</strong>
              </button>
              {website && <a className="rapid-site" href={website} target="_blank" rel="noreferrer">Website öffnen ↗</a>}
            </div>

            <div className="rapid-script">
              <p>DU SAGST</p>
              <blockquote>
                „Hallo{scriptName ? ` ${scriptName}` : ""}, Raphael Hermann hier, grüße Sie. Ich wollte Ihnen eigentlich erst eine Mail schicken, dann dachte ich, ich ruf lieber kurz an. Kann ich kurz sagen, warum ich anrufe?“
              </blockquote>
              <div className="rapid-hook">
                <span>DANN DER PUNKT BEI GENAU DIESEM BETRIEB</span>
                <strong>{hook}</strong>
              </div>
              <div className="rapid-question">
                <span>DANN FRAGEN</span>
                <strong>„Was passiert bei Ihnen aktuell, wenn zwei Kunden gleichzeitig anrufen und keiner rangehen kann?“</strong>
              </div>
            </div>
          </div>

          <div className="rapid-bottom">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional: 3 Wörter Notiz …"
              rows={1}
            />
            <div className="rapid-outcomes">
              {outcomes.map((item) => (
                <button
                  key={item.value}
                  className={item.value === "appointment" ? "appointment" : ""}
                  onClick={() => void saveOutcome(item.value)}
                  disabled={busy}
                >
                  <kbd>{item.key}</kbd>
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

const css = `
*{box-sizing:border-box}
html,body{margin:0;background:#050607}
.rapid-root{min-height:100vh;background:#050607;color:#f7f8f5;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:18px 22px;overflow:hidden}
.rapid-head{height:58px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #202326;padding-bottom:14px}
.rapid-head>div:first-child{display:flex;align-items:baseline;gap:16px}.rapid-head span{font-size:11px;font-weight:900;letter-spacing:.13em;color:#b9ff4a}.rapid-head strong{font-size:20px}.rapid-keys{font-size:11px;color:#777f87;font-weight:800;letter-spacing:.05em}
.rapid-error{position:fixed;top:78px;left:50%;transform:translateX(-50%);z-index:20;background:#351015;border:1px solid #8f2e39;border-radius:10px;padding:10px 14px}
.rapid-card{height:calc(100vh - 94px);display:flex;flex-direction:column;max-width:1500px;margin:0 auto;padding-top:14px}.rapid-topline{display:flex;justify-content:space-between;color:#676e74;font-size:12px;font-weight:800;padding:0 4px 10px}
.rapid-main{flex:1;min-height:0;display:grid;grid-template-columns:minmax(340px,.9fr) minmax(520px,1.4fr);gap:14px}.rapid-company,.rapid-script{border:1px solid #1d2023;background:#0a0c0e;border-radius:20px;padding:28px}
.rapid-company{display:flex;flex-direction:column}.rapid-company>p,.rapid-script>p{margin:0 0 12px;font-size:10px;color:#8a929a;font-weight:900;letter-spacing:.15em}.rapid-company h1{font-size:clamp(34px,4vw,62px);line-height:.95;letter-spacing:-.055em;margin:0 0 18px;max-width:760px}.rapid-meta{display:flex;gap:8px;flex-wrap:wrap}.rapid-meta span{border:1px solid #24282c;border-radius:999px;padding:7px 10px;font-size:12px;color:#aeb5bb}
.rapid-phone{margin-top:auto;width:100%;border:0;border-radius:18px;background:#b9ff4a;color:#071000;padding:20px 24px;text-align:left;cursor:pointer}.rapid-phone:hover{filter:brightness(1.05)}.rapid-phone:disabled{opacity:.4;cursor:not-allowed}.rapid-phone small{display:block;font-size:10px;font-weight:950;letter-spacing:.13em;margin-bottom:4px}.rapid-phone strong{display:block;font-size:clamp(26px,3vw,44px);letter-spacing:-.04em}.rapid-site{display:inline-flex;margin-top:12px;color:#8e979f;font-size:12px;text-decoration:none}
.rapid-script{display:flex;flex-direction:column;justify-content:center}.rapid-script blockquote{margin:0;color:#f4f5f2;font-size:clamp(21px,2vw,31px);line-height:1.28;letter-spacing:-.025em;font-weight:700}.rapid-hook,.rapid-question{margin-top:22px;border-top:1px solid #22262a;padding-top:18px}.rapid-hook span,.rapid-question span{display:block;color:#b9ff4a;font-size:9px;font-weight:950;letter-spacing:.15em;margin-bottom:8px}.rapid-hook strong{display:block;font-size:clamp(17px,1.5vw,23px);line-height:1.35;color:#d9dde0}.rapid-question strong{display:block;font-size:clamp(18px,1.6vw,25px);line-height:1.3;color:#fff}
.rapid-bottom{padding-top:12px}.rapid-bottom textarea{width:100%;height:42px;resize:none;border:1px solid #1f2326;background:#090b0d;color:#e7e9e6;border-radius:10px;padding:11px 13px;outline:none;margin-bottom:10px}.rapid-outcomes{display:grid;grid-template-columns:repeat(6,1fr);gap:8px}.rapid-outcomes button{height:52px;border:1px solid #262b2f;background:#0b0e10;color:#dce0e2;border-radius:12px;font-weight:850;cursor:pointer}.rapid-outcomes button:hover{background:#14181b}.rapid-outcomes button:disabled{opacity:.45}.rapid-outcomes button.appointment{background:#b9ff4a;color:#071000;border-color:#b9ff4a}.rapid-outcomes kbd{display:inline-grid;place-items:center;min-width:22px;height:22px;margin-right:7px;border-radius:6px;background:rgba(255,255,255,.08);font-family:inherit;font-size:11px}.rapid-outcomes .appointment kbd{background:rgba(0,0,0,.12)}
.rapid-done{height:calc(100vh - 90px);display:grid;place-content:center;text-align:center}.rapid-done div{font-size:70px;color:#b9ff4a}.rapid-done h1{font-size:48px;margin:6px 0}.rapid-done p{color:#81888e}
@media(max-width:900px){.rapid-root{padding:12px}.rapid-head{height:auto}.rapid-keys{display:none}.rapid-card{height:auto;min-height:calc(100vh - 70px)}.rapid-main{grid-template-columns:1fr}.rapid-company,.rapid-script{padding:20px}.rapid-company h1{font-size:36px}.rapid-phone{margin-top:28px}.rapid-outcomes{grid-template-columns:repeat(2,1fr)}.rapid-bottom textarea{height:48px}}
`;

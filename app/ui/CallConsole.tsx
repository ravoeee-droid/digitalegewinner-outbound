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

type OpenerKey = "A" | "B" | "C" | "D";
type Outcome = "not_reached" | "callback" | "pain" | "appointment" | "no_fit" | "dnc";

const openers: Record<OpenerKey, { name: string; text: string }> = {
  A: {
    name: "Direkt Telefon",
    text: "Hallo Herr/Frau [NAME], Raphael Hermann hier, grüße Sie. Ich wollte Ihnen eigentlich erst eine E-Mail schicken, dann dachte ich, ich rufe lieber kurz an. Kann ich kurz erklären, worum es geht? Danke. Wenn bei Ihnen tagsüber das Telefon klingelt – wer geht normalerweise ran? Sie selbst oder haben Sie jemanden fest im Büro?",
  },
  B: {
    name: "Branchenmuster",
    text: "Hallo Herr/Frau [NAME], Raphael Hermann hier. Ich wollte Ihnen eigentlich erst eine E-Mail schicken, dann dachte ich, ich rufe lieber kurz an. Ich spreche aktuell ziemlich viel mit Geschäftsführern aus dem SHK-Bereich und höre immer wieder dieselben Themen: Gute Leute sind schwer zu finden, im Tagesgeschäft bleibt viel am Chef hängen und bei Anrufen, Rückrufen und Organisation geht schnell Zeit oder auch mal ein Auftrag verloren. Wie ist das bei Ihnen?",
  },
  C: {
    name: "Zeit & Geld",
    text: "Hallo Herr/Frau [NAME], Raphael Hermann hier, grüße Sie. Ich wollte Ihnen eigentlich erst eine E-Mail schicken. Ganz kurz: Ich bin IT-Entwickler und automatisiere Prozesse in kleinen Unternehmen, die heute unnötig Zeit und Geld kosten. Ich wollte einfach schauen, ob es bei Ihnen auch so einen Prozess gibt.",
  },
  D: {
    name: "Positive Provokation",
    text: "Hallo Herr/Frau [NAME], Raphael Hermann hier, grüße Sie. Ich wollte Ihnen eigentlich erst eine E-Mail schicken, dann dachte ich mir, ich ruf lieber einmal kurz an. Kann ich kurz erklären, worum es geht? Danke. Ich bin IT-Entwickler und baue intelligente Websysteme für kleinere Unternehmen, die dabei helfen, Kunden und Mitarbeiter zu gewinnen und gleichzeitig im Tagesgeschäft Ordnung reinzubringen. Aber bei Ihnen hab ich beim Anschauen schon das Gefühl, Sie sagen mir gleich: Herr Hermann, Mitarbeiter brauchen wir keine, Kunden haben wir sowieso genug und organisiert sind wir besser als die meisten anderen hier. Lieg ich komplett daneben oder sind Sie tatsächlich schon so gut aufgestellt?",
  },
};

const objections = [
  ["Vorzimmer", "Perfekt – dann haben Sie das schon besser gelöst als viele andere. Ist das wirklich den ganzen Tag sauber abgedeckt oder gibt es Stoßzeiten, Mittag, Feierabend oder mehrere Anrufer gleichzeitig?"],
  ["Genug Aufträge", "Glaube ich Ihnen sofort. Mir geht es nicht darum, Ihnen noch mehr schlechte Anfragen reinzudrücken. Wo verlieren Sie heute eher Zeit – Rückrufe, Termine, Angebote, Mitarbeiterkoordination oder Bürokratie?"],
  ["Keine KI", "Verstehe ich. Mir ist ehrlich gesagt egal, ob da KI, Software oder drei kleine Männchen im Server drinstecken. Entscheidend ist nur: Spart es Ihnen Zeit oder Geld? Wenn nicht, brauchen Sie es nicht."],
  ["Keine Zeit", "Genau deshalb rufe ich an. Wenn bei Ihnen alles entspannt wäre, wäre Automatisierung ziemlich langweilig. Ich brauche nur 15 Minuten, um Ihnen einen konkreten Hebel zu zeigen."],
  ["Mail schicken", "Sehr gerne. Nur wenn ich Ihnen jetzt eine Standard-Mail schicke, wissen Sie danach genauso viel wie vorher. Geben Sie mir 20 Sekunden: Was frisst bei Ihnen aktuell am meisten unnötige Zeit? Dann schicke ich Ihnen genau dazu etwas."],
  ["Was kostet das?", "Das hängt komplett davon ab, was wir automatisieren. Ich würde zuerst prüfen, was der Prozess Sie heute an Zeit oder Umsatz kostet. Wenn die Rechnung keinen Sinn macht, bauen wir nichts."],
  ["Kein Interesse", "Alles gut. Nur damit ich Sie nicht nochmal wegen desselben Themas nerve: Ist bei Ihnen wirklich schon alles sauber automatisiert – oder ist das Thema gerade einfach keine Priorität?"],
] as const;

const outcomes: Array<{ key: string; value: Outcome; label: string; tone: string }> = [
  { key: "1", value: "not_reached", label: "Nicht erreicht", tone: "#aeb6c2" },
  { key: "2", value: "callback", label: "Rückruf", tone: "#f6cc70" },
  { key: "3", value: "pain", label: "Pain gefunden", tone: "#ff9d66" },
  { key: "4", value: "appointment", label: "Termin", tone: "#83f1b8" },
  { key: "5", value: "no_fit", label: "Kein Fit", tone: "#ff8585" },
  { key: "6", value: "dnc", label: "DNC", tone: "#ff5f5f" },
];

function v(payload: Record<string, unknown>, key: string) {
  const raw = payload?.[key];
  return typeof raw === "string" || typeof raw === "number" ? String(raw) : "";
}

export default function CallConsole() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [index, setIndex] = useState(0);
  const [opener, setOpener] = useState<OpenerKey>("D");
  const [objection, setObjection] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const pending = useMemo(() => tasks.filter((task) => !["done", "sent", "completed", "skipped"].includes(task.status)), [tasks]);
  const active = pending[Math.min(index, Math.max(0, pending.length - 1))] || null;
  const p = active?.payload || {};

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/call-console", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Call Console konnte nicht geladen werden.");
      setTasks(data.tasks || []);
      setIndex(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fehler beim Laden.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const dial = useCallback(() => {
    if (!active) return;
    const phone = v(p, "phone");
    if (!phone) return;
    window.dispatchEvent(new CustomEvent("cloudtalk:dial", { detail: { leadId: active.lead_id, company: v(p, "company") || "Lead", phone } }));
  }, [active, p]);

  const saveOutcome = useCallback(async (outcome: Outcome) => {
    if (!active || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/call-console", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: active.id, outcome, note, opener }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Speichern fehlgeschlagen.");
      setTasks(data.tasks || []);
      setIndex(0);
      setNote("");
      setObjection("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Speichern fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }, [active, busy, note, opener]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") return;
      if (["A", "B", "C", "D"].includes(e.key.toUpperCase())) setOpener(e.key.toUpperCase() as OpenerKey);
      if (e.key === "Enter") { e.preventDefault(); dial(); }
      if (e.key === " ") { e.preventDefault(); setIndex((i) => Math.min(i + 1, Math.max(0, pending.length - 1))); setObjection(""); setNote(""); }
      const hit = outcomes.find((item) => item.key === e.key);
      if (hit) void saveOutcome(hit.value);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dial, pending.length, saveOutcome]);

  const website = v(p, "website");
  const email = v(p, "email");
  const company = v(p, "company") || "Kein Lead geladen";

  return (
    <main className="cc-root">
      <style>{css}</style>
      <header className="cc-top">
        <div><span className="cc-kicker">DIGITALE GEWINNER · CALL MODE</span><strong>Call Console</strong></div>
        <div className="cc-progress"><b>{pending.length}</b><span>offen</span><i /> <span>Enter = Call · 1–6 = Ergebnis · Space = weiter</span></div>
      </header>

      {error && <div className="cc-error">{error}</div>}

      <section className="cc-grid">
        <aside className="cc-lead">
          <div className="cc-rank">#{active?.rank || "–"}</div>
          <h1>{company}</h1>
          <div className="cc-muted">{v(p, "city") || "Deutschland"}</div>
          <a className="cc-phone" href={v(p, "phone") ? `tel:${v(p, "phone")}` : undefined}>{v(p, "phone") || "Keine Telefonnummer"}</a>
          <div className="cc-score">Score <b>{active?.score || 0}</b>/100</div>
          <div className="cc-box"><span>WARUM JETZT?</span><p>{v(p, "reasons") || v(p, "message") || "Im Gespräch herausfinden, welcher Prozess heute unnötig Zeit oder Geld kostet."}</p></div>
          <div className="cc-actions">
            <button className="primary" onClick={dial}>☎ ANRUFEN <kbd>Enter</kbd></button>
            {website && <a href={website} target="_blank" rel="noreferrer">↗ Website</a>}
            {email && <a href={`mailto:${email}`}>✉ E-Mail</a>}
          </div>
        </aside>

        <section className="cc-script">
          <div className="cc-opener-tabs">
            {(Object.keys(openers) as OpenerKey[]).map((key) => <button key={key} className={opener === key ? "active" : ""} onClick={() => setOpener(key)}><b>{key}</b>{openers[key].name}</button>)}
          </div>
          <div className="cc-script-card">
            <span>DU SAGST · OPENER {opener}</span>
            <p>{openers[opener].text}</p>
          </div>
          <div className="cc-bridge">
            <span>DANN NUR EINE FRAGE</span>
            <strong>„Was ist bei Ihnen aktuell das Thema, bei dem Sie sagen: Wenn mir das jemand abnehmen oder automatisieren könnte, würde mir das im Alltag wirklich etwas bringen?“</strong>
          </div>
          <div className="cc-objections">
            {objections.map(([label, answer]) => <button key={label} className={objection === answer ? "active" : ""} onClick={() => setObjection(answer)}>{label}</button>)}
          </div>
          <div className={`cc-answer ${objection ? "show" : ""}`}>
            <span>EINWAND-ANTWORT</span>
            <strong>{objection || "Einwand anklicken – Antwort erscheint hier sofort."}</strong>
          </div>
        </section>

        <aside className="cc-result">
          <div className="cc-result-head"><span>CALL ERGEBNIS</span><b>{active ? `${Math.min(index + 1, pending.length)} / ${pending.length}` : "–"}</b></div>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Kurze Notiz: Was nervt ihn? Was soll automatisiert werden? Wann follow-up?" />
          <div className="cc-outcomes">
            {outcomes.map((item) => <button key={item.value} onClick={() => void saveOutcome(item.value)} disabled={!active || busy} style={{ borderColor: `${item.tone}55` }}><kbd>{item.key}</kbd><span>{item.label}</span><i style={{ background: item.tone }} /></button>)}
          </div>
          <button className="cc-next" onClick={() => { setIndex((i) => Math.min(i + 1, Math.max(0, pending.length - 1))); setNote(""); setObjection(""); }}>NÄCHSTER LEAD <kbd>Space</kbd></button>
          <div className="cc-rule"><b>Regel:</b> Nicht alles verkaufen. Einen teuren oder nervigen Prozess finden → konkrete Automation → Termin.</div>
        </aside>
      </section>
    </main>
  );
}

const css = `
*{box-sizing:border-box}.cc-root{height:100vh;overflow:hidden;background:#07090d;color:#f7f8fa;font-family:Inter,ui-sans-serif,system-ui,sans-serif;padding:14px}.cc-top{height:64px;display:flex;align-items:center;justify-content:space-between;padding:0 8px 12px;border-bottom:1px solid rgba(255,255,255,.08)}.cc-top>div:first-child{display:flex;flex-direction:column}.cc-top strong{font-size:22px;letter-spacing:-.04em}.cc-kicker{font-size:9px;color:#d5ff59;font-weight:900;letter-spacing:.14em}.cc-progress{display:flex;align-items:center;gap:8px;color:#8f98a6;font-size:11px}.cc-progress b{font-size:20px;color:#fff}.cc-progress i{height:18px;width:1px;background:rgba(255,255,255,.12);margin:0 6px}.cc-error{position:fixed;top:76px;left:50%;transform:translateX(-50%);z-index:50;background:#40171b;border:1px solid #ff6d79;padding:10px 16px;border-radius:10px}.cc-grid{height:calc(100vh - 92px);display:grid;grid-template-columns:minmax(250px,.72fr) minmax(520px,1.65fr) minmax(280px,.78fr);gap:12px;padding-top:12px}.cc-lead,.cc-script,.cc-result{min-height:0;border:1px solid rgba(255,255,255,.09);background:rgba(255,255,255,.025);border-radius:18px;padding:16px;overflow:hidden}.cc-lead{display:flex;flex-direction:column}.cc-rank{width:46px;height:46px;border-radius:13px;display:grid;place-items:center;background:rgba(213,255,89,.08);color:#d5ff59;font-weight:900}.cc-lead h1{font-size:clamp(24px,2.2vw,40px);line-height:1;letter-spacing:-.05em;margin:20px 0 6px}.cc-muted{color:#7f8998;font-size:12px}.cc-phone{display:block;color:#fff;font-size:22px;font-weight:850;text-decoration:none;margin:22px 0 10px}.cc-score{font-size:11px;color:#8f98a6}.cc-score b{color:#d5ff59;font-size:18px}.cc-box{margin-top:18px;padding:14px;border-radius:14px;background:#0b0e13;border:1px solid rgba(255,255,255,.07)}.cc-box span,.cc-script-card span,.cc-bridge span,.cc-answer span,.cc-result-head span{font-size:9px;color:#d5ff59;font-weight:900;letter-spacing:.13em}.cc-box p{margin:8px 0 0;color:#b9c0ca;font-size:12px;line-height:1.55}.cc-actions{margin-top:auto;display:grid;gap:8px}.cc-actions button,.cc-actions a,.cc-next{height:46px;border-radius:12px;border:1px solid rgba(255,255,255,.1);background:#0d1016;color:#e8ebef;display:flex;align-items:center;justify-content:center;gap:8px;text-decoration:none;font-weight:800;font-size:11px;cursor:pointer}.cc-actions .primary{background:#d5ff59;color:#091007;border-color:#d5ff59}.cc-actions kbd,.cc-next kbd{font-size:9px;opacity:.65}.cc-script{display:flex;flex-direction:column;gap:10px}.cc-opener-tabs{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}.cc-opener-tabs button{min-width:0;height:48px;border:1px solid rgba(255,255,255,.08);background:#0b0e13;color:#818a98;border-radius:11px;font-size:9px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cc-opener-tabs button b{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:7px;background:rgba(255,255,255,.06);margin-right:6px}.cc-opener-tabs button.active{color:#fff;border-color:rgba(213,255,89,.45);background:rgba(213,255,89,.07)}.cc-script-card{flex:1;min-height:0;padding:18px;border-radius:16px;background:linear-gradient(145deg,rgba(53,108,255,.12),rgba(255,255,255,.025));border:1px solid rgba(98,142,255,.22);display:flex;flex-direction:column;justify-content:center}.cc-script-card p{font-size:clamp(17px,1.55vw,25px);line-height:1.46;letter-spacing:-.02em;margin:12px 0 0}.cc-bridge{padding:12px 14px;border-radius:13px;background:rgba(213,255,89,.055);border:1px solid rgba(213,255,89,.15)}.cc-bridge strong{display:block;margin-top:6px;font-size:12px;line-height:1.45}.cc-objections{display:grid;grid-template-columns:repeat(7,1fr);gap:6px}.cc-objections button{height:36px;border-radius:9px;border:1px solid rgba(255,122,122,.14);background:rgba(255,90,90,.04);color:#d7a0a0;font-size:9px;font-weight:800;cursor:pointer}.cc-objections button.active{background:rgba(255,90,90,.12);color:#fff}.cc-answer{min-height:70px;padding:12px 14px;border-radius:13px;background:#0b0e13;border:1px solid rgba(255,255,255,.08);color:#707987}.cc-answer.show{border-color:rgba(255,112,112,.25);color:#fff}.cc-answer strong{display:block;margin-top:6px;font-size:12px;line-height:1.45}.cc-result{display:flex;flex-direction:column}.cc-result-head{display:flex;justify-content:space-between;align-items:center}.cc-result-head b{font-size:12px;color:#8f98a6}.cc-result textarea{height:145px;resize:none;margin:14px 0 10px;border-radius:13px;background:#090c11;border:1px solid rgba(255,255,255,.09);color:#fff;padding:13px;font:inherit;font-size:12px;line-height:1.5;outline:none}.cc-result textarea:focus{border-color:rgba(213,255,89,.35)}.cc-outcomes{display:grid;gap:7px}.cc-outcomes button{height:46px;display:grid;grid-template-columns:30px 1fr 9px;align-items:center;gap:8px;text-align:left;border-radius:11px;background:#0b0e13;color:#e9edf2;border:1px solid rgba(255,255,255,.09);cursor:pointer}.cc-outcomes kbd{width:24px;height:24px;display:grid;place-items:center;border-radius:6px;background:rgba(255,255,255,.06);font-size:10px}.cc-outcomes span{font-size:11px;font-weight:800}.cc-outcomes i{width:7px;height:7px;border-radius:50%}.cc-next{margin-top:auto;background:#171d0e;border-color:rgba(213,255,89,.24);color:#d5ff59}.cc-rule{margin-top:8px;color:#6f7885;font-size:9px;line-height:1.45;text-align:center}.cc-rule b{color:#aeb6c2}@media(max-width:1100px){.cc-root{height:auto;min-height:100vh;overflow:auto}.cc-grid{height:auto;grid-template-columns:1fr}.cc-lead,.cc-script,.cc-result{overflow:visible;min-height:520px}.cc-objections{grid-template-columns:repeat(3,1fr)}}
`;

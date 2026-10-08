"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import CallConsole from "@/app/ui/CallConsole";
import CloudTalkPhone from "@/app/ui/CloudTalkPhone";
import CRMWorkspace from "@/app/ui/CRMWorkspace";
import styles from "./HeuteCockpit.module.css";

type Mailbox = { id: string; email: string; connected: boolean; warmupReady: boolean; enabled: boolean; limit: number; enforced: number | null; status: string | null; sent: number };
type Summary = {
  role: "admin" | "sales";
  calls: { target: number; done: number; open: number; total: number };
  emails?: { target: number; perMailboxTarget: number; sent: number; queued: number; capacity: number; connectedCount: number; listedCount: number; mailboxes: Mailbox[] };
  appointments: number;
};

function pct(value: number, target: number) {
  return target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0;
}

function Counter({ label, value, target, hint }: { label: string; value: number; target?: number; hint?: string }) {
  const percent = target ? pct(value, target) : null;
  return (
    <div className={styles.counter}>
      <span className={styles.label}>{label}</span>
      <strong>
        {value}
        {target ? <small> / {target}</small> : null}
      </strong>
      {percent !== null && <div className={styles.track} aria-hidden="true"><i style={{ width: `${percent}%` }} /></div>}
      {hint && <em>{hint}</em>}
    </div>
  );
}

export default function HeuteCockpit({ role }: { role: "admin" | "sales" }) {
  const [tab, setTab] = useState<"calls" | "emails" | "crm">("calls");
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [limit, setLimit] = useState(5); // Aufwärmen: Woche 1 = 5, Woche 2 = 10, Woche 3 = 15, ab Woche 4 = 20

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/heute", { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Konnte nicht geladen werden.");
      setData(json);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Konnte nicht geladen werden.");
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 30_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [load]);

  async function setLimits() {
    const target = limit;
    if (!window.confirm(`Tageslimit aller aktiven Postfächer auf ${target} setzen?`)) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/heute", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "set-mailbox-limits", limit: target }) });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Fehlgeschlagen.");
      setNotice(`${json.updated} Postfächer stehen jetzt auf ${json.limit} pro Tag.`);
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  const emails = data?.emails;
  const callsLeft = data ? Math.max(0, data.calls.target - data.calls.done) : null;

  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <div>
          <span className={styles.eyebrow}>Heute</span>
          <h1>{new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Berlin" }).format(new Date())}</h1>
        </div>
        <div className={styles.counters}>
          <Counter label="Anrufe" value={data?.calls.done ?? 0} target={data?.calls.target ?? 50} hint={callsLeft !== null ? `noch ${callsLeft}` : undefined} />
          {role === "admin" && <Counter label="E-Mails" value={emails?.sent ?? 0} target={emails?.target ?? 200} hint={emails ? `${emails.queued} in der Warteschlange` : undefined} />}
          <Counter label="Termine heute" value={data?.appointments ?? 0} />
        </div>
      </header>

      {error && <p className={styles.error} role="alert">{error}</p>}

      <div className={styles.tabs} role="tablist" aria-label="Arbeitsbereich">
        <button type="button" role="tab" aria-selected={tab === "calls"} className={tab === "calls" ? styles.on : undefined} onClick={() => setTab("calls")}>Anrufen</button>
        {role === "admin" && <button type="button" role="tab" aria-selected={tab === "emails"} className={tab === "emails" ? styles.on : undefined} onClick={() => setTab("emails")}>E-Mails</button>}
        <button type="button" role="tab" aria-selected={tab === "crm"} className={tab === "crm" ? styles.on : undefined} onClick={() => setTab("crm")}>Pipeline</button>
      </div>

      {tab === "crm" ? (
        <CRMWorkspace embedded />
      ) : tab === "calls" || role === "sales" ? (
        <section aria-label="Anrufen">
          <CallConsole />
          <CloudTalkPhone />
        </section>
      ) : (
        <section className={styles.mail} aria-label="E-Mails">
          <div className={styles.mailTop}>
            <p>
              Ziel: <b>{emails?.perMailboxTarget ?? 20}</b> pro Postfach, zusammen <b>{emails?.target ?? 200}</b> am Tag.
              {emails && emails.capacity < emails.target && (
                <> Heute möglich: <b>{emails.capacity}</b>. Die Zustellbarkeitsregeln begrenzen einzelne Postfächer.</>
              )}
            </p>
            <div className={styles.actions}>
              <label className={styles.limitPick}>
                Limit pro Postfach
                <select value={limit} onChange={(event) => setLimit(Number(event.target.value))}>
                  {[5, 10, 15, 20].map((value) => <option key={value} value={value}>{value} pro Tag</option>)}
                </select>
              </label>
              <button type="button" onClick={() => void setLimits()} disabled={busy}>{busy ? "Setze …" : `Alle Postfächer auf ${limit} pro Tag`}</button>
              <Link href="/mail">Postfach öffnen</Link>
            </div>
          </div>
          <p className={styles.muted}>Empfehlung beim Aufwärmen neuer Postfächer: Woche 1 → 5, Woche 2 → 10, Woche 3 → 15, ab Woche 4 → 20 pro Tag.</p>
          {emails && emails.connectedCount < emails.listedCount && (
            <p className={styles.error} role="alert">
              Nur <b>{emails.connectedCount} von {emails.listedCount}</b> Postfächern sind wirklich verbunden und können Mails senden. Die übrigen stehen nur als Name in „Domains &amp; Mail“. <Link href="/mail">Jetzt unter „Mail“ verbinden</Link>
            </p>
          )}
          {notice && <p className={styles.notice} role="status">{notice}</p>}
          <div className={styles.boxes}>
            {(emails?.mailboxes || []).map((m) => {
              const limit = m.limit || emails?.perMailboxTarget || 20;
              return (
                <article key={m.id} className={`${styles.box} ${m.enabled && m.connected ? "" : styles.off}`}>
                  <header><strong>{m.email}</strong>{!m.connected ? <span className={styles.chip} data-status="paused">nicht verbunden</span> : m.status && <span className={styles.chip} data-status={m.status}>{m.status}</span>}</header>
                  <div className={styles.track} aria-hidden="true"><i style={{ width: `${pct(m.sent, limit)}%` }} /></div>
                  <p>{m.connected ? `${m.sent} von ${limit} heute${m.enforced !== null && m.enforced < limit ? ` · begrenzt auf ${m.enforced}` : ""}${m.enabled ? "" : " · aus"}` : "Zugangsdaten fehlen – verschickt noch nichts"}{m.connected && !m.warmupReady ? " · Aufwärmen nicht möglich (IMAP/SMTP unvollständig)" : ""}</p>
                </article>
              );
            })}
            {emails && emails.mailboxes.length === 0 && <p className={styles.muted}>Keine Postfächer verbunden. Unter „Mehr → Mail“ verbinden.</p>}
          </div>
        </section>
      )}
    </main>
  );
}

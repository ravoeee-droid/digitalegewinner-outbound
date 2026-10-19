"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import styles from "./DashboardView.module.css";

type Day = { day: string; sent: number; opened: number; replied: number; positive: number; meetings: number; bounces: number; unsubscribed: number };
type Data = {
  days: number; daily: Day[]; goalPerDay: number; dailyTarget: number;
  mailboxes: { mailbox_id: string; sent_today: number; sent_period: number; failed_period: number; queued: number }[];
  queue: { queued: number; due: number; next_at: string | null; failed_open: number };
  steps: { step: number; sent: number; replied: number }[];
  recent: { lead_id: string; type: string; company: string | null; at: string }[];
  checks?: { id: string; label: string; status: "ok" | "warn" | "fail"; detail: string; href: string }[];
};

const nf = new Intl.NumberFormat("de-DE");
const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toLocaleString("de-DE", { maximumFractionDigits: 1 })} %` : "–");
const sum = (rows: Day[], key: keyof Day) => rows.reduce((total, row) => total + Number(row[key] || 0), 0);
const dayLabel = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
const typeLabel: Record<string, string> = { appointment: "Termin gebucht", appointment_attended: "Termin wahrgenommen", positive_reply: "Positive Antwort", reply: "Antwort" };

export default function DashboardView() {
  const [days, setDays] = useState(14);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/dashboard?days=${days}`, { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Laden fehlgeschlagen");
      setData(json);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Laden fehlgeschlagen");
    }
  }, [days]);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const timer = setInterval(load, 60000);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [load]);

  const rows = data?.daily || [];
  const todayRow = rows[rows.length - 1];
  const sent = sum(rows, "sent");
  const opened = sum(rows, "opened");
  const replied = sum(rows, "replied");
  const positive = sum(rows, "positive");
  const meetings = sum(rows, "meetings");
  const bounces = sum(rows, "bounces");
  const unsub = sum(rows, "unsubscribed");
  const max = Math.max(1, ...rows.map((row) => row.sent));
  const goal = data?.goalPerDay || 4;
  const target = data?.dailyTarget || 300;
  const funnel = [
    { label: "Mails gesendet", value: sent, rate: "" },
    { label: "Geöffnet", value: opened, rate: pct(opened, sent) },
    { label: "Geantwortet", value: replied, rate: pct(replied, sent) },
    { label: "Positive Antwort", value: positive, rate: pct(positive, sent) },
    { label: "Termin gebucht", value: meetings, rate: pct(meetings, sent) },
  ];

  return (
    <main className="dg-page">
      <header className="dg-head">
        <div className="dg-head-copy">
          <span className="dg-eyebrow">Auswertung</span>
          <h1 className="dg-title">Dashboard</h1>
          <p className="dg-lead">Versand, Antworten und Termine auf einen Blick. Aktualisiert sich jede Minute.</p>
        </div>
        <div className="dg-actions" role="group" aria-label="Zeitraum">
          {[7, 14, 30, 90].map((value) => (
            <button key={value} type="button" className={`dg-btn ${days === value ? "dg-btn-primary" : ""}`} aria-pressed={days === value} onClick={() => setDays(value)}>{value} Tage</button>
          ))}
        </div>
      </header>

      {error && <p className="dg-notice" role="alert">{error}</p>}
      {!data && !error && <p className={styles.muted}>Lade Daten …</p>}

      {data && (
        <>
          {data.checks && data.checks.length > 0 && (
            <section className={`dg-panel ${styles.checks}`} aria-labelledby="h-start">
              <h2 id="h-start">{data.checks.every((check) => check.status === "ok") ? "Alles bereit für den automatischen Versand" : `Start-Checkliste: ${data.checks.filter((check) => check.status === "ok").length} von ${data.checks.length} erledigt`}</h2>
              <ul>
                {data.checks.map((check) => (
                  <li key={check.id} className={styles[check.status]}>
                    <span className={styles.mark} aria-hidden="true">{check.status === "ok" ? "✓" : check.status === "warn" ? "!" : "✕"}</span>
                    <span><strong>{check.label}</strong><small>{check.detail}</small></span>
                    {check.status !== "ok" && <Link href={check.href} className="dg-btn">Öffnen</Link>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className={styles.hero} aria-label="Heute">
            <div className={`dg-panel ${styles.goal}`}>
              <span className={styles.k}>Termine heute</span>
              <strong className={styles.big}>{todayRow?.meetings ?? 0}<small> / {goal}</small></strong>
              <div className={styles.bar} role="progressbar" aria-valuemin={0} aria-valuemax={goal} aria-valuenow={Math.min(goal, todayRow?.meetings ?? 0)} aria-label="Fortschritt Tagesziel Termine"><i style={{ width: `${Math.min(100, ((todayRow?.meetings ?? 0) / goal) * 100)}%` }} /></div>
            </div>
            <div className={`dg-panel ${styles.goal}`}>
              <span className={styles.k}>Mails heute</span>
              <strong className={styles.big}>{nf.format(todayRow?.sent ?? 0)}<small> / {nf.format(target)}</small></strong>
              <div className={styles.bar} role="progressbar" aria-valuemin={0} aria-valuemax={target} aria-valuenow={Math.min(target, todayRow?.sent ?? 0)} aria-label="Fortschritt Tagesziel Mails"><i style={{ width: `${Math.min(100, ((todayRow?.sent ?? 0) / target) * 100)}%` }} /></div>
            </div>
            <div className={`dg-panel ${styles.goal}`}>
              <span className={styles.k}>Warteschlange</span>
              <strong className={styles.big}>{nf.format(data.queue?.queued ?? 0)}</strong>
              <p className={styles.sub}>{data.queue?.due ?? 0} jetzt fällig{data.queue?.next_at ? ` · nächste ${new Date(data.queue.next_at).toLocaleString("de-DE", { weekday: "short", hour: "2-digit", minute: "2-digit" })}` : ""}</p>
            </div>
          </section>

          {(data.queue?.failed_open ?? 0) > 0 && <p className="dg-notice" role="alert">{data.queue.failed_open} Mails sind in den letzten 3 Tagen fehlgeschlagen. Postfächer prüfen.</p>}

          <section className={styles.kpis} aria-label={`Kennzahlen ${days} Tage`}>
            {[
              ["Gesendet", nf.format(sent), `Ø ${nf.format(Math.round(sent / days))} pro Tag`],
              ["Antwortquote", pct(replied, sent), `${replied} Antworten`],
              ["Termine", String(meetings), `${pct(meetings, sent)} der Mails`],
              ["Mails je Termin", meetings > 0 ? nf.format(Math.round(sent / meetings)) : "–", "weniger ist besser"],
              ["Bounces", pct(bounces, sent), `${bounces} unzustellbar`],
              ["Abmeldungen", pct(unsub, sent), `${unsub} Abmeldungen`],
            ].map(([label, value, hint]) => (
              <div key={label} className={`dg-panel ${styles.kpi}`}><span className={styles.k}>{label}</span><strong>{value}</strong><small>{hint}</small></div>
            ))}
          </section>

          <div className={styles.cols}>
            <section className={`dg-panel ${styles.card}`} aria-labelledby="h-verlauf">
              <h2 id="h-verlauf">Mails pro Tag</h2>
              <div className={styles.chart} role="img" aria-label={`Mails pro Tag der letzten ${days} Tage`}>
                {rows.map((row) => (
                  <div key={row.day} className={styles.col} title={`${dayLabel(row.day)}: ${row.sent} Mails, ${row.replied} Antworten, ${row.meetings} Termine`}>
                    <i className={styles.barSent} style={{ height: `${(row.sent / max) * 100}%` }} />
                    {row.meetings > 0 && <b className={styles.dot}>{row.meetings}</b>}
                    {days <= 30 && <span>{dayLabel(row.day)}</span>}
                  </div>
                ))}
              </div>
              <p className={styles.legend}><i className={styles.barSent} /> Mails <b className={styles.dot}>1</b> Termine</p>
            </section>

            <section className={`dg-panel ${styles.card}`} aria-labelledby="h-trichter">
              <h2 id="h-trichter">Trichter ({days} Tage)</h2>
              <ol className={styles.funnel}>
                {funnel.map((step) => (
                  <li key={step.label}>
                    <span>{step.label}</span>
                    <div className={styles.fbar}><i style={{ width: `${sent > 0 ? Math.max(2, (step.value / sent) * 100) : 0}%` }} /></div>
                    <strong>{nf.format(step.value)}</strong><em>{step.rate}</em>
                  </li>
                ))}
              </ol>
              <p className={styles.note}>Öffnungen sind ungenau, weil Mailprogramme Bilder automatisch laden. Antworten und Termine zählen.</p>
            </section>
          </div>

          <div className={styles.cols}>
            <section className={`dg-panel ${styles.card}`} aria-labelledby="h-box">
              <h2 id="h-box">Postfächer</h2>
              <div className={styles.scroll}>
                <table className={styles.table}>
                  <thead><tr><th>Postfach</th><th>Heute</th><th>{days} Tage</th><th>Fehler</th><th>Wartend</th></tr></thead>
                  <tbody>
                    {data.mailboxes.length === 0 && <tr><td colSpan={5}>Noch nichts gesendet.</td></tr>}
                    {data.mailboxes.map((box) => (
                      <tr key={box.mailbox_id}><td>{box.mailbox_id}</td><td>{box.sent_today}</td><td>{box.sent_period}</td><td className={box.failed_period > 0 ? styles.warn : ""}>{box.failed_period}</td><td>{box.queued}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className={`dg-panel ${styles.card}`} aria-labelledby="h-seq">
              <h2 id="h-seq">Welche Mail bringt Antworten?</h2>
              <div className={styles.scroll}>
                <table className={styles.table}>
                  <thead><tr><th>Mail</th><th>Gesendet</th><th>Antwortquote</th></tr></thead>
                  <tbody>
                    {data.steps.length === 0 && <tr><td colSpan={3}>Noch keine Daten.</td></tr>}
                    {data.steps.map((step) => (
                      <tr key={step.step}><td>{step.step === 1 ? "Erstmail" : `Follow-up ${step.step - 1}`}</td><td>{nf.format(step.sent)}</td><td>{pct(step.replied, step.sent)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <h2 className={styles.sub2}>Letzte Ereignisse</h2>
              <ul className={styles.recent}>
                {data.recent.length === 0 && <li>Noch keine Antworten oder Termine.</li>}
                {data.recent.map((item, index) => (
                  <li key={`${item.lead_id}-${index}`}><b>{typeLabel[item.type] || item.type}</b> {item.company || item.lead_id}<time dateTime={item.at}>{new Date(item.at).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</time></li>
                ))}
              </ul>
            </section>
          </div>
        </>
      )}
    </main>
  );
}

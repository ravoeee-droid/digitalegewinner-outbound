"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./DashboardView.module.css";

type Day = { day: string; sent: number; opened: number; replied: number; positive: number; meetings: number; bounces: number; unsubscribed: number };
type Check = { id: string; label: string; status: "ok" | "warn" | "fail"; detail: string; href: string };
type Data = {
  days: number; daily: Day[]; goalPerDay: number; dailyTarget: number;
  mailboxes: { mailbox_id: string; sent_today: number; sent_period: number; failed_period: number; queued: number }[];
  queue: { queued: number; due: number; next_at: string | null; failed_open: number };
  steps: { step: number; sent: number; replied: number }[];
  recent: { lead_id: string; type: string; company: string | null; at: string }[];
  checks?: Check[];
  source?: { status: string; reason: string; n: number; started: string }[];
  dbExpiry?: { at: string; claimUrl: string; hoursLeft: number } | null;
  video?: { type: string; leads: number }[];
  variants?: { campaign_id: string; variant: string; leads: number; replies: number }[];
  campaigns?: { id: string; sent_today: number; sent7: number; queued: number; leads: number; replies: number }[];
};

const nf = new Intl.NumberFormat("de-DE");
const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toLocaleString("de-DE", { maximumFractionDigits: 1 })} %` : "–");
const sum = (rows: Day[], key: keyof Day) => rows.reduce((total, row) => total + Number(row[key] || 0), 0);
const dayLabel = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
const reasonLabel: Record<string, string> = { "excluded-employer": "Träger, Zeitarbeit oder Vermittler", "wrong-role": "keine Pflegefachkraft gesucht", "no-fulltime": "keine Vollzeit-Stelle", "under-60-days": "Anzeige jünger als 60 Tage", excluded: "aussortiert" };
const typeLabel: Record<string, string> = { appointment: "Termin gebucht", appointment_attended: "Termin wahrgenommen", positive_reply: "Positive Antwort", reply: "Antwort" };

function niceMax(value: number) {
  if (value <= 10) return 10;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((factor) => factor * magnitude >= value) || 10;
  return step * magnitude;
}

// Zahl zählt beim Laden hoch; bei reduzierter Bewegung wird sie sofort gezeigt.
function useCountUp(target: number) {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches || from.current === target) { from.current = target; const t = setTimeout(() => setValue(target), 0); return () => clearTimeout(t); }
    const start = from.current; const began = performance.now(); let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - began) / 700);
      setValue(Math.round(start + (target - start) * (1 - (1 - progress) ** 3)));
      if (progress < 1) frame = requestAnimationFrame(tick); else from.current = target;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return value;
}

function Ring({ label, value, goal, unit, tone }: { label: string; value: number; goal: number; unit: string; tone: "green" | "gold" }) {
  const shown = useCountUp(value);
  const radius = 52; const circumference = 2 * Math.PI * radius;
  const ratio = Math.min(1, goal > 0 ? value / goal : 0);
  return (
    <div className={`dg-panel ${styles.ring}`}>
      <svg viewBox="0 0 120 120" role="img" aria-label={`${label}: ${value} von ${goal}`}>
        <circle cx="60" cy="60" r={radius} className={styles.ringTrack} />
        <circle cx="60" cy="60" r={radius} className={`${styles.ringBar} ${tone === "gold" ? styles.gold : ""}`} strokeDasharray={circumference} strokeDashoffset={circumference * (1 - ratio)} transform="rotate(-90 60 60)" />
        <text x="60" y="58" textAnchor="middle" className={styles.ringValue}>{nf.format(shown)}</text>
        <text x="60" y="76" textAnchor="middle" className={styles.ringGoal}>von {nf.format(goal)}</text>
      </svg>
      <div><span className={styles.k}>{label}</span><p>{unit}</p></div>
    </div>
  );
}

function Chart({ rows, days }: { rows: Day[]; days: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(1, ...rows.map((row) => row.sent)));
  const ticks = [max, max / 2, 0];
  const active = hover !== null ? rows[hover] : null;
  return (
    <div className={styles.chartWrap}>
      <div className={styles.axis} aria-hidden="true">{ticks.map((tick) => <span key={tick}>{nf.format(tick)}</span>)}</div>
      <div className={styles.plot} role="img" aria-label={`Mails und Termine pro Tag, letzte ${days} Tage`} onMouseLeave={() => setHover(null)}>
        <div className={styles.grid} aria-hidden="true"><i /><i /><i /></div>
        {rows.map((row, index) => (
          <div key={row.day} className={`${styles.col} ${hover === index ? styles.colOn : ""}`} onMouseEnter={() => setHover(index)} onFocus={() => setHover(index)} tabIndex={0} aria-label={`${dayLabel(row.day)}: ${row.sent} Mails, ${row.replied} Antworten, ${row.meetings} Termine`}>
            <i className={styles.bar} style={{ height: `${(row.sent / max) * 100}%` }} />
            {row.meetings > 0 && <b className={styles.dot}>{row.meetings}</b>}
            {(days <= 14 || index % Math.ceil(days / 14) === 0) && <span className={styles.xl}>{dayLabel(row.day)}</span>}
          </div>
        ))}
        {active && (
          <div className={styles.tip} style={{ left: `${((hover as number) + 0.5) / rows.length * 100}%` }}>
            <strong>{dayLabel(active.day)}</strong>
            <span>{nf.format(active.sent)} Mails</span>
            <span>{active.replied} Antworten</span>
            <span>{active.meetings} Termine</span>
          </div>
        )}
      </div>
      <p className={styles.legend}><i className={styles.swatch} /> Mails pro Tag <b className={styles.dot}>1</b> gebuchte Termine</p>
    </div>
  );
}

export default function DashboardView() {
  const [days, setDays] = useState(14);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const [startMessage, setStartMessage] = useState("");

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

  async function startNow() {
    setStarting(true);
    setStartMessage("");
    try {
      const response = await fetch("/api/start", { method: "POST" });
      const json = await response.json();
      setStartMessage(json.message || (response.ok ? "Gestartet." : "Start fehlgeschlagen."));
    } catch {
      setStartMessage("Start fehlgeschlagen. Bitte noch einmal versuchen.");
    } finally {
      setStarting(false);
      void load();
    }
  }

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
  const goal = data?.goalPerDay || 4;
  const target = data?.dailyTarget || 300;
  const checks = data?.checks || [];
  const okCount = checks.filter((check) => check.status === "ok").length;
  const worst = checks.some((check) => check.status === "fail") ? "bad" : checks.some((check) => check.status === "warn") ? "warn" : "ok";
  const hour = Number(new Intl.DateTimeFormat("de-DE", { hour: "numeric", hourCycle: "h23", timeZone: "Europe/Berlin" }).format(new Date()));
  const greeting = hour < 11 ? "Guten Morgen" : hour < 18 ? "Guten Tag" : "Guten Abend";
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
          <span className="dg-eyebrow" suppressHydrationWarning>{new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Berlin" }).format(new Date())}</span>
          <h1 className="dg-title" suppressHydrationWarning>{greeting}.</h1>
          <p className="dg-lead">{checks.length ? (worst === "ok" ? "Alles läuft. Hier ist Ihr Stand für heute." : `${checks.length - okCount} Punkte brauchen noch Ihre Aufmerksamkeit.`) : "Ihr Stand für heute."}</p>
        </div>
        <div className="dg-actions">
          {checks.length > 0 && <span className={`dg-pill dg-pill-${worst}`}><i />{worst === "ok" ? "Alles läuft" : worst === "warn" ? "Fast bereit" : "Aktion nötig"}</span>}
          <div className="dg-seg" role="group" aria-label="Zeitraum">
            {[7, 14, 30, 90].map((value) => <button key={value} type="button" aria-pressed={days === value} onClick={() => setDays(value)}>{value} Tage</button>)}
          </div>
        </div>
      </header>

      {data?.dbExpiry && (
        <p className="dg-notice" role="alert"><strong>Wichtig: Die Datenbank wird in {data.dbExpiry.hoursLeft} Stunden gelöscht.</strong> Dann sind alle Leads und Daten weg. <a href={data.dbExpiry.claimUrl} target="_blank" rel="noreferrer">Jetzt kostenlos übernehmen</a></p>
      )}
      {error && <p className="dg-notice" role="alert">{error}</p>}
      {!data && !error && <p className={styles.muted}>Lade Daten …</p>}

      {data && (
        <>
          <section className={styles.hero} aria-label="Heute">
            <Ring label="Termine heute" value={todayRow?.meetings ?? 0} goal={goal} unit="Ziel pro Tag" tone="gold" />
            <Ring label="Mails heute" value={todayRow?.sent ?? 0} goal={target} unit="Ziel pro Tag" tone="green" />
            <div className={`dg-panel ${styles.queue}`}>
              <span className={styles.k}>Warteschlange</span>
              <strong>{nf.format(data.queue?.queued ?? 0)}</strong>
              <p>{data.queue?.due ?? 0} jetzt fällig{data.queue?.next_at ? ` · nächste ${new Date(data.queue.next_at).toLocaleString("de-DE", { weekday: "short", hour: "2-digit", minute: "2-digit" })}` : ""}</p>
              <button type="button" className="dg-btn dg-btn-primary" onClick={() => void startNow()} disabled={starting}>{starting ? "Startet …" : "Jetzt starten"}</button>
            </div>
          </section>

          {startMessage && <p className={styles.startMessage} role="status">{startMessage}</p>}
          {(data.queue?.failed_open ?? 0) > 0 && <p className="dg-notice" role="alert">{data.queue.failed_open} Mails sind in den letzten 3 Tagen fehlgeschlagen. Bitte Postfächer prüfen.</p>}

          {checks.length > 0 && worst !== "ok" && (
            <section className={`dg-panel ${styles.checks}`} aria-labelledby="h-start">
              <div className={styles.checksHead}>
                <h2 id="h-start">Startklar machen</h2>
                <span>{okCount} von {checks.length} erledigt</span>
              </div>
              <div className={styles.checkBar} aria-hidden="true"><i style={{ width: `${(okCount / checks.length) * 100}%` }} /></div>
              <ul>
                {checks.map((check) => (
                  <li key={check.id} className={styles[check.status]}>
                    <span className={styles.mark} aria-hidden="true">{check.status === "ok" ? "✓" : check.status === "warn" ? "!" : "✕"}</span>
                    <span><strong>{check.label}</strong><small>{check.detail}</small></span>
                    {check.status !== "ok" && <Link href={check.href} className="dg-btn">Öffnen</Link>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className={styles.camps} aria-label="Kampagnen">
            {[["pflege-starter-v2", "Pflege", "Mitarbeitergewinnung"], ["pv-starter-v1", "Photovoltaik", "Kundengewinnung"]].map(([id, name, sub]) => {
              const row = data.campaigns?.find((item) => item.id === id);
              return (
                <div key={id} className={`dg-panel ${styles.camp}`}>
                  <div className={styles.campHead}><strong>{name}</strong><span>{sub}</span></div>
                  <div className={styles.campBar} role="progressbar" aria-valuemin={0} aria-valuemax={150} aria-valuenow={Math.min(150, row?.sent_today ?? 0)} aria-label={`${name}: Mails heute`}><i style={{ width: `${Math.min(100, ((row?.sent_today ?? 0) / 150) * 100)}%` }} /></div>
                  {(() => {
                    const vs = (data.variants ?? []).filter((v) => v.campaign_id === id);
                    if (vs.length < 2) return null;
                    const label = (v: string) => (id === "pv-starter-v1" ? (v === "A" ? "Lang" : v === "V" ? "Mit Video" : v === "D" ? "Neuer Text" : v === "E" ? "Emotional" : "Kurz") : v === "A" ? "Standard" : v === "C" ? "Ohne Stelle" : v === "V" ? "Mit Video" : v === "D" ? "Neuer Text" : v === "E" ? "Emotional" : "Videocall-Link");
                    return <p className={styles.abLine}>{id === "pv-starter-v1" ? "Test Lang gegen Kurz" : "Mail-Varianten"}: {vs.map((v) => `${label(v.variant)} ${v.replies} Antworten bei ${v.leads} Angeschriebenen${v.leads ? ` (${Math.round((v.replies / v.leads) * 100)} %)` : ""}`).join(" · ")}</p>;
                  })()}
                  <dl><div><dt>Heute</dt><dd>{row?.sent_today ?? 0} / 150</dd></div><div><dt>7 Tage</dt><dd>{nf.format(row?.sent7 ?? 0)}</dd></div><div><dt>Wartend</dt><dd>{nf.format(row?.queued ?? 0)}</dd></div><div><dt>Antworten</dt><dd>{row?.replies ?? 0}</dd></div></dl>
                </div>
              );
            })}
          </section>

          {(data.video?.length ?? 0) > 0 && (() => {
            const count = (type: string) => data.video?.find((item) => item.type === type)?.leads ?? 0;
            return (
              <p className={styles.abLine}>
                Video-Seite: Geöffnet {count("video_view")} · Abgespielt {count("video_play")} · mind. 50 % gesehen {count("video_progress")} · Kalender angeklickt {count("video_calendar_focus") + count("video_booking_click")} · Website besucht {count("site_view")}
              </p>
            );
          })()}

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
              <Chart rows={rows} days={days} />
            </section>

            <section className={`dg-panel ${styles.card}`} aria-labelledby="h-trichter">
              <h2 id="h-trichter">Vom Versand zum Termin</h2>
              <ol className={styles.funnel}>
                {funnel.map((step, index) => (
                  <li key={step.label}>
                    <div className={styles.fhead}><span>{step.label}</span><strong>{nf.format(step.value)}</strong><em>{step.rate}</em></div>
                    <div className={styles.fbar}><i style={{ width: `${sent > 0 ? Math.max(step.value ? 3 : 0, (step.value / sent) * 100) : 0}%`, opacity: 1 - index * 0.12 }} /></div>
                  </li>
                ))}
              </ol>
              <p className={styles.note}>Öffnungen sind ungenau, weil Mailprogramme Bilder automatisch laden. Antworten und Termine zählen.</p>
            </section>
          </div>

          {data.source && data.source.length > 0 && (() => {
            const checked = data.source.reduce((total, row) => total + row.n, 0);
            const fit = data.source.filter((row) => row.status === "imported").reduce((total, row) => total + row.n, 0);
            const open = data.source.filter((row) => row.status === "pending").reduce((total, row) => total + row.n, 0);
            const dropped = data.source.filter((row) => row.status === "skipped" || row.status === "failed");
            return (
              <section className={`dg-panel ${styles.card} ${styles.source}`} aria-labelledby="h-source">
                <h2 id="h-source">Lead-Suche über Stellenanzeigen</h2>
                <p className={styles.sourceLine}><strong>{nf.format(checked)}</strong> Anzeigen im letzten Lauf · <strong>{nf.format(fit)}</strong> passend{open ? ` · ${nf.format(open)} noch offen` : ""}</p>
                {dropped.length > 0 && <ul className={styles.reasons}>{dropped.map((row) => <li key={`${row.status}-${row.reason}`}><span>{row.status === "failed" ? "Abruf fehlgeschlagen" : reasonLabel[row.reason] || row.reason || "aussortiert"}</span><b>{nf.format(row.n)}</b></li>)}</ul>}
              </section>
            );
          })()}

          <div className={styles.cols}>
            <section className={`dg-panel ${styles.card}`} aria-labelledby="h-box">
              <h2 id="h-box">Postfächer</h2>
              <div className={styles.scroll}>
                <table className={styles.table}>
                  <thead><tr><th scope="col">Postfach</th><th scope="col">Heute</th><th scope="col">{days} Tage</th><th scope="col">Fehler</th><th scope="col">Wartend</th></tr></thead>
                  <tbody>
                    {data.mailboxes.length === 0 && <tr><td colSpan={5}>Noch nichts gesendet.</td></tr>}
                    {data.mailboxes.map((box) => (
                      <tr key={box.mailbox_id}><td>{box.mailbox_id}</td><td>{box.sent_today}</td><td>{box.sent_period}</td><td className={box.failed_period > 0 ? styles.warnCell : ""}>{box.failed_period}</td><td>{box.queued}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className={`dg-panel ${styles.card}`} aria-labelledby="h-seq">
              <h2 id="h-seq">Welche Mail bringt Antworten?</h2>
              <div className={styles.scroll}>
                <table className={styles.table}>
                  <thead><tr><th scope="col">Mail</th><th scope="col">Gesendet</th><th scope="col">Antwortquote</th></tr></thead>
                  <tbody>
                    {data.steps.length === 0 && <tr><td colSpan={3}>Noch keine Daten.</td></tr>}
                    {data.steps.map((step) => (
                      <tr key={step.step}><td>{step.step === 1 ? "Erstmail" : `Nachfassen ${step.step - 1}`}</td><td>{nf.format(step.sent)}</td><td>{pct(step.replied, step.sent)}</td></tr>
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

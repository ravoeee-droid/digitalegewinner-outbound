"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./LeadDrawer.module.css";

type Item = { at: string; kind: "mail" | "reply" | "event"; title: string; detail?: string; body?: string; status?: string };
type Detail = { lead: { id: string; stage: string; do_not_contact: boolean; company: string; city: string; website: string; source: string; contact: string; email: string; phone: string; pageUrl: string; analyseUrl: string }; items: Item[] };

const when = (value: string) => new Date(value).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });

export default function LeadDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/leads/${encodeURIComponent(id)}/detail`, { cache: "no-store" })
      .then(async (response) => { const json = await response.json(); if (!response.ok) throw new Error(json.error || "Laden fehlgeschlagen"); if (alive) setData(json); })
      .catch((err) => { if (alive) setError(err instanceof Error ? err.message : "Laden fehlgeschlagen"); });
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { alive = false; window.removeEventListener("keydown", onKey); };
  }, [id, onClose]);

  const lead = data?.lead;
  return createPortal(
    <div className={styles.backdrop} onClick={onClose}>
      <aside className={styles.panel} role="dialog" aria-modal="true" aria-label="Lead-Details" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <h2>{lead?.company || "Lead"}</h2>
            <p>{lead ? [lead.city, lead.stage].filter(Boolean).join(" · ") : ""}</p>
          </div>
          <button type="button" ref={closeRef} onClick={onClose} aria-label="Schließen">×</button>
        </header>
        {error && <p className={styles.error} role="alert">{error}</p>}
        {!data && !error && <p className={styles.muted}>Lädt …</p>}
        {lead && (
          <>
            <dl className={styles.facts}>
              <div><dt>Ansprechpartner</dt><dd>{lead.contact || "nicht bekannt"}</dd></div>
              <div><dt>E-Mail</dt><dd>{lead.email ? <a href={`mailto:${lead.email}`}>{lead.email}</a> : "–"}</dd></div>
              <div><dt>Telefon</dt><dd>{lead.phone ? <a href={`tel:${lead.phone.replace(/\s+/g, "")}`}>{lead.phone}</a> : "–"}</dd></div>
              <div><dt>Website</dt><dd>{lead.website ? <a href={/^https?:/i.test(lead.website) ? lead.website : `https://${lead.website}`} target="_blank" rel="noopener noreferrer">{lead.website.replace(/^https?:\/\//, "")}</a> : "–"}</dd></div>
            </dl>
            <p className={styles.links}>
              <a href={lead.pageUrl} target="_blank" rel="noopener noreferrer">Videoseite ansehen</a>
              <a href={lead.analyseUrl} target="_blank" rel="noopener noreferrer">Analyse (PDF)</a>
            </p>
            {lead.do_not_contact && <p className={styles.error}>Nicht kontaktieren (gesperrt oder abgemeldet).</p>}
            <h3>Verlauf</h3>
            {data.items.length === 0 && <p className={styles.muted}>Noch nichts passiert.</p>}
            <ol className={styles.timeline}>
              {data.items.map((item, index) => (
                <li key={index} className={styles[item.kind]}>
                  <time>{when(item.at)}</time>
                  {item.body ? (
                    <details>
                      <summary><strong>{item.title}</strong>{item.detail && <span>{item.detail}</span>}</summary>
                      <pre>{item.body}</pre>
                    </details>
                  ) : (
                    <p><strong>{item.title}</strong>{item.detail && <span>{item.detail}</span>}</p>
                  )}
                </li>
              ))}
            </ol>
          </>
        )}
      </aside>
    </div>,
    document.body,
  );
}

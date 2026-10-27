"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { classifyInboxMessage, currentReplyText, type InboxInsight } from "@/lib/inbox-classifier";
import styles from "./unified-inbox.module.css";

type Mailbox = { id: string; name: string; email: string; provider: string; configured: boolean };
type Message = { uid: number; from: string; fromName: string; to: string; subject: string; date: string; messageId: string; replyTo: string; unread: boolean; bodyText: string };
type InboxItem = Message & { id: string; mailboxId: string; mailboxEmail: string; insight: InboxInsight };
type Filter = "relevant" | "all" | "rueckruf" | "interesse" | "information" | "vermittler" | "einwand" | "absage" | "kontaktstopp" | "automatisch" | "sonstige";

const tabs: Array<{ key: Filter; label: string }> = [
  { key: "relevant", label: "Echte Antworten" }, { key: "rueckruf", label: "Rückrufe" },
  { key: "interesse", label: "Interesse" }, { key: "information", label: "Infos" },
  { key: "vermittler", label: "Personalvermittlung" }, { key: "einwand", label: "Einwände" },
  { key: "absage", label: "Absagen" }, { key: "kontaktstopp", label: "Kontaktstopp" },
  { key: "automatisch", label: "Automatisch" }, { key: "all", label: "Alle" },
];

function dateLabel(raw: string) {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw || "Unbekannt";
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Berlin" }).format(date) + " (DE)";
}

function senderAddress(item: InboxItem) {
  return String(item.replyTo || item.from || "").trim().replace(/^[^<]*<([^>]+)>.*$/, "$1");
}

function messageKey(mailbox: Mailbox, message: Message) {
  return message.messageId
    ? message.messageId.trim().toLowerCase()
    : mailbox.id + ":" + message.uid;
}

export default function UnifiedInbox() {
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [items, setItems] = useState<InboxItem[]>([]);
  const [filter, setFilter] = useState<Filter>("relevant");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [syncErrors, setSyncErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setLoadError("");
    try {
      const config = await fetch("/api/mail/config", { cache: "no-store" });
      const json = await config.json() as { items?: Mailbox[]; error?: string };
      if (!config.ok) throw new Error(json.error || "Postfachkonfiguration nicht erreichbar");
      const configured = (json.items || []).filter(m => m.configured && m.provider === "smtp");
      setMailboxes(configured);
      const next: InboxItem[] = [];
      const failures: string[] = [];

      // Jedes Postfach wird separat abgerufen; Fehler eines Postfachs
      // verhindern nicht das Anzeigen der übrigen Antworten.
      const chunkSize = 4;
      for (let index = 0; index < configured.length; index += chunkSize) {
        const batch = configured.slice(index, index + chunkSize);
        const results = await Promise.allSettled(batch.map(async mailbox => {
          const response = await fetch("/api/mail?folder=inbox&mailboxId=" + encodeURIComponent(mailbox.id) + "&limit=35", { cache: "no-store" });
          const body = await response.json() as { messages?: Message[]; error?: string };
          if (!response.ok) throw new Error(body.error || "IMAP nicht erreichbar");
          return { mailbox, messages: body.messages || [] };
        }));
        for (let i = 0; i < results.length; i++) {
          const result = results[i];
          if (result.status === "rejected") {
            failures.push(batch[i].email + ": " + (result.reason instanceof Error ? result.reason.message : "Abruf fehlgeschlagen"));
            continue;
          }
          for (const message of result.value.messages) {
            next.push({
              ...message,
              id: messageKey(result.value.mailbox, message),
              mailboxId: result.value.mailbox.id,
              mailboxEmail: result.value.mailbox.email,
              insight: classifyInboxMessage(message),
            });
          }
        }
      }
      const seen = new Set<string>();
      const distinct = next.filter(item => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      }).sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0)).slice(0, 350);
      setItems(distinct);
      setSelectedId(prev => prev && distinct.some(item => item.id === prev) ? prev : distinct.find(item => !item.insight.automatic)?.id || distinct[0]?.id || null);
      setSyncErrors(failures);
      setLastSync(new Date());
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Zentraler Posteingang nicht erreichbar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);
  useEffect(() => {
    const timer = window.setInterval(() => { void refresh(true); }, 120_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const counts = useMemo(() => {
    const result = {} as Record<Filter, number>;
    for (const tab of tabs) result[tab.key] = tab.key === "all"
      ? items.length
      : tab.key === "relevant" ? items.filter(item => !item.insight.automatic).length
      : items.filter(item => item.insight.category === tab.key).length;
    result.sonstige = items.filter(item => item.insight.category === "sonstige").length;
    return result;
  }, [items]);

  const visible = useMemo(() => items.filter(item => {
    if (filter === "relevant" && item.insight.automatic) return false;
    if (filter !== "all" && filter !== "relevant" && item.insight.category !== filter) return false;
    const needle = search.trim().toLowerCase();
    return !needle || [item.from, item.fromName, item.subject, item.mailboxEmail, currentReplyText(item.bodyText)].join(" ").toLowerCase().includes(needle);
  }), [items, filter, search]);

  const selected = visible.find(item => item.id === selectedId) || visible[0] || null;
  const activeMailbox = selected && mailboxes.find(mailbox => mailbox.id === selected.mailboxId);
  const readableBody = selected ? currentReplyText(selected.bodyText) : "";
  const hasQuotedHistory = Boolean(selected && readableBody.length < selected.bodyText.trim().length);
  const canReply = Boolean(selected && !selected.insight.automatic && selected.insight.category !== "kontaktstopp" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderAddress(selected)));

  function selectTab(value: Filter) {
    setFilter(value);
    setReplyOpen(false);
    setReplyText("");
    setShowHistory(false);
    setNotice("");
  }

  function selectMessage(id: string) {
    setSelectedId(id);
    setReplyOpen(false);
    setReplyText("");
    setShowHistory(false);
    setNotice("");
  }

  async function sendReply() {
    if (!selected || !canReply || !replyText.trim()) return;
    setSending(true);
    setNotice("");
    try {
      const recipient = senderAddress(selected);
      const subject = /^(re:|aw:)/i.test(selected.subject) ? selected.subject.replace(/^aw:/i, "Re:") : "Re: " + selected.subject;
      const result = await fetch("/api/mail", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mailboxId: selected.mailboxId, to: recipient, subject, text: replyText.trim() }),
      });
      const data = await result.json() as { error?: string };
      if (!result.ok) throw new Error(data.error || "Antwort konnte nicht gesendet werden");
      setReplyOpen(false);
      setReplyText("");
      setNotice("Antwort über " + selected.mailboxEmail + " gesendet.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Senden fehlgeschlagen.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>DIGITALE GEWINNER · SALES INBOX</p>
          <h1>Alle Antworten. Ein Posteingang.</h1>
          <p className={styles.intro}>Alle verbundenen Netcup-Postfächer aus Pflege und PV. Automatische Nachrichten sind getrennt – echte Rückmeldungen werden priorisiert.</p>
        </div>
        <div className={styles.headerButtons}>
          <Link className={styles.secondary} href="/mail">Einzelpostfächer</Link>
          <button className={styles.primary} onClick={() => void refresh()} disabled={loading}>{loading ? "Synchronisiere …" : "↻ Aktualisieren"}</button>
        </div>
      </div>

      <div className={styles.metrics}>
        <div><strong>{counts.relevant || 0}</strong><span>Echte Antworten</span></div>
        <div><strong>{counts.rueckruf || 0}</strong><span>Rückrufwünsche</span></div>
        <div><strong>{counts.vermittler || 0}</strong><span>Vermittler-Einwände</span></div>
        <div><strong>{counts.automatisch || 0}</strong><span>Automatisch gefiltert</span></div>
        <div><strong>{mailboxes.length}</strong><span>Verbundene Postfächer</span></div>
      </div>

      {loadError && <p role="alert" className={styles.error}>{loadError}</p>}
      {syncErrors.length > 0 && <details className={styles.partial}><summary>{syncErrors.length} Postfach-/Abruffehler – übrige Postfächer werden trotzdem angezeigt</summary><ul>{syncErrors.map(v => <li key={v}>{v}</li>)}</ul></details>}

      <nav className={styles.filters} aria-label="Antwortfilter">
        {tabs.map(tab => <button type="button" key={tab.key} className={filter === tab.key ? styles.activeFilter : styles.filter} onClick={() => selectTab(tab.key)}>{tab.label} <span>{counts[tab.key] || 0}</span></button>)}
      </nav>

      <div className={styles.searchRow}>
        <input aria-label="Antworten durchsuchen" placeholder="Nach Name, Firma, E-Mail oder Inhalt suchen …" value={search} onChange={event => setSearch(event.target.value)} />
        <span>{lastSync ? "Letzter Abruf: " + lastSync.toLocaleTimeString("de-DE") : "Noch nicht synchronisiert"}</span>
      </div>

      <div className={styles.shell}>
        <section className={styles.listPane} aria-label="Nachrichtenliste">
          {loading && !items.length ? <div className={styles.empty}>Antworten aus den Postfächern werden geladen …</div> : visible.length === 0 ? <div className={styles.empty}>Keine Nachrichten in diesem Filter gefunden.</div> : visible.map(item =>
            <button type="button" key={item.id + ":" + item.mailboxId} className={(selected?.id === item.id ? styles.selectedRow : styles.messageRow)} onClick={() => selectMessage(item.id)}>
              <div className={styles.rowTop}><strong>{item.fromName || item.from}</strong><time>{dateLabel(item.date)}</time></div>
              <b>{item.subject || "(ohne Betreff)"}</b>
              <p>{currentReplyText(item.bodyText).slice(0, 160) || "(Kein Text)"}</p>
              <div className={styles.rowFooter}><span className={item.insight.priority === "high" ? styles.highTag : styles.tag}>{item.insight.label}</span><small>{item.mailboxEmail}</small>{item.unread && <i aria-label="Ungelesen">●</i>}</div>
            </button>
          )}
        </section>

        <section className={styles.reader} aria-label="Ausgewählte Nachricht">
          {selected ? <>
            <div className={styles.readerHead}>
              <span className={selected.insight.priority === "high" ? styles.highTag : styles.tag}>{selected.insight.label}</span>
              <h2>{selected.subject || "(ohne Betreff)"}</h2>
              <p><strong>{selected.fromName || selected.from}</strong> · {selected.from} · {dateLabel(selected.date)}</p>
              <small>Empfangen in {selected.mailboxEmail}</small>
            </div>
            <div className={styles.replyAdvice}><strong>Nächster Schritt:</strong> {selected.insight.nextStep}</div>
            <div className={styles.readBody}>{showHistory ? selected.bodyText : readableBody || selected.bodyText}</div>
            {hasQuotedHistory && <button className={styles.historyToggle} onClick={() => setShowHistory(!showHistory)}>{showHistory ? "Zitierte alte E-Mail ausblenden" : "Zitierte E-Mail einblenden (inkl. technische Links)"}</button>}
            {notice && <div role="status" className={styles.notice}>{notice}</div>}
            {replyOpen && canReply && <>
              <div className={styles.compose}><label htmlFor="unified-inbox-reply">Antwort als {activeMailbox?.email || selected.mailboxEmail} an {senderAddress(selected)}</label>
                <textarea id="unified-inbox-reply" rows={7} value={replyText} onChange={e => setReplyText(e.target.value)} placeholder="Persönliche Antwort verfassen …" />
                <div><button className={styles.secondary} onClick={() => setReplyOpen(false)} disabled={sending}>Abbrechen</button><button className={styles.primary} onClick={() => void sendReply()} disabled={sending || !replyText.trim()}>{sending ? "Wird gesendet …" : "Antwort verbindlich senden"}</button></div>
              </div>
            </>}
            <div className={styles.readerFooter}>
              {canReply ? <button className={styles.primary} onClick={() => setReplyOpen(true)}>↩ Persönlich antworten</button> : <span>{selected.insight.category === "kontaktstopp" ? "Antwortfunktion zum Schutz vor erneuter Kontaktaufnahme deaktiviert." : "Auf diese automatische Nachricht kann nicht geantwortet werden."}</span>}
              <Link className={styles.secondary} href="/mail">Postfach öffnen</Link>
            </div>
          </> : <div className={styles.empty}>Wähle links eine Nachricht aus.</div>}
        </section>
      </div>
      <p className={styles.footnote}>Die Einordnung ist eine Arbeitshilfe, keine rechtliche Freigabe. Automatische Antworten werden nur ausgeblendet, nicht gelöscht. Antworten werden niemals automatisch gesendet. Die Liste zeigt jeweils die neuesten 35 Nachrichten pro verbundenem IMAP-Postfach.</p>
    </div>
  );
}

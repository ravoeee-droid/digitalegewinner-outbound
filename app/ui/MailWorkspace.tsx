"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import styles from "./mail-workspace.module.css";

type Mailbox = {
  id: string;
  name: string;
  email: string;
  provider: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  configured: boolean;
};

type Message = {
  uid: number;
  from: string;
  fromName: string;
  to: string;
  subject: string;
  date: string;
  messageId: string;
  replyTo: string;
  unread: boolean;
  bodyText: string;
};

type ComposeState = { open: boolean; to: string; subject: string };

const emptyCompose: ComposeState = { open: false, to: "", subject: "" };

function formatDate(value: string) {
  if (!value) return "–";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "–";
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return new Intl.DateTimeFormat("de-DE", sameDay
    ? { hour: "2-digit", minute: "2-digit" }
    : { day: "2-digit", month: "2-digit", year: "2-digit" }).format(date);
}

function senderLabel(message: Message) {
  return message.fromName || message.from || "Unbekannter Absender";
}

export default function MailWorkspace() {
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [activeId, setActiveId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedUid, setSelectedUid] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [setupOpen, setSetupOpen] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [compose, setCompose] = useState<ComposeState>(emptyCompose);
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [folder, setFolder] = useState<"inbox" | "sent">("inbox");

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  };

  async function loadInbox(mailboxId: string, quiet = false, nextFolder?: "inbox" | "sent") {
    if (!mailboxId) return;
    const useFolder = nextFolder || folder;
    if (!quiet) setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/mail?mailboxId=${encodeURIComponent(mailboxId)}&limit=20&folder=${useFolder}`, { cache: "no-store" });
      const json = await response.json() as { messages?: Message[]; error?: string };
      if (!response.ok) throw new Error(json.error || "Postfach konnte nicht geladen werden.");
      const next = json.messages || [];
      setMessages(next);
      setSelectedUid((current) => current && next.some((item) => item.uid === current) ? current : next[0]?.uid || null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Postfach konnte nicht geladen werden.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }

  async function loadConfig() {
    setLoading(true);
    try {
      const response = await fetch("/api/mail/config", { cache: "no-store" });
      const json = await response.json() as { items?: Mailbox[]; error?: string };
      if (!response.ok) throw new Error(json.error || "Mailboxen konnten nicht geladen werden.");
      const items = json.items || [];
      setMailboxes(items);
      if (!items.length) {
        setSetupOpen(true);
        setLoading(false);
        return;
      }
      const nextId = activeId && items.some((item) => item.id === activeId)
        ? activeId
        : (items.find((item) => item.configured) || items[0]).id;
      setActiveId(nextId);
      await loadInbox(nextId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Mailboxen konnten nicht geladen werden.");
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void loadConfig(), 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!activeId) return;
    const timer = window.setInterval(() => void loadInbox(activeId, true), 60_000);
    return () => window.clearInterval(timer);
  }, [activeId]);

  const selected = useMemo(() => messages.find((item) => item.uid === selectedUid) || null, [messages, selectedUid]);
  const activeMailbox = useMemo(() => mailboxes.find((item) => item.id === activeId) || null, [mailboxes, activeId]);
  const unreadCount = messages.filter((item) => item.unread).length;

  async function saveMailbox(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const numberOrUndefined = (name: string) => {
      const value = String(data.get(name) || "").trim();
      return value ? Number(value) : undefined;
    };
    const body = {
      id: String(data.get("id") || "").trim() || undefined,
      name: String(data.get("name") || "Raphael Hermann").trim(),
      email: String(data.get("email") || "").trim(),
      password: String(data.get("password") || ""),
      username: String(data.get("username") || "").trim() || undefined,
      imapHost: String(data.get("imapHost") || "").trim() || undefined,
      imapPort: numberOrUndefined("imapPort"),
      smtpHost: String(data.get("smtpHost") || "").trim() || undefined,
      smtpPort: numberOrUndefined("smtpPort"),
    };
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/mail/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await response.json() as { mailbox?: Mailbox; error?: string };
      if (!response.ok || !json.mailbox) throw new Error(json.error || "Postfach konnte nicht verbunden werden.");
      form.reset();
      setSetupOpen(false);
      setAdvanced(false);
      setMailboxes((current) => {
        const without = current.filter((item) => item.id !== json.mailbox!.id);
        return [json.mailbox!, ...without];
      });
      setActiveId(json.mailbox.id);
      notify("Postfach verbunden · Empfangen und Senden sind bereit.");
      await loadInbox(json.mailbox.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Postfach konnte nicht verbunden werden.");
    } finally {
      setSaving(false);
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeMailbox) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setSending(true);
    setError("");
    try {
      const response = await fetch("/api/mail", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mailboxId: activeMailbox.id,
          to: String(data.get("to") || "").trim(),
          subject: String(data.get("subject") || "").trim(),
          text: String(data.get("text") || ""),
        }),
      });
      const json = await response.json() as { error?: string };
      if (!response.ok) throw new Error(json.error || "E-Mail konnte nicht gesendet werden.");
      form.reset();
      setCompose(emptyCompose);
      notify("E-Mail wurde versendet.");
      setFolder("sent");
      setSelectedUid(null);
      await loadInbox(activeMailbox.id, false, "sent");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "E-Mail konnte nicht gesendet werden.");
    } finally {
      setSending(false);
    }
  }

  function reply(message: Message) {
    const subject = /^re:/i.test(message.subject) ? message.subject : `Re: ${message.subject}`;
    setCompose({ open: true, to: message.replyTo || message.from, subject });
  }

  async function changeMailbox(id: string) {
    setActiveId(id);
    setMessages([]);
    setSelectedUid(null);
    await loadInbox(id);
  }

  return <main className={styles.page}>
    <header className={styles.header}>
      <div className={styles.brandRow}>
        <Link href="/outbound" className={styles.back}>← Command Center</Link>
        <span className={styles.kicker}>DIGITALE GEWINNER · KOMMUNIKATION</span>
      </div>
      <div className={styles.headerMain}>
        <div>
          <h1>E-Mail</h1>
          <p>Dein echtes Netcup-Postfach direkt im CRM – lesen, schreiben und antworten.</p>
        </div>
        <div className={styles.headerActions}>
          {activeMailbox && <select aria-label="Postfach auswählen" value={activeId} onChange={(event) => void changeMailbox(event.target.value)}>
            {mailboxes.map((mailbox) => <option key={mailbox.id} value={mailbox.id}>{mailbox.configured ? "" : "⚠ "}{mailbox.email}{mailbox.configured ? "" : " (nicht verbunden)"}</option>)}
          </select>}
          <button className={styles.secondary} onClick={() => setSetupOpen(true)}>⚙ Postfach</button>
          <button className={styles.primary} disabled={!activeMailbox} onClick={() => setCompose({ open: true, to: "", subject: "" })}>＋ Neue E-Mail</button>
        </div>
      </div>
    </header>

    {error && <div className={styles.error}><strong>Mail-Verbindung</strong><span>{error}</span><button onClick={() => setSetupOpen(true)}>Einstellungen öffnen</button></div>}

    <section className={styles.mailShell}>
      <aside className={styles.inboxPane}>
        <div className={styles.inboxHead}>
          <div><span>{folder === "sent" ? "GESENDET" : "POSTEINGANG"}</span><strong>{activeMailbox?.email || "Noch nicht verbunden"}</strong></div>
          <div className={styles.inboxTools}>{folder === "inbox" && <span>{unreadCount} ungelesen</span>}<button disabled={!activeId || loading} onClick={() => void loadInbox(activeId)} aria-label="Aktualisieren">↻</button></div>
        </div>
        <div className={styles.folderTabs}>
          <button type="button" className={folder === "inbox" ? styles.folderActive : undefined} onClick={() => { setFolder("inbox"); setSelectedUid(null); void loadInbox(activeId, false, "inbox"); }}>Posteingang</button>
          <button type="button" className={folder === "sent" ? styles.folderActive : undefined} onClick={() => { setFolder("sent"); setSelectedUid(null); void loadInbox(activeId, false, "sent"); }}>Gesendet</button>
        </div>

        {!activeMailbox && !loading ? <div className={styles.empty}>
          <div className={styles.emptyIcon}>✉</div>
          <h2>Netcup-Postfach verbinden</h2>
          <p>Einmal E-Mail-Adresse und Passwort eintragen. Die Server erkennen wir automatisch; bei Bedarf kannst du sie manuell angeben.</p>
          <button className={styles.primary} onClick={() => setSetupOpen(true)}>Postfach verbinden</button>
        </div> : loading ? <div className={styles.loading}>Postfach wird synchronisiert …</div> : messages.length ? <div className={styles.messageList}>
          {messages.map((message) => <button key={message.uid} onClick={() => setSelectedUid(message.uid)} className={`${styles.messageRow} ${selectedUid === message.uid ? styles.selected : ""} ${message.unread ? styles.unread : ""}`}>
            <span className={styles.unreadDot}>{message.unread ? "●" : ""}</span>
            <div className={styles.messageCopy}>
              <div><strong>{folder === "sent" ? `An: ${message.to}` : senderLabel(message)}</strong><time>{formatDate(message.date)}</time></div>
              <b>{message.subject || "(ohne Betreff)"}</b>
              <p>{message.bodyText.replace(/\s+/g, " ").slice(0, 120)}</p>
            </div>
          </button>)}
        </div> : <div className={styles.empty}><div className={styles.emptyIcon}>✓</div><h2>Posteingang ist leer</h2><p>Neue Nachrichten erscheinen hier automatisch.</p></div>}
      </aside>

      <article className={styles.readerPane}>
        {selected ? <>
          <div className={styles.readerHead}>
            <div className={styles.readerTitle}>
              <span>{selected.unread ? "NEU" : "NACHRICHT"}</span>
              <h2>{selected.subject || "(ohne Betreff)"}</h2>
              <div className={styles.senderLine}>
                <div className={styles.avatar}>{folder === "sent" ? "→" : (selected.fromName || selected.from || "?").slice(0, 1).toUpperCase()}</div>
                {folder === "sent"
                  ? <div><strong>An: {selected.to}</strong><small>von {activeMailbox?.email}</small></div>
                  : <div><strong>{senderLabel(selected)}</strong><small>{selected.from} · an {selected.to || activeMailbox?.email}</small></div>}
                <time>{selected.date ? new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(selected.date)) : ""}</time>
              </div>
            </div>
            {folder === "inbox" && <button className={styles.reply} onClick={() => reply(selected)}>↩ Antworten</button>}
          </div>
          <div className={styles.body}>{selected.bodyText}</div>
          <div className={styles.replyBar}><button className={styles.primary} onClick={() => reply(selected)}>↩ Antworten</button><span>Antwort wird über {activeMailbox?.email} gesendet</span></div>
        </> : <div className={styles.readerEmpty}><div>✉</div><h2>Wähle eine Nachricht</h2><p>Hier kannst du die vollständige E-Mail lesen und direkt antworten.</p></div>}
      </article>
    </section>

    {setupOpen && <div className={styles.overlay} onMouseDown={() => !saving && setSetupOpen(false)}>
      <section className={styles.modal} onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span>NETCUP MAIL</span><h2>Postfach verbinden</h2><p>Die Zugangsdaten werden verschlüsselt serverseitig gespeichert und nie wieder im Klartext angezeigt.</p></div><button disabled={saving} onClick={() => setSetupOpen(false)}>×</button></header>
        <form onSubmit={saveMailbox}>
          {activeMailbox && <input type="hidden" name="id" value={activeMailbox.id} />}
          <label>Absendername<input name="name" defaultValue={activeMailbox?.name || "Raphael Hermann"} autoComplete="name" /></label>
          <label>E-Mail-Adresse<input name="email" type="email" defaultValue={activeMailbox?.email || ""} placeholder="raphael@digitalegewinner.de" required autoComplete="username" /></label>
          <label>Netcup E-Mail-Passwort<input name="password" type="password" required autoComplete="current-password" placeholder="Passwort des Postfachs" /><small>Das Passwort bleibt ausschließlich verschlüsselt im Server-Tresor.</small></label>
          <button type="button" className={styles.advancedToggle} onClick={() => setAdvanced((value) => !value)}>{advanced ? "▾" : "▸"} Erweiterte Serverdaten</button>
          {advanced && <div className={styles.advancedGrid}>
            <label>Benutzername<input name="username" placeholder="meist die E-Mail-Adresse" /></label>
            <label>IMAP Server<input name="imapHost" defaultValue={activeMailbox?.imapHost || ""} placeholder="wird automatisch erkannt" /></label>
            <label>IMAP Port<input name="imapPort" type="number" defaultValue={activeMailbox?.imapPort || 993} /></label>
            <label>SMTP Server<input name="smtpHost" defaultValue={activeMailbox?.smtpHost || ""} placeholder="wird automatisch erkannt" /></label>
            <label>SMTP Port<input name="smtpPort" type="number" defaultValue={activeMailbox?.smtpPort || 465} /></label>
          </div>}
          <div className={styles.modalHint}><b>Vor dem Speichern testen wir beides:</b><span>IMAP-Empfang + SMTP-Versand. Nur wenn beide funktionieren, wird das Postfach verbunden.</span></div>
          <button className={styles.saveButton} disabled={saving}>{saving ? "Verbindung wird geprüft …" : "✓ Speichern & verbinden"}</button>
        </form>
      </section>
    </div>}

    {compose.open && activeMailbox && <div className={styles.overlay} onMouseDown={() => !sending && setCompose(emptyCompose)}>
      <section className={`${styles.modal} ${styles.composeModal}`} onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span>NEUE NACHRICHT</span><h2>E-Mail schreiben</h2><p>Von {activeMailbox.name ? `${activeMailbox.name} · ` : ""}{activeMailbox.email}</p></div><button disabled={sending} onClick={() => setCompose(emptyCompose)}>×</button></header>
        <form onSubmit={sendMessage}>
          <label>An<input name="to" type="email" defaultValue={compose.to} required autoFocus /></label>
          <label>Betreff<input name="subject" defaultValue={compose.subject} /></label>
          <label>Nachricht<textarea name="text" required rows={13} placeholder="Nachricht schreiben …" /></label>
          <div className={styles.composeActions}><button type="button" className={styles.secondary} disabled={sending} onClick={() => setCompose(emptyCompose)}>Abbrechen</button><button className={styles.saveButton} disabled={sending}>{sending ? "Wird gesendet …" : "Senden ↗"}</button></div>
        </form>
      </section>
    </div>}

    {toast && <div className={styles.toast}>{toast}</div>}
  </main>;
}

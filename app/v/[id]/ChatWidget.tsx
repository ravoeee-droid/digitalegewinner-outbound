"use client";

import { useRef, useState } from "react";
import styles from "./page.module.css";
import { track } from "./track";

type Message = { role: "user" | "assistant"; content: string };

export default function ChatWidget({ token, company, whatsapp }: { token: string; company: string; whatsapp: string }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([{ role: "assistant", content: "Hallo, ich bin der KI-Assistent von Raphael. Haben Sie Fragen zum Video oder dazu, wie wir helfen können? Oder schreiben Sie direkt mit Raphael auf WhatsApp." }]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const wa = `https://wa.me/${whatsapp}?text=${encodeURIComponent(`Hallo Raphael, ich habe Ihr Video gesehen (${company}).`)}`;

  function toggle() {
    if (!open) track("chat_open");
    setOpen(!open);
  }
  async function send(event: React.FormEvent) {
    event.preventDefault();
    const content = text.trim();
    if (!content || busy) return;
    const next = [...messages, { role: "user" as const, content }];
    setMessages(next); setText(""); setBusy(true);
    try {
      const response = await fetch("/api/t/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ t: token, messages: next.filter((m, index) => index > 0 || m.role === "user") }) });
      const json = await response.json();
      setMessages([...next, { role: "assistant", content: json.reply || json.error || "Das hat leider nicht geklappt." }]);
    } catch {
      setMessages([...next, { role: "assistant", content: "Verbindung fehlgeschlagen. Schreiben Sie uns gern auf WhatsApp." }]);
    } finally {
      setBusy(false);
      window.setTimeout(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }), 30);
    }
  }

  return (
    <>
      <div className={styles.fabs}>
        <a href={wa} target="_blank" rel="noopener noreferrer" className={styles.waFab} onClick={() => track("whatsapp_click")} aria-label="Per WhatsApp mit Raphael schreiben">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.2 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7a11 11 0 0 1-4.6-4 5 5 0 0 1-1-2.7 3 3 0 0 1 1-2.2c.3-.3.6-.4.8-.4h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .5l-.4.6c-.2.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.2 1.4 2.5 1.5.3.1.5.1.6-.1l.9-1.1c.2-.3.4-.2.6-.1l1.9.9c.3.1.5.2.5.4 0 .2 0 .8-.2 1.2Z" /></svg>
          <span>WhatsApp</span>
        </a>
        <button type="button" className={styles.chatFab} onClick={toggle} aria-expanded={open} aria-label={open ? "Chat schließen" : "Chat mit dem KI-Assistenten öffnen"}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M21 12a8 8 0 0 1-8 8H6l-3 2 1-3.5A8 8 0 1 1 21 12Z" /></svg>
          <span>Frage stellen</span>
        </button>
      </div>
      {open && (
        <section className={styles.chatPanel} aria-label="Chat mit dem KI-Assistenten">
          <header>
            <span className={styles.avatar} aria-hidden="true">RH</span>
            <div><strong>KI-Assistent von Raphael</strong><small>Antwort in wenigen Sekunden</small></div>
            <button type="button" onClick={toggle} aria-label="Chat schließen">×</button>
          </header>
          <div className={styles.chatList} ref={listRef} aria-live="polite">
            {messages.map((m, index) => <p key={index} className={m.role === "user" ? styles.userMsg : styles.botMsg}>{m.content}</p>)}
            {busy && <p className={styles.botMsg}>schreibt …</p>}
          </div>
          <form onSubmit={send}>
            <input value={text} onChange={(event) => setText(event.target.value)} placeholder="Ihre Frage …" maxLength={500} aria-label="Ihre Frage" />
            <button type="submit" disabled={busy}>Senden</button>
          </form>
          <footer>Dieser Chat nutzt KI; Ihre Nachrichten werden dafür verarbeitet. <a href={wa} target="_blank" rel="noopener noreferrer" onClick={() => track("whatsapp_click")}>Lieber mit Raphael auf WhatsApp</a></footer>
        </section>
      )}
    </>
  );
}

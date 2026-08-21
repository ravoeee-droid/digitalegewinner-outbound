"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import styles from "./DomainMailCenter.module.css";

type Mailbox = {
  id: string;
  name: string;
  email: string;
  provider: string;
  dailyLimit: number;
  sentToday: number;
  warmupDay: number;
  health: number;
  enabled: boolean;
  spf?: boolean;
  dkim?: boolean;
  dmarc?: boolean;
};

type DomainHealth = {
  mx: boolean;
  spf: boolean;
  dmarc: boolean;
  dkim?: string;
  score: number;
  spfRecord?: string;
  dmarcRecord?: string;
  note?: string;
};

type DomainProfile = {
  id: string;
  domain: string;
  registrar: string;
  dnsProvider: string;
  mailProvider: string;
  purpose: string;
  createdAt: string;
  lastCheckedAt?: string;
  health?: DomainHealth;
};

type AppState = Record<string, unknown> & {
  domains?: DomainProfile[];
  mailboxes?: Mailbox[];
};

function normalizeDomain(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .replace(/\.$/, "");
}

function mailboxDomain(email: string) {
  return email.split("@")[1]?.toLowerCase() || "";
}

export default function DomainMailCenter() {
  const [open, setOpen] = useState(false);
  const [domains, setDomains] = useState<DomainProfile[]>([]);
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState("");
  const [loaded, setLoaded] = useState(false);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3000);
  };

  async function getState(): Promise<AppState> {
    const response = await fetch("/api/state", { cache: "no-store" });
    const json = (await response.json()) as { state?: AppState; error?: string };
    if (!response.ok) throw new Error(json.error || "State konnte nicht geladen werden.");
    return json.state || {};
  }

  async function load() {
    try {
      const state = await getState();
      setDomains(Array.isArray(state.domains) ? state.domains : []);
      setMailboxes(Array.isArray(state.mailboxes) ? state.mailboxes : []);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Domain Center konnte nicht geladen werden.");
    } finally {
      setLoaded(true);
    }
  }

  async function persist(patch: Partial<AppState>) {
    const latest = await getState();
    const next = { ...latest, ...patch };
    const response = await fetch("/api/state", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next),
    });
    const json = (await response.json()) as { error?: string };
    if (!response.ok) throw new Error(json.error || "Änderung konnte nicht gespeichert werden.");
  }

  useEffect(() => {
    void load();
  }, []);

  const readyDomains = useMemo(
    () => domains.filter((domain) => domain.health?.mx && domain.health?.spf && domain.health?.dmarc).length,
    [domains],
  );

  async function addDomain(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const domain = normalizeDomain(String(form.get("domain") || ""));
    if (!domain.includes(".")) return notify("Bitte eine gültige Domain eintragen.");
    if (domains.some((item) => item.domain === domain)) return notify("Diese Domain ist bereits angelegt.");

    const nextDomain: DomainProfile = {
      id: `domain-${Date.now()}`,
      domain,
      registrar: String(form.get("registrar") || "Nicht hinterlegt"),
      dnsProvider: String(form.get("dnsProvider") || "Nicht hinterlegt"),
      mailProvider: String(form.get("mailProvider") || "Nicht hinterlegt"),
      purpose: String(form.get("purpose") || "Outbound"),
      createdAt: new Date().toISOString(),
    };
    const next = [nextDomain, ...domains];
    setBusy("add-domain");
    try {
      await persist({ domains: next });
      setDomains(next);
      event.currentTarget.reset();
      notify(`${domain} hinzugefügt.`);
      await checkDomain(nextDomain, next);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Domain konnte nicht gespeichert werden.");
    } finally {
      setBusy("");
    }
  }

  async function checkDomain(profile: DomainProfile, source = domains) {
    setBusy(`check-${profile.id}`);
    try {
      const response = await fetch("/api/domain/health", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ domain: profile.domain }),
      });
      const json = (await response.json()) as DomainHealth & { error?: string };
      if (!response.ok) throw new Error(json.error || "DNS-Check fehlgeschlagen.");
      const updated = source.map((item) =>
        item.id === profile.id
          ? { ...item, health: json, lastCheckedAt: new Date().toISOString() }
          : item,
      );
      await persist({ domains: updated });
      setDomains(updated);
      notify(`${profile.domain}: DNS ${json.score}/100`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "DNS-Check fehlgeschlagen.");
    } finally {
      setBusy("");
    }
  }

  async function removeDomain(profile: DomainProfile) {
    if (mailboxes.some((mailbox) => mailboxDomain(mailbox.email) === profile.domain)) {
      return notify("Entferne zuerst die Mailboxen dieser Domain.");
    }
    const next = domains.filter((item) => item.id !== profile.id);
    setBusy(`remove-${profile.id}`);
    try {
      await persist({ domains: next });
      setDomains(next);
      notify(`${profile.domain} entfernt.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Domain konnte nicht entfernt werden.");
    } finally {
      setBusy("");
    }
  }

  async function addMailbox(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "").trim().toLowerCase();
    if (!email.includes("@")) return notify("Bitte eine gültige E-Mail-Adresse eintragen.");
    const domain = mailboxDomain(email);
    if (!domains.some((item) => item.domain === domain)) return notify(`Lege ${domain} zuerst als Domain an.`);
    if (mailboxes.some((item) => item.email.toLowerCase() === email)) return notify("Diese Mailbox existiert bereits.");

    const mailbox: Mailbox = {
      id: `mb-${Date.now()}`,
      name: String(form.get("name") || "Raphael Hermann"),
      email,
      provider: String(form.get("provider") || "SMTP"),
      dailyLimit: 5,
      sentToday: 0,
      warmupDay: 1,
      health: 60,
      enabled: true,
      spf: false,
      dkim: false,
      dmarc: false,
    };
    const next = [mailbox, ...mailboxes];
    setBusy("add-mailbox");
    try {
      await persist({ mailboxes: next });
      setMailboxes(next);
      event.currentTarget.reset();
      notify(`${email} angelegt · Startlimit 5/Tag.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Mailbox konnte nicht gespeichert werden.");
    } finally {
      setBusy("");
    }
  }

  return (
    <>
      <button className={styles.launcher} onClick={() => setOpen(true)} aria-label="Domain & Mail Center öffnen">
        <span>＠</span>
        <div><strong>Domains & Mail</strong><small>{readyDomains}/{domains.length} DNS-ready</small></div>
      </button>

      {open && (
        <div className={styles.overlay} onClick={() => setOpen(false)}>
          <section className={styles.panel} onClick={(event) => event.stopPropagation()}>
            <header className={styles.header}>
              <div><span>INFRASTRUCTURE</span><h2>Domain & Mail Center</h2><p>Domains, DNS und Absender getrennt verwalten – zentral im Outbound OS.</p></div>
              <button onClick={() => setOpen(false)} aria-label="Schließen">×</button>
            </header>

            {!loaded ? <div className={styles.empty}>Infrastruktur wird geladen …</div> : (
              <div className={styles.content}>
                <div className={styles.stats}>
                  <article><span>Domains</span><strong>{domains.length}</strong><small>zentral verwaltet</small></article>
                  <article><span>DNS-ready</span><strong>{readyDomains}</strong><small>MX + SPF + DMARC</small></article>
                  <article><span>Mailboxen</span><strong>{mailboxes.length}</strong><small>für Outbound verfügbar</small></article>
                </div>

                <div className={styles.grid}>
                  <section className={styles.card}>
                    <div className={styles.cardHead}><div><span>DOMAIN INVENTORY</span><h3>Domains</h3></div></div>
                    <form className={styles.form} onSubmit={addDomain}>
                      <label>Domain<input name="domain" placeholder="z. B. pflegekraftfinder.de" required /></label>
                      <label>Registrar<select name="registrar" defaultValue="netcup"><option>netcup</option><option>Cloudflare Registrar</option><option>IONOS</option><option>Checkdomain</option><option>Sonstige</option></select></label>
                      <label>DNS<select name="dnsProvider" defaultValue="Cloudflare"><option>Cloudflare</option><option>netcup</option><option>Vercel DNS</option><option>Sonstige</option></select></label>
                      <label>Mail<select name="mailProvider" defaultValue="SMTP"><option>SMTP</option><option>Google Workspace</option><option>Microsoft 365</option><option>netcup Mail</option><option>Sonstige</option></select></label>
                      <label>Zweck<select name="purpose"><option>Outbound</option><option>Hauptdomain</option><option>Landingpage</option><option>Kunde</option></select></label>
                      <button disabled={busy === "add-domain"}>{busy === "add-domain" ? "Speichert…" : "+ Domain hinzufügen"}</button>
                    </form>

                    <div className={styles.domainList}>
                      {domains.length === 0 && <div className={styles.empty}>Noch keine Domain hinterlegt.</div>}
                      {domains.map((profile) => {
                        const domainMailboxes = mailboxes.filter((mailbox) => mailboxDomain(mailbox.email) === profile.domain);
                        return <article key={profile.id} className={styles.domainCard}>
                          <div className={styles.domainTop}>
                            <div><span className={profile.health?.score === 100 ? styles.okDot : styles.warnDot} /><div><strong>{profile.domain}</strong><small>{profile.registrar} · DNS {profile.dnsProvider} · Mail {profile.mailProvider}</small></div></div>
                            <b>{profile.health?.score ?? 0}/100</b>
                          </div>
                          <div className={styles.checks}>
                            <span className={profile.health?.mx ? styles.ok : styles.warn}>{profile.health?.mx ? "✓" : "!"} MX</span>
                            <span className={profile.health?.spf ? styles.ok : styles.warn}>{profile.health?.spf ? "✓" : "!"} SPF</span>
                            <span className={profile.health?.dmarc ? styles.ok : styles.warn}>{profile.health?.dmarc ? "✓" : "!"} DMARC</span>
                            <span className={styles.neutral}>DKIM · Provider-Selector</span>
                          </div>
                          <div className={styles.domainMeta}><span>{profile.purpose}</span><span>{domainMailboxes.length} Mailboxen</span>{profile.lastCheckedAt && <span>Check {new Date(profile.lastCheckedAt).toLocaleString("de-DE")}</span>}</div>
                          <div className={styles.actions}>
                            <button onClick={() => void checkDomain(profile)} disabled={busy === `check-${profile.id}`}>{busy === `check-${profile.id}` ? "Prüft…" : "↻ DNS prüfen"}</button>
                            <button className={styles.danger} onClick={() => void removeDomain(profile)} disabled={busy === `remove-${profile.id}`}>Entfernen</button>
                          </div>
                        </article>;
                      })}
                    </div>
                  </section>

                  <aside className={styles.side}>
                    <section className={styles.card}>
                      <div className={styles.cardHead}><div><span>MAILBOXES</span><h3>Absender</h3></div></div>
                      <form className={styles.form} onSubmit={addMailbox}>
                        <label>Name<input name="name" defaultValue="Raphael Hermann" /></label>
                        <label>E-Mail<input name="email" type="email" placeholder="raphael@domain.de" required /></label>
                        <label>Provider<select name="provider"><option>SMTP</option><option>Google</option><option>Microsoft</option><option>netcup</option></select></label>
                        <button disabled={busy === "add-mailbox"}>{busy === "add-mailbox" ? "Speichert…" : "+ Mailbox anlegen"}</button>
                      </form>
                      <div className={styles.mailboxList}>{mailboxes.map((mailbox) => <article key={mailbox.id}><span>✉</span><div><strong>{mailbox.email}</strong><small>{mailbox.provider} · {mailbox.dailyLimit}/Tag · Health {mailbox.health}%</small></div></article>)}</div>
                    </section>

                    <section className={styles.card}>
                      <div className={styles.cardHead}><div><span>DNS BLUEPRINT</span><h3>Was gesetzt sein muss</h3></div></div>
                      <div className={styles.blueprint}>
                        <div><b>MX</b><p>Zeigt auf deinen tatsächlichen Mailanbieter. Die exakten Werte kommen vom Provider.</p></div>
                        <div><b>SPF</b><p>Genau ein SPF-TXT-Record. Alle erlaubten Versender gehören in denselben Record.</p></div>
                        <div><b>DKIM</b><p>Provider-Selector + Public Key als TXT/CNAME. Wird je Mailanbieter erzeugt.</p></div>
                        <div><b>DMARC</b><code>v=DMARC1; p=none;</code></div>
                      </div>
                      <p className={styles.hint}>Für produktiven Outbound erst senden, wenn MX, SPF und DMARC grün sind und DKIM beim Mailanbieter bestätigt ist.</p>
                    </section>
                  </aside>
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {toast && <div className={styles.toast}>{toast}</div>}
    </>
  );
}

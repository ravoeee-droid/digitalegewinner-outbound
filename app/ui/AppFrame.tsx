"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import styles from "./AppFrame.module.css";

type IconName = "today" | "crm" | "call" | "send" | "care" | "web" | "mail" | "studio" | "seo" | "draft";
type Item = { href: string; label: string; hint: string; icon: IconName; sales?: boolean };
type Group = { title: string; items: Item[] };

const GROUPS: Group[] = [
  { title: "Täglich", items: [
    { href: "/heute", label: "Heute", hint: "Calls, Mails, Termine", icon: "today", sales: true },
    { href: "/crm", label: "CRM", hint: "Pipeline & Follow-ups", icon: "crm", sales: true },
    { href: "/call", label: "Call-Cockpit", hint: "Nächster Anruf", icon: "call", sales: true },
  ] },
  { title: "Gewinnen", items: [
    { href: "/outbound", label: "Outbound", hint: "Command Center", icon: "send" },
    { href: "/pflege", label: "Pflege Sales OS", hint: "Leads & Radar", icon: "care", sales: true },
    { href: "/websites", label: "Websites", hint: "Builds & Vorschauen", icon: "web" },
    { href: "/outreach", label: "Outreach", hint: "Entwürfe prüfen", icon: "draft" },
  ] },
  { title: "Werkzeuge", items: [
    { href: "/mail", label: "Mail", hint: "Postfächer & Inbox", icon: "mail" },
    { href: "/studio", label: "Studio", hint: "Videos & Landingpages", icon: "studio" },
    { href: "/seo-radar", label: "SEO Radar", hint: "Keywords & Reports", icon: "seo" },
  ] },
];

// Diese Seiten bringen eine eigene Seitenleiste mit: die globale Leiste wird dort zur schmalen Icon-Leiste.
const RAIL_PREFIXES = ["/pflege", "/outbound", "/seo-radar", "/studio"];
const BARE_PREFIXES = ["/a/", "/login"];

function Icon({ name }: { name: IconName }) {
  const p = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (name) {
    case "today": return <svg {...p}><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /><path d="m9.5 15 2 2 3.5-4" /></svg>;
    case "crm": return <svg {...p}><rect x="3" y="4" width="5" height="16" rx="1.5" /><rect x="10" y="4" width="5" height="10" rx="1.5" /><rect x="17" y="4" width="4" height="13" rx="1.5" /></svg>;
    case "call": return <svg {...p}><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" /></svg>;
    case "send": return <svg {...p}><path d="m4 4 16 7.2-7 2.1-2.2 6.7L4 4Z" /><path d="m11 13 4.8-4.8" /></svg>;
    case "care": return <svg {...p}><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" /></svg>;
    case "web": return <svg {...p}><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M3 9h18M7 6.5h.01M10 6.5h.01" /></svg>;
    case "draft": return <svg {...p}><path d="M5 20h4l10-10-4-4L5 16v4Z" /><path d="m13.5 7.5 4 4" /></svg>;
    case "mail": return <svg {...p}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4.5 7 7.5 6 7.5-6" /></svg>;
    case "studio": return <svg {...p}><rect x="3" y="6" width="13" height="12" rx="2.5" /><path d="m16 10.5 5-3v9l-5-3" /></svg>;
    default: return <svg {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4M8 11h6M11 8v6" /></svg>;
  }
}

export default function AppFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "/";
  const [role, setRole] = useState<"admin" | "sales" | null>(null);
  const router = useRouter();
  const [openFor, setOpenFor] = useState<string | null>(null);
  const open = openFor === pathname;
  const [pinned, setPinned] = useState(false);
  const bare = BARE_PREFIXES.some((p) => pathname.startsWith(p));
  const rail = RAIL_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`)) && !pinned;

  useEffect(() => {
    if (bare) return; // öffentliche Seiten (Microsite, Login) brauchen weder Rolle noch Navigation
    fetch("/api/auth/me", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => {
      setRole(j?.role || null);
      try { setPinned(localStorage.getItem("dg-nav-pinned") === "1"); } catch { /* nicht kritisch */ }
    }).catch(() => setRole(null));
  }, [bare]);

  if (bare) return <>{children}</>;

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    router.push("/login");
  }
  function togglePin() {
    const next = !pinned;
    setPinned(next);
    try { localStorage.setItem("dg-nav-pinned", next ? "1" : "0"); } catch { /* nicht kritisch */ }
  }

  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => role !== "sales" || i.sales) })).filter((g) => g.items.length);
  const all = groups.flatMap((g) => g.items);
  const current = all.find((i) => pathname === i.href || pathname.startsWith(`${i.href}/`));
  const canRail = RAIL_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  return (
    <div className={`${styles.frame} ${rail ? styles.rail : ""}`}>
      <header className={styles.mobileBar}>
        <button type="button" className={styles.burger} aria-label="Menü öffnen" aria-expanded={open} aria-controls="dg-sidebar" onClick={() => setOpenFor(open ? null : pathname)}>
          <span /><span /><span />
        </button>
        <Link href="/heute" className={styles.mobileBrand}><span className={styles.mark}>DG</span><strong>{current?.label || "Digitale Gewinner"}</strong></Link>
      </header>
      {open && <button type="button" className={styles.scrim} aria-label="Menü schließen" onClick={() => setOpenFor(null)} />}

      <aside id="dg-sidebar" className={`${styles.sidebar} ${open ? styles.open : ""}`}>
        <Link href="/heute" className={styles.brand} aria-label="Digitale Gewinner – Startseite">
          <span className={styles.mark}>DG</span>
          <span className={styles.brandCopy}><strong>Digitale Gewinner</strong><small>Outbound OS</small></span>
        </Link>
        <nav className={styles.nav} aria-label="Hauptnavigation">
          {groups.map((g) => (
            <div key={g.title} className={styles.group}>
              <p>{g.title}</p>
              {g.items.map((item) => {
                const active = item === current;
                return (
                  <Link key={item.href} href={item.href} className={active ? styles.linkActive : styles.link} aria-current={active ? "page" : undefined} title={item.label}>
                    <span className={styles.icon}><Icon name={item.icon} /></span>
                    <span className={styles.copy}><strong>{item.label}</strong><small>{item.hint}</small></span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className={styles.bottom}>
          {canRail && <button type="button" className={styles.pin} onClick={togglePin}>{pinned ? "Leiste verkleinern" : "Leiste vergrößern"}</button>}
          {role && (
            <div className={styles.user}>
              <span className={styles.avatar}>{role === "admin" ? "RH" : "VT"}</span>
              <div className={styles.userCopy}><strong>{role === "admin" ? "Raphael" : "Vertrieb"}</strong><small>{role === "admin" ? "Admin" : "Sales"}</small></div>
              <button type="button" className={styles.logout} onClick={() => void logout()}>Abmelden</button>
            </div>
          )}
        </div>
      </aside>

      <main id="main" className={styles.main}>{children}</main>
    </div>
  );
}

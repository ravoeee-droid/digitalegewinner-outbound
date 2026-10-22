"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import styles from "./AppFrame.module.css";

type IconName = "today" | "crm" | "call" | "send" | "care" | "web" | "mail" | "studio" | "seo" | "draft" | "dot";
type Item = { href: string; label: string; icon?: IconName; hint?: string; sales?: boolean };
type Group = { title: string; items: Item[]; cols?: 2; more?: boolean };

// Eine flache Navigation: jedes Ziel ist genau einen Klick entfernt. Unterbereiche haben eigene Deep-Links.
const GROUPS: Group[] = [
  { title: "Hauptmenü", items: [
    { href: "/dashboard", label: "Dashboard", icon: "crm", hint: "Start, Versand, Termine" },
    { href: "/heute", label: "Heute", icon: "today", hint: "Was ist heute zu tun", sales: true },
    { href: "/leads", label: "Leads", icon: "care", hint: "Alle Leads, bereit zum Anschreiben", sales: true },
    { href: "/pflege?view=campaigns", label: "Kampagnen", icon: "send", hint: "Mails und Limits" },
    { href: "/mail", label: "Postfächer", icon: "mail", hint: "Gesendet und Antworten" },
    { href: "/call", label: "Anrufe", icon: "call", hint: "Nächster Anruf", sales: true },
  ] },
  { title: "Mehr", more: true, items: [
    { href: "/crm", label: "CRM Pipeline", icon: "dot", sales: true },
    { href: "/pflege?view=finder", label: "Deutschland-Radar", icon: "dot", sales: true },
    { href: "/landkreise", label: "Landkreis-Scanner", icon: "dot", sales: true },
    { href: "/pflege", label: "Pflege Übersicht", icon: "dot", sales: true },
    { href: "/pflege?view=crm", label: "Research", icon: "dot", sales: true },
    { href: "/pflege?view=followups", label: "Follow-ups", icon: "dot", sales: true },
    { href: "/pflege?view=meetings", label: "Termine", icon: "dot", sales: true },
    { href: "/pflege?view=proposals", label: "Angebote", icon: "dot", sales: true },
    { href: "/pflege?view=inbox", label: "Antworten", icon: "dot" },
    { href: "/outbound", label: "Command Center", icon: "dot" },
    { href: "/outbound/engine", label: "Engine & Compliance", icon: "dot" },
    { href: "/outbound/vertriebswaffen", label: "Vertriebswaffen", icon: "dot", sales: true },
    { href: "/studio", label: "Studio (Loom-Video)", icon: "dot" },
    { href: "/websites", label: "Websites", icon: "dot" },
    { href: "/seo-radar", label: "SEO Radar", icon: "dot" },
    { href: "/content-intelligence", label: "Content Intelligence", icon: "dot" },
    { href: "/pflege?view=system", label: "Integrationen", icon: "dot", sales: true },
  ] },
];
const BARE_PREFIXES = ["/a/", "/v/", "/login"];

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
    case "seo": return <svg {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4M8 11h6M11 8v6" /></svg>;
    default: return <svg {...p}><circle cx="12" cy="12" r="2.2" /></svg>;
  }
}

function isActive(item: Item, pathname: string, params: URLSearchParams) {
  const [path, query = ""] = item.href.split("?");
  if (pathname !== path && !(path !== "/" && pathname.startsWith(`${path}/`) && !query)) return false;
  if (pathname !== path) return false;
  const want = new URLSearchParams(query);
  if (want.size === 0) {
    // Basisseite ist nur aktiv, wenn keine Unteransicht gewählt ist
    return !params.get("view") && !params.get("tab");
  }
  for (const [k, v] of want) if (params.get(k) !== v) return false;
  return true;
}

function Links({ groups, pathname }: { groups: Group[]; pathname: string }) {
  const params = useSearchParams();
  const renderItem = (item: Item) => {
    const active = isActive(item, pathname, params);
    return (
      <Link key={item.href} href={item.href} className={`${active ? styles.linkActive : styles.link} ${item.hint ? "" : styles.compact}`} aria-current={active ? "page" : undefined} title={item.label} onClick={item.href.includes("view=finder") ? () => window.dispatchEvent(new Event("dg:open-germany-radar")) : undefined}>
        <span className={styles.icon}><Icon name={item.icon || "dot"} /></span>
        <span className={styles.copy}><strong>{item.label}</strong>{item.hint && <small>{item.hint}</small>}</span>
      </Link>
    );
  };
  return (
    <>
      {groups.map((g) => g.more ? (
        <details key={g.title} className={`${styles.group} ${styles.more}`} open={g.items.some((item) => isActive(item, pathname, params))}>
          <summary>{g.title} ({g.items.length})</summary>
          {g.items.map(renderItem)}
        </details>
      ) : (
        <div key={g.title} className={`${styles.group} ${g.cols ? styles.twoCol : ""}`}>
          <p>{g.title}</p>
          {g.items.map(renderItem)}
        </div>
      ))}
    </>
  );
}

export default function AppFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const [role, setRole] = useState<"admin" | "sales" | null>(null);
  const [openFor, setOpenFor] = useState<string | null>(null);
  const open = openFor === pathname;
  const bare = BARE_PREFIXES.some((p) => pathname.startsWith(p));

  useEffect(() => {
    if (bare) return;
    fetch("/api/auth/me", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => setRole(j?.role || null)).catch(() => setRole(null));
  }, [bare]);

  if (bare) return <>{children}</>;

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    router.push("/login");
  }

  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => role !== "sales" || i.sales) })).filter((g) => g.items.length);
  const current = groups.flatMap((g) => g.items).find((i) => i.href.split("?")[0] === pathname);

  return (
    <div className={styles.frame}>
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
        <nav className={styles.nav} aria-label="Hauptnavigation" onClick={(event) => { if ((event.target as HTMLElement).closest("a")) setOpenFor(null); }}>
          <Suspense fallback={null}><Links groups={groups} pathname={pathname} /></Suspense>
        </nav>
        <div className={styles.bottom}>
          {role && (
            <div className={styles.user}>
              <span className={styles.avatar}>{role === "admin" ? "RH" : "VT"}</span>
              <div className={styles.userCopy}><strong>{role === "admin" ? "Raphael" : "Vertrieb"}</strong><small>{role === "admin" ? "Admin" : "Sales"}</small></div>
              <button type="button" className={styles.logout} onClick={() => void logout()}>Abmelden</button>
            </div>
          )}
        </div>
      </aside>

      <div id="main" className={styles.main}>{children}</div>
    </div>
  );
}

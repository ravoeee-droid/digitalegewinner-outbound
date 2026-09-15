"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./GlobalNav.module.css";

const SECTIONS = [
  { href: "/outbound", label: "Outbound" },
  { href: "/call", label: "Call" },
  { href: "/websites", label: "Websites" },
  { href: "/pflege", label: "Pflege" },
  { href: "/seo-radar", label: "SEO Radar" },
  { href: "/studio", label: "Studio" },
  { href: "/mail", label: "Mail" },
  { href: "/outreach", label: "Outreach" },
];

const HIDDEN_PREFIXES = ["/a/", "/login"];

export default function GlobalNav() {
  const pathname = usePathname() || "/";
  if (HIDDEN_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return null;

  return (
    <div className={styles.bar}>
      <Link href="/outbound" className={styles.brand}>
        <span className={styles.mark}>DG</span>
        <span>DIGITALE GEWINNER</span>
      </Link>
      <nav className={styles.nav} aria-label="Hauptnavigation">
        {SECTIONS.map((section) => {
          const isActive = pathname === section.href || pathname.startsWith(`${section.href}/`);
          return (
            <Link key={section.href} href={section.href} className={isActive ? styles.active : undefined}>
              {section.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

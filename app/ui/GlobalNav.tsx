"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
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
  const [role,setRole]=useState<"admin"|"sales"|null>(null);
  useEffect(()=>{ fetch("/api/auth/me",{cache:"no-store"}).then(r=>r.ok?r.json():null).then(j=>setRole(j?.role||null)).catch(()=>setRole(null)); },[]);
  if (HIDDEN_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return null;

  async function logout(){
    await fetch("/api/auth/logout",{method:"POST"}).catch(()=>undefined);
    window.location.href="/login";
  }

  return (
    <div className={styles.bar}>
      <Link href={role==="sales"?"/pflege":"/outbound"} className={styles.brand}>
        <span className={styles.mark}>DG</span>
        <span>DIGITALE GEWINNER</span>
      </Link>
      <nav className={styles.nav} aria-label="Hauptnavigation">
        {SECTIONS.filter((section)=>role!=="sales" || ["/pflege","/call"].includes(section.href)).map((section) => {
          const isActive = pathname === section.href || pathname.startsWith(`${section.href}/`);
          return (
            <Link key={section.href} href={section.href} className={isActive ? styles.active : undefined}>
              {section.label}
            </Link>
          );
        })}
      </nav>
      {role && <button className={styles.logout} type="button" onClick={()=>void logout()}>Logout</button>}
    </div>
  );
}

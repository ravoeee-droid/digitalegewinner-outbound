"use client";

import Link from "next/link";

export default function MailLauncher() {
  return <Link
    href="/mail"
    aria-label="E-Mail-Postfach öffnen"
    style={{
      position: "fixed",
      right: 190,
      bottom: 24,
      zIndex: 81,
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      border: "1px solid #315e49",
      background: "rgba(9,16,13,.94)",
      color: "#d8f7e9",
      padding: "11px 14px",
      borderRadius: 14,
      fontWeight: 850,
      fontSize: 12,
      textDecoration: "none",
      boxShadow: "0 18px 45px rgba(5,10,8,.35)",
      backdropFilter: "blur(16px)",
    }}
  >
    <span aria-hidden="true">✉</span>
    <span>E-Mail</span>
  </Link>;
}

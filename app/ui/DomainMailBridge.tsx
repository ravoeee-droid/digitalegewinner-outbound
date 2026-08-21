"use client";

import { useEffect } from "react";

export default function DomainMailBridge() {
  useEffect(() => {
    const open = () => {
      document.querySelector<HTMLButtonElement>('button[aria-label="Domain & Mail Center öffnen"]')?.click();
    };
    window.addEventListener("domainmail:open", open);
    return () => window.removeEventListener("domainmail:open", open);
  }, []);
  return null;
}

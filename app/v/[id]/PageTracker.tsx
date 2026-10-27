"use client";

import { useEffect } from "react";
import { setTrackToken, setTrackVariant, track } from "./track";

// Misst: Seite geöffnet, Scrolltiefe, Verweildauer (nur bei sichtbarem Tab), Klick auf "Termin buchen", Kalender angeklickt.
export default function PageTracker({ token, variant = "A" }: { token: string; variant?: "A" | "B" }) {
  useEffect(() => {
    setTrackToken(token);
    setTrackVariant(variant);
    track("view");
    let visible = 0;
    let sentScroll = 0;
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") visible += 1; if (visible === 30 || visible === 120) track("dwell", visible); }, 1000);
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (max <= 0) return;
      const pct = (window.scrollY / max) * 100;
      for (const step of [50, 90]) if (pct >= step && sentScroll < step) { sentScroll = step; track("scroll", step); }
    };
    const flush = () => track("dwell", visible);
    const onHide = () => { if (document.visibilityState === "hidden") flush(); };
    const onClick = (event: MouseEvent) => {
      const link = (event.target as HTMLElement | null)?.closest?.('a[href="#termin"]');
      if (link) track("booking_click");
      const whatsapp = (event.target as HTMLElement | null)?.closest?.('a[data-secondary-action="whatsapp"]');
      if (whatsapp) track("whatsapp_click");
    };
    let focusSent = false;
    const onBlur = () => window.setTimeout(() => {
      if (!focusSent && document.activeElement instanceof HTMLIFrameElement && document.activeElement.title.startsWith("Terminbuchung")) { focusSent = true; track("calendar_focus"); }
    }, 50);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", flush);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onHide);
    document.addEventListener("click", onClick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onHide);
      document.removeEventListener("click", onClick);
    };
  }, [token, variant]);
  return null;
}

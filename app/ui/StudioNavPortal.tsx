"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export default function StudioNavPortal() {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const nav = document.querySelector<HTMLElement>(".launch-sidebar nav");
    setTarget(nav);
  }, []);

  if (!target) return null;

  return createPortal(
    <a className="launch-studio-nav" href="/studio" aria-label="High-End Studio V3 öffnen">
      <span aria-hidden="true">▶</span>
      <span>Studio V3</span>
      <b aria-hidden="true">V3</b>
    </a>,
    target,
  );
}

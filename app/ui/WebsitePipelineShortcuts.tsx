"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type Opportunity = {
  product_key: string;
  website: string;
  website_score: number;
  annual_value: number;
  status: string;
  stage: string;
};

type Snapshot = { opportunities?: Opportunity[] };

type Mode = "no-website" | "bad-website";

function compactEuro(value: number) {
  const number = Number(value || 0);
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(number >= 10_000_000 ? 0 : 1).replace(".", ",")} Mio. €`;
  if (number >= 1000) return `${Math.round(number / 1000)}k €`;
  return `${Math.round(number)} €`;
}

function setReactInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function clickPipeline(mode: Mode) {
  const buttons = Array.from(document.querySelectorAll("button"));
  const websiteButton = buttons.find((button) => button.textContent?.trim() === "Website");
  websiteButton?.click();

  const input = document.querySelector<HTMLInputElement>('input[aria-label="Leads durchsuchen"]');
  if (input) {
    setReactInputValue(input, mode === "no-website" ? "Keine Website erkannt" : "Website-Score");
  }

  const pipelineButton = buttons.find((button) => {
    const text = button.textContent || "";
    return text.includes("Pipeline") && !text.includes("Alle Pipelines");
  });
  pipelineButton?.click();
}

export default function WebsitePipelineShortcuts() {
  const [target, setTarget] = useState<Element | null>(null);
  const [data, setData] = useState<Snapshot>({});

  useEffect(() => {
    const findTarget = () => {
      const labels = Array.from(document.querySelectorAll("div"));
      const label = labels.find((node) => node.textContent?.trim() === "PRODUKT-PIPELINES");
      if (label?.nextElementSibling) setTarget(label.nextElementSibling);
    };

    findTarget();
    const timer = window.setInterval(findTarget, 800);
    const stop = window.setTimeout(() => window.clearInterval(timer), 8000);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(stop);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/revenue-opportunities", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((json: Snapshot) => { if (!cancelled) setData(json); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const stats = useMemo(() => {
    const websiteRows = (data.opportunities || []).filter((item) =>
      item.product_key === "website" && item.status === "open" && !["Gewonnen", "Verloren"].includes(item.stage)
    );
    const noWebsite = websiteRows.filter((item) => !String(item.website || "").trim());
    const badWebsite = websiteRows.filter((item) => Boolean(String(item.website || "").trim()) && Number(item.website_score || 0) > 0 && Number(item.website_score || 0) < 72);
    return {
      noWebsite: { count: noWebsite.length, value: noWebsite.reduce((sum, item) => sum + Number(item.annual_value || 0), 0) },
      badWebsite: { count: badWebsite.length, value: badWebsite.reduce((sum, item) => sum + Number(item.annual_value || 0), 0) },
    };
  }, [data]);

  if (!target) return null;

  const baseStyle = {
    width: "100%",
    border: "1px solid rgba(255,255,255,.10)",
    borderRadius: 14,
    padding: "11px 12px",
    background: "linear-gradient(180deg, rgba(25,25,30,.98), rgba(14,14,18,.98))",
    color: "#fff",
    textAlign: "left" as const,
    cursor: "pointer",
    display: "grid",
    gap: 4,
    boxShadow: "0 10px 28px rgba(0,0,0,.18)",
  };

  return createPortal(
    <>
      <button type="button" onClick={() => clickPipeline("no-website")} style={{ ...baseStyle, borderColor: "rgba(213,255,89,.28)" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 900 }}><i style={{ width: 8, height: 8, borderRadius: 999, background: "#d5ff59", display: "inline-block" }} />Keine Website</span>
        <small style={{ color: "rgba(255,255,255,.58)", fontSize: 10 }}>{stats.noWebsite.count} offen · direkt Website verkaufen</small>
        <b style={{ fontSize: 13 }}>{compactEuro(stats.noWebsite.value)}</b>
      </button>
      <button type="button" onClick={() => clickPipeline("bad-website")} style={{ ...baseStyle, borderColor: "rgba(180,120,255,.28)" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 900 }}><i style={{ width: 8, height: 8, borderRadius: 999, background: "#b478ff", display: "inline-block" }} />Schlechte Website</span>
        <small style={{ color: "rgba(255,255,255,.58)", fontSize: 10 }}>{stats.badWebsite.count} offen · Relaunch-Hebel vorhanden</small>
        <b style={{ fontSize: 13 }}>{compactEuro(stats.badWebsite.value)}</b>
      </button>
    </>,
    target,
  );
}

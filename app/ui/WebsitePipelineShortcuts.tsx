"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type PipelineStat = { count: number; value: number };
type Stats = {
  noWebsite?: PipelineStat;
  badWebsite?: PipelineStat;
  maintenanceLong?: PipelineStat;
  outdated?: PipelineStat;
  broken?: PipelineStat;
};

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
  if (input) setReactInputValue(input, mode === "no-website" ? "Keine Website" : "Schlechte Website");

  const pipelineButton = buttons.find((button) => {
    const text = button.textContent || "";
    return text.includes("Pipeline") && !text.includes("Alle Pipelines");
  });
  pipelineButton?.click();
}

export default function WebsitePipelineShortcuts() {
  const [target, setTarget] = useState<Element | null>(null);
  const [stats, setStats] = useState<Stats>({});

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
    fetch("/api/website-sales-intelligence", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((json: Stats) => { if (!cancelled) setStats(json); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  if (!target) return null;

  const noWebsite = stats.noWebsite || { count: 0, value: 0 };
  const badWebsite = stats.badWebsite || { count: 0, value: 0 };
  const maintenance = stats.maintenanceLong?.count || 0;
  const outdated = stats.outdated?.count || 0;
  const broken = stats.broken?.count || 0;

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
        <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 900 }}><i style={{ width: 8, height: 8, borderRadius: 999, background: "#34c759", display: "inline-block" }} />Keine Website</span>
        <small style={{ color: "rgba(255,255,255,.58)", fontSize: 10 }}>{noWebsite.count} verifiziert · direkter Website-Hebel</small>
        <b style={{ fontSize: 13 }}>{compactEuro(noWebsite.value)}</b>
      </button>
      <button type="button" onClick={() => clickPipeline("bad-website")} style={{ ...baseStyle, borderColor: "rgba(180,120,255,.28)" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 900 }}><i style={{ width: 8, height: 8, borderRadius: 999, background: "#b478ff", display: "inline-block" }} />Schlechte Website</span>
        <small style={{ color: "rgba(255,255,255,.58)", fontSize: 10 }}>{badWebsite.count} verifiziert · {maintenance} Wartung · {outdated} veraltet · {broken} kaputt</small>
        <b style={{ fontSize: 13 }}>{compactEuro(badWebsite.value)}</b>
      </button>
    </>,
    target,
  );
}

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_REDIRECTS = 4;
const MAX_BYTES = 2_500_000;

function isPrivateIpv4(address: string) {
  const p = address.split(".").map(Number);
  if (p.length !== 4 || p.some((v) => Number.isNaN(v))) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}

function isPrivateIpv6(address: string) {
  const value = address.toLowerCase();
  return value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd") || /^fe[89ab]/.test(value);
}

function isPrivateAddress(address: string) {
  const version = isIP(address);
  if (version === 4) return isPrivateIpv4(address);
  if (version === 6) return isPrivateIpv6(address);
  return true;
}

async function safeUrl(input: string) {
  const raw = String(input || "").trim();
  if (!raw) throw new Error("Bitte eine Domain eingeben.");
  const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("Nur HTTP/HTTPS URLs sind erlaubt.");
  if (url.username || url.password) throw new Error("URLs mit Zugangsdaten sind nicht erlaubt.");
  if (url.port && !['80', '443'].includes(url.port)) throw new Error("Nicht-standardmäßige Ports sind für den Audit gesperrt.");
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("Diese Domain kann nicht analysiert werden.");
  if (isIP(host) && isPrivateAddress(host)) throw new Error("Private Netzwerkadressen sind gesperrt.");
  if (!isIP(host)) {
    const resolved = await lookup(host, { all: true, verbatim: true });
    if (!resolved.length || resolved.some((entry) => isPrivateAddress(entry.address))) throw new Error("Die Domain löst auf eine gesperrte Netzwerkadresse auf.");
  }
  return url;
}

async function fetchHtml(initial: URL) {
  let current = initial;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9_000);
    try {
      const response = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        cache: "no-store",
        headers: { "user-agent": "DigitaleGewinner-SEORadar/1.0 (+https://digitalegewinner.de)" },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new Error("Weiterleitung ohne Ziel erhalten.");
        current = await safeUrl(new URL(location, current).toString());
        continue;
      }
      if (!response.ok) throw new Error(`Website antwortet mit HTTP ${response.status}.`);
      const type = response.headers.get("content-type") || "";
      if (!type.includes("text/html")) throw new Error("Die URL liefert keine HTML-Seite.");
      const declared = Number(response.headers.get("content-length") || 0);
      if (declared > MAX_BYTES) throw new Error("Die Seite ist für den schnellen Audit zu groß.");
      const html = await response.text();
      if (Buffer.byteLength(html, "utf8") > MAX_BYTES) throw new Error("Die Seite ist für den schnellen Audit zu groß.");
      return { response, html };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("Zu viele Weiterleitungen.");
}

function stripTags(value = "") {
  return value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function firstMatch(html: string, regex: RegExp) {
  return stripTags(html.match(regex)?.[1] || "");
}

function countMatches(html: string, regex: RegExp) {
  return (html.match(regex) || []).length;
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { url?: string };
    const initial = await safeUrl(body.url || "");
    const { response, html } = await fetchHtml(initial);
    const title = firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
    const description = firstMatch(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i) || firstMatch(html, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["'][^>]*>/i);
    const h1 = firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const h1Count = countMatches(html, /<h1\b[^>]*>/gi);
    const h2Count = countMatches(html, /<h2\b[^>]*>/gi);
    const imageCount = countMatches(html, /<img\b[^>]*>/gi);
    const imagesMissingAlt = (html.match(/<img\b(?![^>]*\balt\s*=)[^>]*>/gi) || []).length;
    const internalLinks = (html.match(/<a\b[^>]*href=["'](?:\/|#|\.\/)[^"']*["'][^>]*>/gi) || []).length;
    const canonical = firstMatch(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["'][^>]*>/i) || firstMatch(html, /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["'][^>]*>/i);
    const robotsNoindex = /<meta[^>]+name=["']robots["'][^>]+content=["'][^"']*noindex/i.test(html);
    let score = 100;
    const issues: Array<{ level: "high" | "medium" | "low"; text: string }> = [];
    if (!title) { score -= 18; issues.push({ level: "high", text: "Seitentitel fehlt" }); }
    else if (title.length < 30 || title.length > 65) { score -= 6; issues.push({ level: "medium", text: "Seitentitel hat keine ideale Länge" }); }
    if (!description) { score -= 12; issues.push({ level: "high", text: "Meta Description fehlt" }); }
    else if (description.length < 80 || description.length > 180) { score -= 4; issues.push({ level: "low", text: "Meta Description kann präziser dimensioniert werden" }); }
    if (!h1) { score -= 15; issues.push({ level: "high", text: "H1 fehlt" }); }
    if (h1Count > 1) { score -= 6; issues.push({ level: "medium", text: `${h1Count} H1-Überschriften gefunden` }); }
    if (!canonical) { score -= 5; issues.push({ level: "low", text: "Canonical-Link nicht erkannt" }); }
    if (robotsNoindex) { score -= 25; issues.push({ level: "high", text: "Seite ist auf noindex gesetzt" }); }
    if (imagesMissingAlt > 0) { score -= Math.min(10, imagesMissingAlt * 2); issues.push({ level: "medium", text: `${imagesMissingAlt} Bilder ohne Alt-Attribut` }); }
    if (internalLinks < 3) { score -= 4; issues.push({ level: "low", text: "Sehr wenige interne Links auf der analysierten Seite" }); }
    return NextResponse.json({ url: response.url, status: response.status, score: Math.max(0, score), title, description, h1, h1Count, h2Count, imageCount, imagesMissingAlt, internalLinks, canonical, robotsNoindex, issues, checkedAt: new Date().toISOString() });
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError" ? "Website-Analyse hat zu lange gedauert." : error instanceof Error ? error.message : "Analyse fehlgeschlagen.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

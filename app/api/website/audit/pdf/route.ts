import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { z } from "zod";
import type { WebsiteAuditResult } from "@/lib/website-audit";

export const runtime = "nodejs";

const schema = z.object({ audit: z.unknown() });

function isAudit(value: unknown): value is WebsiteAuditResult {
  if (!value || typeof value !== "object") return false;
  const audit = value as Partial<WebsiteAuditResult>;
  return Boolean(
    audit.version === 1 &&
    audit.company &&
    audit.finalUrl &&
    audit.scores &&
    Array.isArray(audit.findings) &&
    Array.isArray(audit.priorities) &&
    audit.sales,
  );
}

function safe(value: unknown) {
  return String(value ?? "")
    .replace(/[–—]/g, "-")
    .replace(/[“”„]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/→/g, "->")
    .replace(/•/g, "-")
    .replace(/…/g, "...");
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number) {
  const words = safe(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) line = candidate;
    else {
      if (line) lines.push(line);
      if (font.widthOfTextAtSize(word, size) <= maxWidth) line = word;
      else {
        let chunk = "";
        for (const char of word) {
          const next = chunk + char;
          if (font.widthOfTextAtSize(next, size) > maxWidth && chunk) {
            lines.push(chunk);
            chunk = char;
          } else chunk = next;
        }
        line = chunk;
      }
    }
  }
  if (line) lines.push(line);
  return lines;
}

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    if (!isAudit(input.audit)) return Response.json({ error: "Audit-Daten unvollständig." }, { status: 400 });
    const audit = input.audit;

    const pdf = await PDFDocument.create();
    const regular = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const width = 595.28;
    const height = 841.89;
    const margin = 42;
    const contentWidth = width - margin * 2;
    const ink = rgb(0.07, 0.09, 0.12);
    const muted = rgb(0.36, 0.41, 0.48);
    const green = rgb(0.13, 0.67, 0.43);
    const pale = rgb(0.94, 0.97, 0.95);
    const line = rgb(0.87, 0.89, 0.91);
    let page: PDFPage;
    let y = 0;

    const newPage = (title?: string) => {
      page = pdf.addPage([width, height]);
      y = height - margin;
      page.drawText("DIGITALE GEWINNER", { x: margin, y, size: 10, font: bold, color: green });
      page.drawText("WEBSITE RADAR", { x: width - margin - 98, y, size: 9, font: bold, color: muted });
      y -= 20;
      page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.7, color: line });
      y -= 24;
      if (title) {
        page.drawText(safe(title), { x: margin, y, size: 19, font: bold, color: ink });
        y -= 28;
      }
      return page;
    };

    const ensure = (needed = 70, title?: string) => {
      if (y - needed < margin) newPage(title);
    };

    const paragraph = (text: string, options?: { size?: number; color?: ReturnType<typeof rgb>; font?: PDFFont; gap?: number; indent?: number }) => {
      const size = options?.size ?? 10;
      const useFont = options?.font ?? regular;
      const color = options?.color ?? ink;
      const indent = options?.indent ?? 0;
      const lines = wrap(text, useFont, size, contentWidth - indent);
      for (const row of lines) {
        ensure(size + 10);
        page.drawText(row, { x: margin + indent, y, size, font: useFont, color });
        y -= size + 4;
      }
      y -= options?.gap ?? 8;
    };

    const section = (title: string) => {
      ensure(55);
      y -= 4;
      page.drawText(safe(title), { x: margin, y, size: 13, font: bold, color: ink });
      y -= 20;
    };

    const scoreBox = (label: string, value: number, x: number, boxWidth: number) => {
      page.drawRectangle({ x, y: y - 53, width: boxWidth, height: 53, color: pale, borderColor: line, borderWidth: 0.6 });
      page.drawText(String(value), { x: x + 12, y: y - 27, size: 20, font: bold, color: value >= 75 ? green : ink });
      page.drawText(label, { x: x + 12, y: y - 43, size: 7.8, font: bold, color: muted });
    };

    newPage();
    page.drawText("High-End Website Analyse", { x: margin, y, size: 27, font: bold, color: ink });
    y -= 34;
    paragraph(audit.company, { size: 16, font: bold, gap: 2 });
    paragraph(audit.finalUrl, { size: 9, color: muted, gap: 18 });

    const scoreWidth = (contentWidth - 16) / 3;
    scoreBox("GESAMT", audit.scores.overall, margin, scoreWidth);
    scoreBox("CONVERSION", audit.scores.conversion, margin + scoreWidth + 8, scoreWidth);
    scoreBox("TRUST", audit.scores.trust, margin + (scoreWidth + 8) * 2, scoreWidth);
    y -= 70;
    scoreBox("SEO", audit.scores.seo, margin, scoreWidth);
    scoreBox("TECHNIK", audit.scores.technical, margin + scoreWidth + 8, scoreWidth);
    scoreBox("CONTENT", audit.scores.content, margin + (scoreWidth + 8) * 2, scoreWidth);
    y -= 75;

    section("Executive Summary");
    paragraph(audit.sales.opportunitySummary, { size: 11, gap: 12 });
    paragraph(`Status ${audit.statusCode} | Antwort ${audit.responseMs} ms | ${audit.metrics.wordCount} Woerter | ${audit.metrics.ctaCount} CTAs | ${audit.metrics.formCount} Formulare`, { size: 8.5, color: muted, gap: 14 });

    section("Die 5 wichtigsten Hebel");
    if (!audit.priorities.length) paragraph("Keine kritischen Hebel erkannt. Fokus auf datenbasierte Tests und Feintuning.", { color: muted });
    for (const priority of audit.priorities.slice(0, 5)) {
      ensure(90);
      page.drawText(`${priority.rank}. ${safe(priority.title)}`, { x: margin, y, size: 11, font: bold, color: ink });
      y -= 17;
      paragraph(priority.why, { size: 9.2, color: muted, gap: 2, indent: 12 });
      paragraph(`Massnahme: ${priority.action}`, { size: 9.2, gap: 3, indent: 12 });
      paragraph(`Ziel: ${priority.expectedImpact}`, { size: 8.5, color: green, gap: 10, indent: 12 });
    }

    newPage("Detailanalyse");
    const categoryLabels: Record<string, string> = { SEO:"SEO",Conversion:"Conversion",Trust:"Vertrauen",Technical:"Technik",Content:"Content" };
    for (const finding of audit.findings) {
      ensure(95, "Detailanalyse");
      const severity = finding.severity === "critical" ? "KRITISCH" : finding.severity === "warning" ? "WICHTIG" : finding.severity === "strength" ? "STAERKE" : "CHANCE";
      page.drawText(`${severity} - ${categoryLabels[finding.category] || finding.category}`, { x: margin, y, size: 7.5, font: bold, color: finding.severity === "strength" ? green : muted });
      y -= 15;
      paragraph(finding.title, { size: 11, font: bold, gap: 2 });
      paragraph(finding.detail, { size: 9.2, color: muted, gap: 2 });
      paragraph(`Warum relevant: ${finding.impact}`, { size: 9.2, gap: 2 });
      paragraph(`Empfehlung: ${finding.recommendation}`, { size: 9.2, gap: 12 });
      page.drawLine({ start: { x: margin, y: y + 4 }, end: { x: width - margin, y: y + 4 }, thickness: 0.5, color: line });
    }

    newPage("Vertriebs-Nutzung");
    section("Cold-Call / Loom Opener");
    paragraph(audit.sales.opener, { size: 11, gap: 16 });
    section("E-Mail Hook");
    paragraph(audit.sales.emailHook, { size: 11, gap: 16 });
    section("Fake-Loom Talking Points");
    if (!audit.sales.loomTalkingPoints.length) paragraph("Website wirkt bereits solide. Nutze den Report fuer konkrete A/B-Test-Hypothesen.", { color: muted });
    audit.sales.loomTalkingPoints.forEach((point, index) => paragraph(`${index + 1}. ${point}`, { size: 10, gap: 8 }));

    section("Messwerte");
    const metricRows = [
      ["HTML", `${audit.metrics.htmlKb} KB`],
      ["Woerter", audit.metrics.wordCount],
      ["H1 / H2", `${audit.metrics.h1Count} / ${audit.metrics.h2Count}`],
      ["Bilder ohne Alt", `${audit.metrics.imagesMissingAlt}/${audit.metrics.imageCount}`],
      ["Interne / externe Links", `${audit.metrics.internalLinks} / ${audit.metrics.externalLinks}`],
      ["Kontaktwege", audit.metrics.contactMethods],
      ["Schema Bloecke", audit.metrics.schemaCount],
      ["robots.txt / sitemap", `${audit.metrics.hasRobotsTxt ? "ja" : "nein"} / ${audit.metrics.hasSitemap ? "ja" : "nein"}`],
    ];
    for (const [label, value] of metricRows) {
      ensure(26);
      page.drawText(safe(label), { x: margin, y, size: 9, font: bold, color: ink });
      page.drawText(safe(value), { x: margin + 180, y, size: 9, font: regular, color: muted });
      y -= 18;
    }

    const pages = pdf.getPages();
    pages.forEach((current, index) => {
      current.drawLine({ start:{x:margin,y:27}, end:{x:width-margin,y:27}, thickness:0.5, color:line });
      current.drawText(`Website Radar | ${safe(audit.company)}`, { x:margin, y:14, size:7, font:regular, color:muted });
      current.drawText(`Seite ${index + 1}/${pages.length}`, { x:width-margin-52, y:14, size:7, font:regular, color:muted });
    });

    pdf.setTitle(`Website Radar - ${safe(audit.company)}`);
    pdf.setAuthor("Digitale Gewinner");
    pdf.setSubject("Website Analyse fuer Outbound und Conversion");
    const bytes = await pdf.save();
    const fileName = safe(audit.company).replace(/[^a-zA-Z0-9äöüÄÖÜß_-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "website-audit";
    return new Response(Buffer.from(bytes), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${fileName}-website-radar.pdf"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "PDF konnte nicht erstellt werden." }, { status: 400 });
  }
}

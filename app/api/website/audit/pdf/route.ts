import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { z } from "zod";
import type { WebsiteAuditResult } from "@/lib/website-audit";
import { analyzePflegeRecruiting } from "@/lib/pflege-recruiting";

export const runtime = "nodejs";
const schema = z.object({ audit: z.unknown() });

function isAudit(value: unknown): value is WebsiteAuditResult {
  if (!value || typeof value !== "object") return false;
  const audit = value as Partial<WebsiteAuditResult>;
  return Boolean(audit.version === 1 && audit.company && audit.finalUrl && audit.scores && Array.isArray(audit.findings) && audit.sales);
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
      line = word;
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
    const recruiting = analyzePflegeRecruiting(audit);

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
    const rule = rgb(0.87, 0.89, 0.91);
    let page!: PDFPage;
    let y = 0;

    const newPage = (title?: string) => {
      page = pdf.addPage([width, height]);
      y = height - margin;
      page.drawText("PFLEGE RECRUITING OS", { x: margin, y, size: 10, font: bold, color: green });
      page.drawText("RECRUITING RADAR", { x: width - margin - 110, y, size: 9, font: bold, color: muted });
      y -= 20;
      page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.7, color: rule });
      y -= 24;
      if (title) {
        page.drawText(safe(title), { x: margin, y, size: 19, font: bold, color: ink });
        y -= 28;
      }
    };

    const ensure = (needed = 70) => {
      if (y - needed < margin) newPage("Fortsetzung");
    };

    const paragraph = (text: string, options?: { size?: number; color?: ReturnType<typeof rgb>; font?: PDFFont; gap?: number; indent?: number }) => {
      const size = options?.size ?? 10;
      const useFont = options?.font ?? regular;
      const color = options?.color ?? ink;
      const indent = options?.indent ?? 0;
      for (const row of wrap(text, useFont, size, contentWidth - indent)) {
        ensure(size + 10);
        page.drawText(row, { x: margin + indent, y, size, font: useFont, color });
        y -= size + 4;
      }
      y -= options?.gap ?? 8;
    };

    const section = (title: string) => {
      ensure(55);
      y -= 3;
      page.drawText(safe(title), { x: margin, y, size: 13, font: bold, color: ink });
      y -= 20;
    };

    const scoreBox = (label: string, value: number, x: number, boxWidth: number) => {
      page.drawRectangle({ x, y: y - 55, width: boxWidth, height: 55, color: pale, borderColor: rule, borderWidth: 0.6 });
      page.drawText(String(value), { x: x + 12, y: y - 28, size: 21, font: bold, color: value >= 70 ? green : ink });
      page.drawText(safe(label), { x: x + 12, y: y - 44, size: 7.4, font: bold, color: muted });
    };

    newPage();
    page.drawText("Pflege Recruiting Analyse", { x: margin, y, size: 27, font: bold, color: ink });
    y -= 35;
    paragraph(audit.company, { size: 16, font: bold, gap: 2 });
    paragraph(audit.finalUrl, { size: 9, color: muted, gap: 18 });

    const scoreWidth = (contentWidth - 16) / 3;
    scoreBox("RECRUITING OPPORTUNITY", recruiting.opportunityScore, margin, scoreWidth);
    scoreBox("RECRUITING-REIFE", recruiting.maturityScore, margin + scoreWidth + 8, scoreWidth);
    scoreBox("WEBSITE", audit.scores.overall, margin + (scoreWidth + 8) * 2, scoreWidth);
    y -= 75;

    section("Executive Recruiting Summary");
    paragraph(recruiting.emailHook, { size: 11, gap: 9 });
    paragraph(`Einordnung: ${recruiting.level}. Empfohlener Ansatz: ${recruiting.recommendedOffer}`, { size: 10, color: green, gap: 15 });

    section("Sichtbare Recruiting-Hebel");
    if (!recruiting.gaps.length) paragraph("Die digitale Recruiting-Basis wirkt solide. Der nächste Hebel liegt in Conversion, Reichweite und datenbasierten Tests.", { color: muted });
    recruiting.gaps.slice(0, 6).forEach((gap, index) => {
      ensure(48);
      page.drawText(`${index + 1}.`, { x: margin, y, size: 10, font: bold, color: green });
      paragraph(gap, { size: 10, indent: 22, gap: 8 });
    });

    section("Empfohlenes Angebot");
    paragraph(recruiting.recommendedOffer, { size: 12, font: bold, gap: 15 });

    section("Website Basis");
    paragraph(`Gesamt ${audit.scores.overall}/100 | Conversion ${audit.scores.conversion}/100 | Vertrauen ${audit.scores.trust}/100 | SEO ${audit.scores.seo}/100 | Technik ${audit.scores.technical}/100`, { size: 9.5, color: muted, gap: 12 });
    paragraph(audit.sales.opportunitySummary, { size: 10, gap: 14 });

    newPage("Detailanalyse");
    const relevantFindings = audit.findings.filter((finding) => finding.severity !== "strength").slice(0, 10);
    for (const finding of relevantFindings) {
      ensure(92);
      const severity = finding.severity === "critical" ? "KRITISCH" : finding.severity === "warning" ? "WICHTIG" : "CHANCE";
      page.drawText(`${severity} - ${safe(finding.category)}`, { x: margin, y, size: 7.5, font: bold, color: muted });
      y -= 15;
      paragraph(finding.title, { size: 11, font: bold, gap: 2 });
      paragraph(finding.detail, { size: 9.2, color: muted, gap: 2 });
      paragraph(`Empfehlung: ${finding.recommendation}`, { size: 9.2, gap: 11 });
      page.drawLine({ start: { x: margin, y: y + 4 }, end: { x: width - margin, y: y + 4 }, thickness: 0.5, color: rule });
    }

    newPage("Outbound-Nutzung");
    section("Gesprächsaufhänger");
    recruiting.talkingPoints.slice(0, 5).forEach((point, index) => paragraph(`${index + 1}. ${point}`, { size: 10, gap: 8 }));
    if (!recruiting.talkingPoints.length) paragraph(audit.sales.opener, { size: 10, gap: 14 });

    section("E-Mail Hook");
    paragraph(recruiting.emailHook, { size: 11, gap: 15 });

    section("Hinweis zur Einordnung");
    paragraph("Die Analyse basiert ausschließlich auf öffentlich sichtbaren Informationen der analysierten Website. Ein hoher Opportunity Score beschreibt sichtbares Optimierungspotenzial und ist keine Garantie für Bewerberzahlen, Einstellungen oder wirtschaftliche Ergebnisse.", { size: 9.5, color: muted });

    const pages = pdf.getPages();
    pages.forEach((current, index) => {
      current.drawLine({ start:{x:margin,y:27}, end:{x:width-margin,y:27}, thickness:0.5, color:rule });
      current.drawText(`Pflege Recruiting Radar | ${safe(audit.company)}`, { x:margin, y:14, size:7, font:regular, color:muted });
      current.drawText(`Seite ${index + 1}/${pages.length}`, { x:width-margin-52, y:14, size:7, font:regular, color:muted });
    });

    pdf.setTitle(`Pflege Recruiting Radar - ${safe(audit.company)}`);
    pdf.setAuthor("Pflege Recruiting OS");
    pdf.setSubject("Recruiting- und Website-Analyse fuer Pflegeanbieter");
    const bytes = await pdf.save();
    const fileName = safe(audit.company).replace(/[^a-zA-Z0-9äöüÄÖÜß_-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "pflege-recruiting";
    return new Response(Buffer.from(bytes), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${fileName}-pflege-recruiting-radar.pdf"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "PDF konnte nicht erstellt werden." }, { status: 400 });
  }
}

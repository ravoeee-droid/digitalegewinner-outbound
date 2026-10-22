// PDF der Wettbewerbsanalyse (pdf-lib, A4). Aufbau: Titel mit Kennzahlen, größte Chancen, Vergleich im Umkreis, Ihr Betrieb, Wettbewerber, Hinweis zur Datenbasis.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { Analysis, Business } from "@/lib/competitor-analysis";

const safe = (value: unknown) => String(value ?? "").replace(/[–—]/g, "-").replace(/[“”„]/g, '"').replace(/[‘’]/g, "'").replace(/→/g, "->").replace(/•/g, "-").replace(/…/g, "...").replace(/[★☆]/g, "*").replace(/[^\x20-\x7EÄÖÜäöüß€°·\n]/g, "");

function wrap(text: string, font: PDFFont, size: number, maxWidth: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of safe(text).split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) line = next; else { if (line) lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

export async function analysisPdf(analysis: Analysis) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const width = 595.28, height = 841.89, margin = 44, contentWidth = width - margin * 2;
  const ink = rgb(0.1, 0.09, 0.08), muted = rgb(0.4, 0.37, 0.34), orange = rgb(0.91, 0.47, 0.1), pale = rgb(0.98, 0.95, 0.91), line = rgb(0.89, 0.86, 0.82), good = rgb(0.13, 0.55, 0.3), bad = rgb(0.75, 0.22, 0.17);
  let page!: PDFPage;
  let y = 0;
  const label = analysis.segment === "pflege" ? "Pflege" : "Photovoltaik";

  const newPage = () => {
    page = pdf.addPage([width, height]);
    y = height - margin;
    page.drawText("DIGITALE GEWINNER", { x: margin, y, size: 10, font: bold, color: orange });
    page.drawText(safe(`Wettbewerbsanalyse ${analysis.own.name}`).slice(0, 52), { x: width - margin - 220, y, size: 8.5, font: regular, color: muted });
    y -= 14;
    page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.7, color: line });
    y -= 26;
  };
  const ensure = (needed: number) => { if (y - needed < margin + 20) newPage(); };
  const text = (value: string, opts: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; indent?: number; gap?: number } = {}) => {
    const size = opts.size ?? 10.5, font = opts.font ?? regular, indent = opts.indent ?? 0;
    for (const row of wrap(value, font, size, contentWidth - indent)) { ensure(size + 8); page.drawText(row, { x: margin + indent, y, size, font, color: opts.color ?? ink }); y -= size + 4.5; }
    y -= opts.gap ?? 6;
  };
  const bullet = (value: string, color = ink) => {
    const lines = wrap(value, regular, 10, contentWidth - 16);
    ensure(lines.length * 14 + 4);
    page.drawCircle({ x: margin + 4, y: y + 3.5, size: 1.8, color });
    for (const row of lines) { page.drawText(row, { x: margin + 14, y, size: 10, font: regular, color: ink }); y -= 14; }
    y -= 2;
  };
  const heading = (value: string) => { ensure(60); y -= 6; page.drawText(safe(value), { x: margin, y, size: 14, font: bold, color: ink }); y -= 22; };

  newPage();
  page.drawText("Ihre persönliche", { x: margin, y, size: 14, font: regular, color: muted }); y -= 26;
  page.drawText("Wettbewerbsanalyse", { x: margin, y, size: 30, font: bold, color: ink }); y -= 30;
  text(`${analysis.own.name}${analysis.own.city ? `, ${analysis.own.city}` : ""}`, { size: 15, font: bold, gap: 2 });
  text(`${label} | Stand ${new Date(analysis.generatedAt).toLocaleDateString("de-DE")} | ${analysis.coverageNote}`, { size: 9.5, color: muted, gap: 14 });

  // Kennzahlen: eigener Betrieb gegen Durchschnitt der Betriebe im Umkreis
  const avg = (pick: (b: Business) => number | undefined) => {
    const values = analysis.competitors.map(pick).filter((v): v is number => typeof v === "number");
    return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
  };
  const boxes: Array<[string, number | null, number | null]> = [
    ["Website gesamt", analysis.own.scores?.overall ?? null, avg((b) => b.scores?.overall)],
    ["Anfrage-/Bewerbungsweg", analysis.own.scores?.conversion ?? null, avg((b) => b.scores?.conversion)],
    ["Vertrauen", analysis.own.scores?.trust ?? null, avg((b) => b.scores?.trust)],
  ];
  const boxWidth = (contentWidth - 16) / 3;
  boxes.forEach(([name, own, other], index) => {
    const x = margin + index * (boxWidth + 8);
    page.drawRectangle({ x, y: y - 62, width: boxWidth, height: 62, color: pale, borderColor: line, borderWidth: 0.6 });
    page.drawText(own === null ? "-" : String(own), { x: x + 12, y: y - 30, size: 24, font: bold, color: orange });
    page.drawText(safe(name), { x: x + 12, y: y - 46, size: 8.5, font: bold, color: muted });
    page.drawText(safe(other === null ? "kein Vergleich" : `Umkreis: ${other}`), { x: x + 12, y: y - 57, size: 8, font: regular, color: muted });
  });
  y -= 84;

  heading("Ihre größten Chancen");
  if (!analysis.opportunities.length) text("Mit den verfügbaren Daten ließen sich keine klaren Lücken im Umkreis belegen. Im Gespräch schauen wir tiefer.", { color: muted });
  analysis.opportunities.forEach((item, index) => {
    ensure(60);
    text(`${index + 1}. ${item.title}`, { font: bold, size: 11.5, gap: 1 });
    text(item.text, { indent: 14, gap: 8 });
  });

  heading("Vergleich im Umkreis");
  const columns = [{ t: "Betrieb", w: 150 }, { t: "Entf.", w: 40 }, { t: "Google", w: 62 }, { t: "Gesamt", w: 44 }, { t: "Anfrage", w: 44 }, { t: "Vertrauen", w: 50 }, { t: analysis.segment === "pflege" ? "Karriere" : "WhatsApp", w: 60 }];
  const row = (cells: string[], boldRow = false, shade = false) => {
    ensure(22);
    if (shade) page.drawRectangle({ x: margin, y: y - 6, width: contentWidth, height: 20, color: pale });
    let x = margin + 4;
    cells.forEach((cell, index) => { page.drawText(safe(cell).slice(0, index === 0 ? 30 : 14), { x, y, size: 8.8, font: boldRow || index === 0 ? bold : regular, color: ink }); x += columns[index].w; });
    y -= 20;
  };
  row(columns.map((c) => c.t), true, true);
  const tableRow = (b: Business, isOwn = false) => row([
    isOwn ? `${b.name} (Sie)` : b.name,
    b.distanceKm === null ? "-" : isOwn ? "-" : `${Math.round(b.distanceKm)} km`,
    b.rating ? `${b.rating.toFixed(1).replace(".", ",")} (${b.reviews})` : "-",
    b.scores ? String(b.scores.overall) : "-",
    b.scores ? String(b.scores.conversion) : "-",
    b.scores ? String(b.scores.trust) : "-",
    analysis.segment === "pflege" ? (b.hasCareer === null ? "-" : b.hasCareer ? "ja" : "nein") : (b.audit ? (b.audit.metrics.hasWhatsapp ? "ja" : "nein") : "-"),
  ], isOwn);
  tableRow(analysis.own, true);
  analysis.competitors.forEach((b) => tableRow(b));
  y -= 4;
  text("Scores von 0 bis 100: automatische Auswertung der öffentlich sichtbaren Website. Google: Durchschnitt der Sterne (Anzahl Bewertungen), sofern vorliegend.", { size: 8.5, color: muted, gap: 10 });

  heading("Ihr Betrieb: Stärken und Schwächen");
  analysis.own.strengths.forEach((s) => bullet(s, good));
  if (!analysis.own.strengths.length) text("Keine klaren Stärken belegbar.", { color: muted });
  y -= 4;
  analysis.own.weaknesses.forEach((w) => bullet(w, bad));
  if (!analysis.own.weaknesses.length) text("Keine klaren Schwächen erkannt.", { color: muted });

  heading("Betriebe im Umkreis: Was uns auffällt");
  analysis.competitors.forEach((b) => {
    ensure(70);
    text(`${b.name}${b.city ? `, ${b.city}` : ""}${b.distanceKm !== null ? ` (ca. ${Math.round(b.distanceKm)} km)` : ""}`, { font: bold, size: 11, gap: 3 });
    b.strengths.slice(0, 2).forEach((s) => bullet(s, good));
    b.weaknesses.slice(0, 2).forEach((w) => bullet(w, bad));
    if (!b.strengths.length && !b.weaknesses.length) text("Keine auffälligen Merkmale.", { color: muted });
    y -= 6;
  });

  heading("So geht es weiter");
  text("Im Gespräch gehen wir diese Punkte mit Ihnen durch und prüfen, welche Chancen sich für Ihren Betrieb wirtschaftlich lohnen. Das ist kostenlos und unverbindlich.", { gap: 10 });
  text("Datenbasis: automatische Auswertung öffentlich sichtbarer Angaben (Websites, Google-Bewertungen) zum Zeitpunkt der Erstellung. Sie bewertet nicht die tatsächliche Qualität der genannten Betriebe, kann Fehler enthalten und ist keine Ergebnisgarantie.", { size: 8.5, color: muted });

  return Buffer.from(await pdf.save());
}

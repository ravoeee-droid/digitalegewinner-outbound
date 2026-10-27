import type { Metadata } from "next";
import { notFound } from "next/navigation";
import VideoPlayer from "./VideoBubble";
import PageTracker from "./PageTracker";
import ChatWidget from "./ChatWidget";
import { WHATSAPP_NUMBER } from "@/lib/video-chat";
import { VIDEO_IDS } from "@/lib/outreach-copy";
import { query } from "@/lib/db";
import { verifyVideoToken } from "@/lib/email-tracking";
import { hasScreenshot } from "@/lib/lead-screenshot";
import { leadSegmentSql, type LeadSegment } from "@/lib/lead-segment";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Ihr persönliches Video · Digitale Gewinner",
  robots: { index: false, follow: false },
};

const SCHEDULE_ID = "AcZssZ2_bTTYywdIxhuhqlmFqNuKS0li41T2CphSGixgYtdPNeN_60JmG5nXyzjD8im24mG8hK0BZB8Q";
const CALENDAR_URL = `https://calendar.google.com/appointments/schedules/${SCHEDULE_ID}?gv=true&hl=de`;

// Vorerst nur die Beispielseite; später kommen Firma, Screenshot und Video pro Lead aus der Datenbank.
const DEMO = { company: "Ihr Betrieb", screenshot: "/v-demo.jpg", youtubeId: "iYU1SEsBusI" };

// Was der Besucher aus dem Termin mitnimmt, auch ohne Zusammenarbeit (Versprechen, die im Gespräch eingelöst werden müssen).
const TAKEAWAYS = {
  pflege: [
    "Eine ehrliche Einschätzung, warum bei Ihnen zu wenige passende Bewerber ankommen.",
    "Welcher Weg zu Fachkräften wirtschaftlich passt (Vermittlung, Ausland, Portale, eigene Kampagnen) und ob eine Förderung infrage kommt.",
    "Zwei bis drei Sofortmaßnahmen, die Sie selbst umsetzen können.",
  ],
  other: [
    "Eine unverbindliche Einschätzung Ihres aktuellen Online-Auftritts.",
    "Konkrete Verbesserungsmöglichkeiten für Ihr Unternehmen.",
    "Die nächsten sinnvollen Schritte für Ihre digitale Sichtbarkeit.",
  ],
  pv: [
    "Eine ehrliche Einschätzung, was Leadportale Sie aktuell an Marge und Aufträgen kosten.",
    "Welcher Weg zu Kunden wirtschaftlich passt (Empfehlungen, Portale, Agenturen, eigene exklusive Anfragen) und ob eine Förderung infrage kommt.",
    "Zwei bis drei Sofortmaßnahmen, die Sie selbst umsetzen können.",
  ],
};

// Fallstudien wie auf digitalegewinner.de/pflege (Zahlen und Quellenangabe von dort übernommen).
const CASES = [
  { name: "Pflegeeinrichtung", big: "3 Einstellungen", line: "2.000 € Werbebudget · 43 Bewerbungen · Ø 46 € pro Bewerbung" },
  { name: "Pflegeresidenz Rose", big: "3 Pflegefachkräfte", line: "in 8 Wochen · 22 Bewerbungen · 10 Gespräche" },
  { name: "Maternus", big: "11 neue Mitarbeiter", line: "in 4 Monaten · 110 Bewerbungen" },
  { name: "Häusliche Krankenpflege Raik Radloff", big: "2 neue Fachkräfte", line: "in unter 4 Wochen · 11 Gespräche" },
];

// Von Raphael bestätigte Ergebnisse aus zwei PV-Trust-Kundenprojekten.
const PV_CASES = [
  {
    name: "Solavol · PV-Trust-Kunde",
    big: "Ø 43 €",
    line: "Kosten pro exklusiver Kundenanfrage im Projekt",
  },
  {
    name: "Libi Elektronik · PV-Trust-Kunde",
    big: "Ø 58 €",
    line: "Kosten pro exklusiver Kundenanfrage im PV-Trust-Projekt",
  },
];

export default async function VideoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = decodeURIComponent(id);
  let data = DEMO;
  let segment: LeadSegment = "other";
  if (token !== "demo") {
    const leadId = verifyVideoToken(token);
    if (!leadId) notFound();
    const [row] = await query<{ company: string; segment: LeadSegment }>(
      `select c.name company, ${leadSegmentSql("c")} segment from sales_leads l join sales_companies c on c.id=l.company_id and c.workspace=l.workspace where l.id::text=$1 limit 1`,
      [leadId],
    ).catch(() => []);
    if (!row) notFound();
    segment = row.segment;
    data = { ...DEMO, company: row.company, screenshot: (await hasScreenshot(leadId)) ? `/api/t/shot/${encodeURIComponent(token)}` : "" };
  }
  return (
    <main className={styles.page}>
      <PageTracker token={token} />
      <ChatWidget token={token} company={data.company} whatsapp={WHATSAPP_NUMBER} />
      <header className={styles.head}>
        <div className={styles.author}>
          <span className={styles.avatar} aria-hidden="true">RH</span>
          <div>
            <h1>Eine kurze Nachricht für {data.company}</h1>
            <p>Raphael Hermann · Digitale Gewinner</p>
          </div>
        </div>
        <a href="#termin" className={styles.headButton}>Termin buchen</a>
      </header>
      <div className={styles.grid}>
        <section className={styles.videoCol} aria-label="Video">
          {(segment !== "other" && Boolean(VIDEO_IDS[segment])) || token === "demo" ? <VideoPlayer youtubeId={token === "demo" ? (VIDEO_IDS.pflege || data.youtubeId) : (segment === "pv" ? VIDEO_IDS.pv : VIDEO_IDS.pflege)} screenshot={data.screenshot} company={data.company} /> : (
            <div className={styles.staticShot} style={data.screenshot ? { backgroundImage: `url(${data.screenshot})` } : undefined} role="img" aria-label={`Website von ${data.company}`} />
          )}
          <div className={styles.takeaway}>
            <h2>15 Minuten, die sich auch ohne Zusammenarbeit lohnen</h2>
            <p className={styles.bonus}><strong>Bonus nach Ihrer Buchung:</strong> Sie erhalten vorab Ihre persönliche Wettbewerbsanalyse als PDF: welche Betriebe in Ihrem Umkreis wie aufgestellt sind, was sie gut machen und wo Ihre größten Chancen liegen.</p>
            <ul>{TAKEAWAYS[segment].map((item) => <li key={item}>{item}</li>)}</ul>
            <p className={styles.takeNote}>Kostenlos und unverbindlich. Wählen Sie rechts direkt einen Termin.</p>
          </div>
        </section>
        <section id="termin" className={styles.calendar} aria-label="Termin buchen">
          <h2>Termin direkt buchen</h2>
          <p className={styles.calBonus}>Inklusive: Ihre persönliche Wettbewerbsanalyse (PDF)</p>
          <iframe src={CALENDAR_URL} title="Terminbuchung bei Raphael Hermann" loading="lazy" />
        </section>
      </div>
      {(segment === "pflege" || segment === "pv") && (
        <section className={styles.funding} aria-label="Förderchance Unternehmensberatung 2026">
          <div className={styles.fundingTopline}>FÖRDERCHANCE · ANTRAGSFRIST 31.12.2026</div>
          <h2>50–80 % Zuschuss für förderfähige Unternehmensberatung – nur noch 2026 beantragen</h2>
          <p>
            Für kleine und mittlere Unternehmen sind je nach Betriebsstätte 50 % oder 80 % Zuschuss
            auf förderfähige Beratungskosten möglich – maximal 1.750 € bzw. 2.800 € pro Beratung.
            Ob Ihr Betrieb die Voraussetzungen erfüllt, klären wir gerne im persönlichen Gespräch.
          </p>
          <div className={styles.fundingBottom}>
            <a className={styles.fundingButton} href="#termin">Fördermöglichkeiten kostenlos prüfen</a>
            <span>
              Wichtig: Diese BAFA-Förderung betrifft ausschließlich förderfähige, eigenständige
              Unternehmensberatung – nicht pauschal die Umsetzung unseres Systems, Website-Bau,
              Werbung oder Anzeigenbudget. Förderfähigkeit, Beratereignung und Antragstellung
              vor Beratungsbeginn sind Voraussetzung; ein Zuschuss ist nicht garantiert.
              {" "}<a href="https://www.bafa.de/SharedDocs/Downloads/DE/Wirtschaft/unb_flyer.pdf?__blob=publicationFile&v=2" target="_blank" rel="noopener noreferrer">BAFA-Förderinformationen</a>
            </span>
          </div>
        </section>
      )}
      {segment === "pflege" && (
      <section className={styles.proof} aria-label="Fallstudien aus der Pflege">
        <h2>Echte Pflegebetriebe. Echte Ergebnisse.</h2>
        <ul>
          {CASES.map((item) => (
            <li key={item.name} className={styles.caseCard}>
              <span className={styles.caseName}>{item.name}</span>
              <strong>{item.big}</strong>
              <span>{item.line}</span>
            </li>
          ))}
        </ul>
        <blockquote className={styles.quote}>
          „Für uns als Pflegebetrieb ist es ein neues Gefühl, auch mal wieder selektieren zu dürfen! Das hatten wir die letzten 7 Jahre nicht mehr.“
          <cite>Raik Radloff, Häusliche Krankenpflege</cite>
        </blockquote>
        <p className={styles.source}>Einzelergebnisse, keine Garantie.</p>
      </section>
      )}
      {segment === "pv" && (
        <section className={styles.proof} aria-label="Ergebnisse aus der Anfragegewinnung">
          <h2>Exklusive Anfragen. Messbare Ergebnisse.</h2>
          <p>Ergebnisse aus zwei PV-Trust-Kundenprojekten: exklusiv für den jeweiligen Auftraggeber generierte Anfragen.</p>
          <ul>
            {PV_CASES.map((item) => (
              <li key={item.name} className={styles.caseCard}>
                <span className={styles.caseName}>{item.name}</span>
                <strong>{item.big}</strong>
                <span>{item.line}</span>
              </li>
            ))}
          </ul>
          <div className={styles.pvTransformation} aria-label="Vorher und nachher mit einem eigenen Anfragekanal">
            <div className={styles.pvBefore}>
              <span className={styles.pvTransformLabel}>VORHER</span>
              <h3>Abhängig von Leadportalen und Empfehlungen.</h3>
              <p>Schwankende Auftragslage, unberechenbare Umsätze und das ständige Hoffen auf die nächste Empfehlung. Oder teure Anfragen kaufen – und wieder in den Preiskampf geraten.</p>
            </div>
            <div className={styles.pvAfter}>
              <span className={styles.pvTransformLabel}>MIT PV-TRUST</span>
              <h3>Eigene, exklusive Kundenanfragen. Mehr Kontrolle.</h3>
              <p>Ein strukturierter Vertriebsprozess, weniger manuelle Nacharbeit und ein eigener Anfragekanal, der Ihre Marke stärkt – statt die eines Leadportals.</p>
            </div>
          </div>
          <p className={styles.pvTransformationFootnote}>Das Ziel: weg vom Vertriebschaos, hin zu besser planbarer Kundengewinnung und mehr Potenzial für profitables Wachstum.</p>
          <p className={styles.source}>Kundenbeispiele mit den angegebenen durchschnittlichen Leadkosten im jeweiligen Projekt, keine Preis- oder Ergebnisgarantie. Aufwand und Profitabilität hängen vom einzelnen Betrieb und seinen Abschlüssen ab.</p>
        </section>
      )}
      <footer className={styles.legal}>
        <span>Digitale Gewinner · Raphael Hermann</span>
        <a href="https://digitalegewinner.de/impressum.html" target="_blank" rel="noopener noreferrer">Impressum</a>
        <a href="https://digitalegewinner.de/datenschutz.html" target="_blank" rel="noopener noreferrer">Datenschutz</a>
        <span>Wir messen, ob und wie lange diese Seite und das Video angesehen werden (ohne Cookies). Details in der Datenschutzerklärung.</span>
      </footer>
    </main>
  );
}

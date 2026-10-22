import type { Metadata } from "next";
import { notFound } from "next/navigation";
import VideoPlayer from "./VideoBubble";
import PageTracker from "./PageTracker";
import { query } from "@/lib/db";
import { verifyVideoToken } from "@/lib/email-tracking";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Ihr persönliches Video · Digitale Gewinner",
  robots: { index: false, follow: false },
};

const SCHEDULE_ID = "AcZssZ2_bTTYywdIxhuhqlmFqNuKS0li41T2CphSGixgYtdPNeN_60JmG5nXyzjD8im24mG8hK0BZB8Q";
const CALENDAR_URL = `https://calendar.google.com/appointments/schedules/${SCHEDULE_ID}?gv=true&hl=de`;

// Vorerst nur die Beispielseite; später kommen Firma, Screenshot und Video pro Lead aus der Datenbank.
const DEMO = { company: "Ihr Betrieb", screenshot: "/v-demo.jpg", youtubeId: "iYU1SEsBusI" };

// Fallstudien wie auf digitalegewinner.de/pflege (Zahlen und Quellenangabe von dort übernommen).
const CASES = [
  { name: "Pflegeeinrichtung", big: "3 Einstellungen", line: "2.000 € Werbebudget · 43 Bewerbungen · Ø 46 € pro Bewerbung" },
  { name: "Pflegeresidenz Rose", big: "3 Pflegefachkräfte", line: "in 8 Wochen · 22 Bewerbungen · 10 Gespräche" },
  { name: "Maternus", big: "11 neue Mitarbeiter", line: "in 4 Monaten · 110 Bewerbungen" },
  { name: "Häusliche Krankenpflege Raik Radloff", big: "2 neue Fachkräfte", line: "in unter 4 Wochen · 11 Gespräche" },
];

export default async function VideoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = decodeURIComponent(id);
  let data = DEMO;
  if (token !== "demo") {
    const leadId = verifyVideoToken(token);
    if (!leadId) notFound();
    const [row] = await query<{ company: string }>(
      "select c.name company from sales_leads l join sales_companies c on c.id=l.company_id and c.workspace=l.workspace where l.id::text=$1 limit 1",
      [leadId],
    ).catch(() => []);
    if (!row) notFound();
    data = { ...DEMO, company: row.company };
  }
  return (
    <main className={styles.page}>
      <PageTracker token={token} />
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
          <VideoPlayer youtubeId={data.youtubeId} screenshot={data.screenshot} company={data.company} />
          <p className={styles.note}>Gefällt Ihnen, was Sie sehen? Wählen Sie rechts direkt einen passenden Termin für ein kurzes, unverbindliches Gespräch.</p>
        </section>
        <section id="termin" className={styles.calendar} aria-label="Termin buchen">
          <h2>Termin direkt buchen</h2>
          <iframe src={CALENDAR_URL} title="Terminbuchung bei Raphael Hermann" loading="lazy" />
        </section>
      </div>
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
        <p className={styles.source}>Kampagnen, die Raphael Hermann bei Fachkraftmarketing verantwortet hat; Veröffentlichung mit schriftlicher Freigabe. Einzelergebnisse und keine Garantie. Bewerbungen und Einstellungen hängen auch von Region, Angebot und Ihrer Reaktionsgeschwindigkeit ab. Das Werbebudget ist nicht Teil unseres Honorars. <a href="https://digitalegewinner.de/pflege#fallstudien">Alle Fallstudien ansehen</a></p>
      </section>
    </main>
  );
}

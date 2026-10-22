import type { Metadata } from "next";
import VideoPlayer from "./VideoBubble";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Ihr persönliches Video · Digitale Gewinner",
  robots: { index: false, follow: false },
};

const SCHEDULE_ID = "AcZssZ2_bTTYywdIxhuhqlmFqNuKS0li41T2CphSGixgYtdPNeN_60JmG5nXyzjD8im24mG8hK0BZB8Q";
const CALENDAR_URL = `https://calendar.google.com/appointments/schedules/${SCHEDULE_ID}?gv=true&hl=de`;

// Vorerst nur die Beispielseite; später kommen Firma, Screenshot und Video pro Lead aus der Datenbank.
const DEMO = { company: "Ihr Betrieb", screenshot: "/v-demo.jpg", youtubeId: "iYU1SEsBusI" };

const PROOF = [
  { src: "/proof/ergebnis-5.jpg", alt: "Conversion-Funnel im Werbeanzeigenmanager: Leads, qualifizierte Bewerber und gebuchte Calls", caption: "Funnel: von Anzeigen-Klicks zu gebuchten Calls" },
  { src: "/proof/ergebnis-6.jpg", alt: "Kampagnenübersicht mit Leads und Kosten pro Lead", caption: "Kampagnen mit Leads und Kosten pro Lead" },
  { src: "/proof/ergebnis-4.jpg", alt: "Einzelne Anzeigen mit Ergebnissen", caption: "Anzeigen im Vergleich" },
];

export default async function VideoPage({ params }: { params: Promise<{ id: string }> }) {
  await params;
  const data = DEMO;
  return (
    <main className={styles.page}>
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
      <section className={styles.proof} aria-label="Ergebnisse aus Kundenkampagnen">
        <h2>Ergebnisse aus Recruiting-Kampagnen</h2>
        <p>Auszüge aus dem Werbeanzeigenmanager von Kundenkampagnen für Steuerkanzleien in Baden-Württemberg. Kundennamen und Kontodaten sind aus Datenschutzgründen geschwärzt. Ergebnisse hängen vom Einzelfall ab.</p>
        <ul>
          {PROOF.map((item) => (
            <li key={item.src}>
              <a href={item.src} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.src} alt={item.alt} loading="lazy" />
              </a>
              <span>{item.caption}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

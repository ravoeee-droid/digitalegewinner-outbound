import type { Metadata } from "next";
import VideoBubble from "./VideoBubble";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Ihr persönliches Video · Digitale Gewinner",
  robots: { index: false, follow: false },
};

const BOOKING_URL = "https://calendar.app.google/63jjwjMz48c9dAWb7";

// Vorerst nur die Beispielseite; später kommen Firma, Screenshot und Video pro Lead aus der Datenbank.
const DEMO = { company: "Ihr Betrieb", screenshot: "/v-demo.jpg", youtubeId: "iYU1SEsBusI" };

export default async function VideoPage({ params }: { params: Promise<{ id: string }> }) {
  await params;
  const data = DEMO;
  return (
    <main className={styles.stage} style={{ backgroundImage: `url(${data.screenshot})` }}>
      <header className={styles.top}>
        <span className={styles.chip}>Für {data.company}</span>
      </header>
      <aside className={styles.cta}>
        <strong>Kurzes Gespräch zu Ihrer Website?</strong>
        <span>20 Minuten per Videocall, kostenlos und unverbindlich.</span>
        <a href={BOOKING_URL} className={styles.button}>Termin buchen</a>
      </aside>
      <VideoBubble youtubeId={data.youtubeId} />
    </main>
  );
}

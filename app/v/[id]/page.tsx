import type { Metadata } from "next";
import { createHash } from "node:crypto";
import { notFound } from "next/navigation";
import VideoPlayer from "./VideoBubble";
import PageTracker from "./PageTracker";
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
const DEMO = { company: "Ihren Betrieb", screenshot: "/v-demo.jpg", youtubeId: "iYU1SEsBusI" };

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

export default async function VideoPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ segment?: string }> }) {
  const { id } = await params;
  const token = decodeURIComponent(id);
  let data = DEMO;
  let segment: LeadSegment = "other";
  let leadId = "";
  if (token === "demo") {
    const requested = (await searchParams).segment;
    if (requested === "pflege" || requested === "pv") segment = requested;
  }
  if (token !== "demo") {
    leadId = verifyVideoToken(token);
    if (!leadId) notFound();
    const [row] = await query<{ company: string; segment: LeadSegment }>(
      `select c.name company, ${leadSegmentSql("c")} segment from sales_leads l join sales_companies c on c.id=l.company_id and c.workspace=l.workspace where l.id::text=$1 limit 1`,
      [leadId],
    ).catch(() => []);
    if (!row) notFound();
    segment = row.segment;
    data = { ...DEMO, company: row.company, screenshot: (await hasScreenshot(leadId)) ? `/api/t/shot/${encodeURIComponent(token)}` : "" };
  }

  const isPv=segment==="pv";
  const hasVertical=segment==="pflege"||segment==="pv";
  const proofItems=isPv?PV_CASES:[CASES[2],CASES[3]];
  // A/B cohorts are assigned by signed lead ID. Disabled until both short clips are ready
  // and LOOM_AB_TEST_ACTIVE=on is set explicitly (no automatic roll-over).
  const shortVideoId = isPv ? process.env.VIDEO_ID_PV_SHORT : process.env.VIDEO_ID_PFLEGE_SHORT;
  const testIsOn = process.env.LOOM_AB_TEST_ACTIVE === "on" && hasVertical && Boolean(shortVideoId);
  const group: "A" | "B" = testIsOn && leadId && (createHash("sha256").update("loom-v1:"+leadId).digest()[0] & 1) === 1 ? "B" : "A";
  const mainVideoId = isPv ? VIDEO_IDS.pv : VIDEO_IDS.pflege;
  const videoId = group === "B" ? String(shortVideoId) : mainVideoId;
  // The demo remains pinned to the current A version.
  // Independent explanation video, never the personalized talking-head clip.
  // PV asset is published on the main website. Pflege asset may be configured separately
  // once its real hosting URL is verified; do not substitute the personal video.
  const explainerVideoUrl = isPv
    ? "https://www.youtube.com/embed/h7e0izR5fn0?rel=0&playsinline=1"
    : "https://www.youtube.com/embed/S1Yc5U5_0YY?rel=0&playsinline=1";
  const explainerPosterUrl = isPv
    ? "https://i.ytimg.com/vi/h7e0izR5fn0/hqdefault.jpg"
    : "https://i.ytimg.com/vi/S1Yc5U5_0YY/hqdefault.jpg";
  const whatsappUrl = "https://wa.me/" + WHATSAPP_NUMBER + "?text=" + encodeURIComponent("Hallo Raphael, ich habe Ihr Video gesehen (" + data.company + ").");
  return (
    <main className={styles.page}>
      <PageTracker token={token} variant={group}/>
      <div className={styles.wrap}>
        <header className={styles.header}>
          <a href="#start" className={styles.brand} aria-label="Digitale Gewinner">
            <span className={styles.brandIcon}>DG<span>.</span></span>
            <span className={styles.brandWord}>DIGITALE GEWINNER</span>
          </a>
          <a className={styles.headerLink} href="#termin">15-Minuten-Gespräch <span aria-hidden="true">↗</span></a>
        </header>

        <section id="start" className={styles.hero} aria-labelledby="personal-title">
          <p className={styles.kicker}><span aria-hidden="true" className={styles.dot}/> PERSÖNLICHE VIDEONACHRICHT</p>
          <h1 id="personal-title">Für <span>{data.company}</span></h1>
          <p className={styles.heroSub}>Eine kurze Nachricht von Raphael Hermann – direkt für Ihren Betrieb.</p>
        </section>

        <div className={styles.heroGrid}>
          <section className={styles.videoFrame} aria-label="Persönliche Videonachricht">
            {(hasVertical&&Boolean(videoId))||token==="demo" ? (
              <VideoPlayer
                youtubeId={token==="demo"?(mainVideoId||data.youtubeId):videoId}
                screenshot={data.screenshot}
                company={data.company}
              />
            ):(
              <div className={styles.staticShot} style={data.screenshot?{backgroundImage:"url("+data.screenshot+")"}:undefined} role="img" aria-label={"Website von "+data.company}/>
            )}
            <div className={styles.videoByline}><span className={styles.bylineAvatar}>RH</span><span>Raphael Hermann <small>· Digitale Gewinner</small></span></div>
          </section>
          <aside className={styles.pitch} aria-label="Kostenloses Gespräch">
            <span className={styles.pitchTop}>PERSÖNLICHES GESPRÄCH · 15 MIN</span>
            {segment === "pflege" ? (
              <>
                <h2>Was sich für Ihren Betrieb verändern kann</h2>
                <ul className={styles.careBenefits}>
                  <li><span aria-hidden="true">✓</span><span>Das Ziel: <strong>2–3 passende Bewerbungen pro Woche</strong></span></li>
                  <li><span aria-hidden="true">✓</span><span><strong>Entlastete und motivierte Teams</strong></span></li>
                  <li><span aria-hidden="true">✓</span><span>Endlich den <strong>Personalschlüssel decken</strong></span></li>
                </ul>
                <p>Ob das bei Ihnen wirtschaftlich Sinn macht, prüfen wir persönlich. <strong>Beides ist vollkommen in Ordnung.</strong></p>
              </>
            ) : segment === "pv" ? (
              <>
                <h2>Was PV-Trust Ihrem Betrieb bringt</h2>
                <ul className={styles.careBenefits}>
                  <li><span aria-hidden="true">✓</span><span><strong>Eigene, exklusive PV-Anfragen</strong> direkt für Ihren Betrieb</span></li>
                  <li><span aria-hidden="true">✓</span><span><strong>Weniger Abhängigkeit</strong> von Leadportalen und Empfehlungen</span></li>
                  <li><span aria-hidden="true">✓</span><span><strong>Planbarer Vertrieb</strong>, weniger Aufwand und mehr Gewinnpotenzial</span></li>
                </ul>
                <p>Ob das bei Ihnen wirtschaftlich Sinn macht, prüfen wir persönlich. <strong>Beides ist vollkommen in Ordnung.</strong></p>
              </>
            ) : (
              <>
                <h2>Passt das wirtschaftlich zu Ihrem Betrieb?</h2>
                <p>Genau das schauen wir uns gemeinsam an. Ob sich eine Zusammenarbeit lohnt oder nicht – <strong>beides ist vollkommen in Ordnung.</strong></p>
              </>
            )}
            <a href="#termin" className={styles.cta}>Kostenlosen Termin wählen <span aria-hidden="true">↗</span></a>
            <span className={styles.ctaNote}>Unverbindlich. Kein Verkaufsdruck.</span>
            <a href={whatsappUrl} className={styles.secondaryContact} target="_blank" rel="noopener noreferrer" data-secondary-action="whatsapp">Lieber kurz eine Frage stellen? WhatsApp ↗</a>
          </aside>
        </div>

        {hasVertical && explainerVideoUrl && (
          <section className={styles.explainer} aria-label="Optionales Erklärvideo">
            <div className={styles.explainerIntro}>
              <div>
                <span className={styles.smallEyebrow}>WENN SIE MEHR ERFAHREN MÖCHTEN</span>
                <h2>{isPv ? "Wie gewinnen PV-Betriebe eigene Projektanfragen?" : "Wie gewinnen Pflegebetriebe wieder passende Bewerbungen?"}</h2>
                <p>Unser System kurz erklärt – freiwillig, ohne Umweg zur Terminbuchung.</p>
              </div>
              <a href="#termin" className={styles.explainerBooking}>Direkt Termin wählen ↗</a>
            </div>
            <details className={styles.explainerDisclosure}>
              <summary className={styles.explainerToggle}>
                <span className={styles.explainerThumb} style={explainerPosterUrl ? { backgroundImage: `url("${explainerPosterUrl}")` } : undefined}>
                  <span aria-hidden="true" className={styles.explainerPlay}>▶</span>
                </span>
                <span className={styles.explainerToggleText}>
                  <strong>{isPv ? "PV-Trust in 3 Minuten erklärt" : "Das Pflege-Recruiting-System erklärt"}</strong>
                  <small>Optional ansehen · Video öffnen</small>
                </span>
                <span aria-hidden="true" className={styles.explainerChevron}>⌄</span>
              </summary>
              <div className={styles.explainerPlayback}>
                <iframe src={explainerVideoUrl} title={isPv ? "PV-Trust – Das System in 3 Minuten erklärt" : "Pflege-Recruiting – Das System erklärt"} loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen />
                <a href="#termin" className={styles.explainerBottomCta}>Kostenloses 15-Minuten-Gespräch vereinbaren ↗</a>
              </div>
            </details>
          </section>
        )}

        {hasVertical&&(
          <section className={styles.proof} aria-labelledby="proof-title">
            <div className={styles.sectionTop}>
              <div><span className={styles.smallEyebrow}>ERGEBNISSE AUS DER PRAXIS</span><h2 id="proof-title">{isPv?"Exklusive Anfragen. Echte Zahlen.":"Echte Einstellungen. Echte Ergebnisse."}</h2></div>
            </div>
            <div className={styles.metrics}>
              {proofItems.map((item)=>(
                <article className={styles.metric} key={item.name}>
                  <strong>{item.big}</strong>
                  <div><b>{item.name.replace(" · PV-Trust-Kunde","")}</b><span>{item.line}</span></div>
                </article>
              ))}
            </div>
            <div className={styles.changeLine}>
              <span className={styles.changeOld}>{isPv?"Weg von Leadportalen und schwankenden Empfehlungen":"Weg von ständig neuen Recruiting-Kampagnen"}</span>
              <span className={styles.changeArrow} aria-hidden="true">→</span>
              <strong>{isPv?"Hin zu eigenen exklusiven Anfragen und strukturiertem Vertrieb":"Hin zu einer eigenen Karrierewelt, die bleibt"}</strong>
            </div>
            <p className={styles.proofNote}>Kundenbeispiele – keine Garantie für identische Ergebnisse.</p>
          </section>
        )}

        {hasVertical&&(
          <details className={styles.funding} aria-label="Mögliche Förderung 2026">
            <summary>Fördermöglichkeit 2026: 50–80 % Zuschuss für förderfähige Beratung prüfen <span aria-hidden="true">+</span></summary>
            <p className={styles.fundingNote}>Je nach KMU-Betriebsstätte und Voraussetzungen sind bis zu 1.750 € bzw. 2.800 € BAFA-Zuschuss für förderfähige, eigenständige Unternehmensberatung möglich. Anträge nach aktueller Richtlinie bis 31.12.2026. Website, Marketingumsetzung und Werbebudget sind nicht pauschal förderfähig. Antragstellung und Beraterzulassung müssen vor Beginn geprüft werden. Keine Fördergarantie. <a href="https://www.bafa.de/SharedDocs/Downloads/DE/Wirtschaft/unb_flyer.pdf?__blob=publicationFile&v=2" target="_blank" rel="noopener noreferrer">Offizielle BAFA-Informationen</a>.</p>
          </details>
        )}

        <section id="termin" className={styles.booking} aria-labelledby="booking-title">
          <span className={styles.smallEyebrow}>DER NÄCHSTE SCHRITT</span>
          <h2 id="booking-title">15 Minuten. Eine klare Entscheidung.</h2>
          <p>Hier können Sie direkt einen Termin bei Raphael auswählen.</p>
          <div className={styles.calendar}>
            <iframe src={CALENDAR_URL} title="Terminbuchung bei Raphael Hermann" loading="lazy"/>
          </div>
        </section>
        <footer className={styles.legal}>
          <span>Digitale Gewinner · Raphael Hermann</span>
          <a href="https://digitalegewinner.de/impressum.html" target="_blank" rel="noopener noreferrer">Impressum</a>
          <a href="https://digitalegewinner.de/datenschutz.html" target="_blank" rel="noopener noreferrer">Datenschutz</a>
          <span>Wir messen Seitenbesuche und Videonutzung ohne Cookies. Details in der Datenschutzerklärung.</span>
        </footer>
      </div>
    </main>
  );
}

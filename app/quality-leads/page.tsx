import { getDailyQualityLeadReport } from "@/lib/daily-quality-leads";
import QualityLeadRunner from "./QualityLeadRunner";
import styles from "./quality-leads.module.css";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function statusClass(status: "green" | "yellow" | "red") {
  if (status === "green") return styles.statusGreen;
  if (status === "yellow") return styles.statusYellow;
  return styles.statusRed;
}

export default async function QualityLeadsPage() {
  const report = await getDailyQualityLeadReport();
  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.eyebrow}>Digitale Gewinner · Loom Lead Supply · Quality Gate v3</div>
        <section className={styles.hero}>
          <h1>120 Firmen pro Tag — plus Reserve, ohne Qualitäts-Füllmaterial.</h1>
          <p>
            Die Tagesliste enthält maximal {report.target} unkontaktierte ambulante Pflegedienste mit bestätigtem Recruiting-Pain,
            einer vorhandenen sichtbar schwachen Website, Telefonnummer und eindeutiger Firmenidentität.
            Im Hintergrund wird bis {report.bufferTarget} streng bestandene Leads nachgefüllt, damit die Loom-Kampagne nicht nach einem schwachen Discovery-Tag leerläuft.
          </p>
        </section>

        {report.ready < report.target ? (
          <div className={styles.warning}>
            Tagesziel noch nicht gedeckt: aktuell bestehen {report.ready} von {report.target}. Es fehlen {report.deficit}. Es werden keine B-/C-Leads zum Auffüllen zugelassen.
          </div>
        ) : report.ready < report.bufferTarget ? (
          <div className={styles.warning}>
            Tagesziel gedeckt, Sicherheitsbestand noch nicht voll: {report.ready}/{report.bufferTarget}. Reserve aktuell {report.reserveReady}; es fehlen {report.bufferDeficit} bis zum 2-Tages-Puffer.
          </div>
        ) : null}

        <section className={styles.scoreGrid} aria-label="Lead-Funnel">
          <div className={`${styles.scoreCard} ${statusClass(report.status)}`}><strong>{report.availableToday}/{report.target}</strong><span>heute für Loom verfügbar</span></div>
          <div className={styles.scoreCard}><strong>{report.ready}/{report.bufferTarget}</strong><span>strenger Gesamtpuffer</span></div>
          <div className={styles.scoreCard}><strong>{report.reserveReady}</strong><span>Reserve über Tagesbedarf</span></div>
          <div className={styles.scoreCard}><strong>{report.daysOfCoverage.toFixed(2)}×</strong><span>Tagesabdeckung</span></div>
          <div className={styles.scoreCard}><strong>{report.funnel.unqualifiedWithPhoneAndWebsite}</strong><span>nächste Kandidaten mit Telefon + Website</span></div>
          <div className={styles.scoreCard}><strong>{report.funnel.activeCandidates}</strong><span>aktive harte ICP-Kandidaten</span></div>
        </section>

        <QualityLeadRunner />

        <ul className={styles.gate}>
          {report.gate.map((item) => <li key={item}>{item}</li>)}
        </ul>

        <div className={styles.sectionHead}>
          <h2>Heute für Loom Outreach</h2>
          <p>Sortiert nach Priority · maximal {report.target} · Stand {new Date(report.generatedAt).toLocaleString("de-DE")}</p>
        </div>

        <div className={styles.tableWrap}>
          {report.leads.length ? (
            <table className={styles.table}>
              <thead>
                <tr><th>#</th><th>Firma</th><th>Priority</th><th>Recruiting-Pain</th><th>Website-Probleme</th><th>Telefon</th><th>Website</th><th>Proof</th></tr>
              </thead>
              <tbody>
                {report.leads.map((lead, index) => (
                  <tr key={lead.leadId}>
                    <td className={styles.rank}>{String(index + 1).padStart(3, "0")}</td>
                    <td><div className={styles.company}>{lead.company}</div><div className={styles.muted}>{lead.city || "Ort offen"}</div></td>
                    <td className={styles.priority}>{lead.priorityScore}</td>
                    <td><strong>{lead.relevantOpenJobs} offene Stelle{lead.relevantOpenJobs === 1 ? "" : "n"}</strong>{lead.jobTitles.length ? <div className={styles.muted}>{lead.jobTitles.slice(0, 2).join(" · ")}</div> : null}</td>
                    <td><div className={styles.proof}>{lead.websiteReasons.map((reason) => <span className={styles.pill} key={reason}>{reason}</span>)}</div></td>
                    <td>{lead.phone}</td>
                    <td><a className={styles.website} href={lead.website} target="_blank" rel="noreferrer">Website öffnen</a></td>
                    <td><div className={styles.proof}>{lead.proof.map((proof) => <span className={styles.pill} key={proof}>{proof}</span>)}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <div className={styles.empty}>Noch kein Lead besteht Gate v3. Starte den Quality-Lauf.</div>}
        </div>
      </div>
    </main>
  );
}

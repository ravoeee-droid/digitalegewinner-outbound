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
        <div className={styles.eyebrow}>Digitale Gewinner · Daily Lead Quality Gate v3</div>
        <section className={styles.hero}>
          <h1>60 Firmen, die einen echten Grund für deinen Anruf haben.</h1>
          <p>
            Diese Liste zeigt nur unkontaktierte ambulante Pflegedienste mit bestätigtem Recruiting-Pain,
            einer vorhandenen sichtbar schwachen Website, Telefonnummer und eindeutiger Firmenidentität.
            Es wird niemals mit schwächeren Leads auf 60 aufgefüllt.
          </p>
        </section>

        {report.ready < report.target ? (
          <div className={styles.warning}>
            Quality Gate ehrlich rot: aktuell bestehen {report.ready} von {report.target}. Es fehlen {report.deficit} — statt diese Zahl mit B-/C-Leads schönzurechnen.
          </div>
        ) : null}

        <section className={styles.scoreGrid} aria-label="Lead-Funnel">
          <div className={`${styles.scoreCard} ${statusClass(report.status)}`}><strong>{report.ready}/{report.target}</strong><span>streng anrufbereit</span></div>
          <div className={styles.scoreCard}><strong>{report.funnel.unqualified}</strong><span>noch unqualifiziert</span></div>
          <div className={styles.scoreCard}><strong>{report.funnel.unqualifiedWithPhoneAndWebsite}</strong><span>mit Telefon + Website</span></div>
          <div className={styles.scoreCard}><strong>{report.funnel.legacyAPlus}</strong><span>altes A+ vor Gate v3</span></div>
          <div className={styles.scoreCard}><strong>{report.funnel.activeCandidates}</strong><span>aktive ICP Kandidaten</span></div>
        </section>

        <QualityLeadRunner />

        <ul className={styles.gate}>
          {report.gate.map((item) => <li key={item}>{item}</li>)}
        </ul>

        <div className={styles.sectionHead}>
          <h2>Heute anrufen</h2>
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
                    <td className={styles.rank}>{String(index + 1).padStart(2, "0")}</td>
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

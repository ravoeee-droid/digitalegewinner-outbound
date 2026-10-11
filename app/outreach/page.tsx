import { query } from "@/lib/db";
import SendDraftButton from "./SendDraftButton";

export const dynamic = "force-dynamic";

type OutreachRow = {
  id: string;
  rank: number;
  company: string;
  city: string;
  email: string;
  subject: string;
  body: string;
  status: string;
  score: number;
  category: string;
  contact: string;
  job_count: number;
  finding: string;
};

export default async function OutreachPage() {
  let rows: OutreachRow[] = [];
  let error = "";
  try {
    rows = await query<OutreachRow>(`
      select
        q.id,
        q.rank,
        coalesce(q.lead->>'name','') company,
        coalesce(q.lead->>'city','') city,
        q.email,
        q.subject,
        q.body,
        q.status,
        coalesce((q.lead->>'score')::integer,0) score,
        coalesce(q.lead->>'category','') category,
        coalesce(q.lead->>'contactPerson','') contact,
        coalesce((q.lead->'signals'->>'jobCount')::integer,0) job_count,
        coalesce(q.lead->'signals'->'websiteAudit'->>'finding','') finding
      from public.pflege_email_outreach q
      where q.lead_date=(now() at time zone 'Europe/Berlin')::date
        and q.status<>'historical'
      order by q.rank asc, q.created_at asc
      limit 100
    `);
  } catch (err) {
    error = err instanceof Error ? err.message : "Queue konnte nicht geladen werden.";
  }

  const ready = rows.length;
  const progress = Math.min(100, ready);

  return (
    <main className="dg-page">
        <header className="dg-head">
          <div className="dg-head-copy">
            <span className="dg-eyebrow">Pflege Outbound · 100 neue 1A Leads pro Tag</span>
            <h1 className="dg-title">E-Mail Queue</h1>
            <p className="dg-lead">
              Nur neue, deduplizierte ambulante Pflegedienste und Intensivpflegedienste mit aktuellem Personalbedarf, öffentlicher Geschäfts-E-Mail und personalisiertem Entwurf. Versand bleibt bewusst auf Freigabe.
            </p>
          </div>
          <div className="dg-panel" style={{ minWidth: 260, padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <strong style={{ fontSize: 30, letterSpacing: "-.03em" }}>{ready}</strong>
              <span style={{ color: "var(--dg-muted)", fontSize: 13 }}>/ 100 heute</span>
            </div>
            <div style={{ height: 7, borderRadius: 999, background: "rgba(255,255,255,.08)", overflow: "hidden", marginTop: 10 }}>
              <div style={{ height: "100%", width: `${progress}%`, borderRadius: 999, background: "linear-gradient(90deg,#34c759,#5df0b8)" }} />
            </div>
            <div style={{ color: ready >= 100 ? "var(--dg-accent-2)" : "var(--dg-warn)", fontSize: 13, marginTop: 10 }}>
              {ready >= 100 ? "Tagesziel erreicht" : `${100 - ready} frische 1A Leads fehlen noch`}
            </div>
          </div>
        </header>

        {error && (
          <div className="dg-notice" role="alert">
            {error}
          </div>
        )}

        <section className="dg-panel" style={{ overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1120 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--dg-muted)", fontSize: 12, letterSpacing: ".08em" }}>
                  {['#','Unternehmen','Warum jetzt','Kontakt','Score','Status','E-Mail'].map((label) => (
                    <th key={label} style={{ padding: "14px 16px", borderBottom: "1px solid rgba(255,255,255,.08)", fontWeight: 600 }}>{label.toUpperCase()}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} style={{ verticalAlign: "top" }}>
                    <td style={{ padding: "18px 16px", borderBottom: "1px solid rgba(255,255,255,.06)", color: "#697382", fontVariantNumeric: "tabular-nums" }}>{row.rank}</td>
                    <td style={{ padding: "18px 16px", borderBottom: "1px solid rgba(255,255,255,.06)", maxWidth: 260 }}>
                      <strong style={{ display: "block", fontSize: 14 }}>{row.company}</strong>
                      <span style={{ display: "block", marginTop: 5, color: "var(--dg-muted)", fontSize: 13 }}>{row.city || 'Deutschland'} · {row.category === 'intensive_care' ? 'Intensivpflege' : 'Ambulant'}</span>
                    </td>
                    <td style={{ padding: "18px 16px", borderBottom: "1px solid rgba(255,255,255,.06)", maxWidth: 300 }}>
                      <span style={{ display: "block", fontSize: 13, lineHeight: 1.45 }}>{row.job_count > 0 ? `${row.job_count} offene Pflege-Stelle${row.job_count === 1 ? '' : 'n'}` : 'Aktiver Personalbedarf'}</span>
                      <span style={{ display: "block", marginTop: 5, color: "var(--dg-muted)", fontSize: 13, lineHeight: 1.4 }}>{row.finding || 'Recruiting-/Website-Hebel erkannt'}</span>
                    </td>
                    <td style={{ padding: "18px 16px", borderBottom: "1px solid rgba(255,255,255,.06)" }}>
                      <span style={{ display: "block", fontSize: 12 }}>{row.contact || 'Geschäftsleitung / PDL'}</span>
                      <span style={{ display: "block", marginTop: 5, color: "var(--dg-muted)", fontSize: 13 }}>{row.email}</span>
                    </td>
                    <td style={{ padding: "18px 16px", borderBottom: "1px solid rgba(255,255,255,.06)" }}>
                      <span style={{ display: "inline-flex", minWidth: 42, justifyContent: "center", padding: "7px 9px", borderRadius: 10, background: "rgba(213,255,89,.1)", color: "#34c759", fontWeight: 700, fontSize: 12 }}>{row.score}</span>
                    </td>
                    <td style={{ padding: "18px 16px", borderBottom: "1px solid rgba(255,255,255,.06)" }}>
                      <span style={{ display: "inline-flex", padding: "6px 9px", borderRadius: 999, background: "rgba(93,240,184,.09)", border: "1px solid rgba(93,240,184,.16)", color: "#84f5c8", fontSize: 11 }}>1A · {row.status}</span>
                    </td>
                    <td style={{ padding: "18px 16px", borderBottom: "1px solid rgba(255,255,255,.06)", minWidth: 210 }}>
                      <details>
                        <summary style={{ cursor: "pointer", fontSize: 12, color: "#34c759" }}>Entwurf ansehen</summary>
                        <div style={{ marginTop: 12, padding: 14, borderRadius: 14, background: "#0b0e13", border: "1px solid rgba(255,255,255,.07)", width: 420, maxWidth: "70vw" }}>
                          <strong style={{ display: "block", fontSize: 12, marginBottom: 10 }}>{row.subject}</strong>
                          <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: "inherit", color: "#aeb6c2", fontSize: 12, lineHeight: 1.55 }}>{row.body}</pre>
                        </div>
                      </details>
                      {row.status === "draft" && (
                        <div style={{ marginTop: 10 }}>
                          <SendDraftButton outreachId={row.id} />
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr><td colSpan={7} style={{ padding: 42, textAlign: "center", color: "#7f8998" }}>Die heutige Queue wird gerade aufgebaut.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
    </main>
  );
}

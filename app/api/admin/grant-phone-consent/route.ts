import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { query } from "@/lib/db";
import { adminCookieName, sessionRole } from "@/lib/admin-auth";
import { decidePermissionReview, requestPermissionReview } from "@/lib/outbound-compliance-engine";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Einmalige Sammelfreigabe der telefonischen Zusagen über den regulären Freigabe-Workflow
// (requestPermissionReview -> decidePermissionReview). Nur mit Admin-Login (proxy.ts + Rollenprüfung).
// GET = Vorschau mit Button, POST = ausführen. Nach der Ausführung wird diese Route wieder entfernt.

const ACTOR = "raphael";
const SOURCE = "telefon";
const EVIDENCE =
  "Mündliche Zusage am Telefon zum Versand eines Videos per E-Mail. " +
  "Sammelbestätigung des Inhabers (Raphael Hermann): nicht zustimmende Kontakte wurden vor dem Einpflegen aussortiert.";
const DECISION_REASON = "Telefonische Zusage, vom Inhaber bestätigt (Sammelfreigabe)";

type Row = { contact_id: string; company_id: string | null; email: string };

async function requireAdmin() {
  const store = await cookies();
  return sessionRole(store.get(adminCookieName())?.value) === "admin";
}

async function candidates(): Promise<Row[]> {
  return query<Row>(
    `select distinct on (ct.id) ct.id as contact_id, l.company_id, ct.email
     from sales_leads l
     join sales_contacts ct on ct.id=l.contact_id and ct.workspace=l.workspace
     where l.workspace='default' and l.status='active'
       and coalesce(l.do_not_contact,false)=false
       and position('@' in coalesce(ct.email,''))>1
       and not exists(select 1 from er_suppressions s
                      where s.workspace='default' and lower(s.email)=lower(ct.email))
       and not exists(select 1 from outbound_compliance_suppressions s
                      where s.workspace='default' and s.channel='email'
                        and s.status='active' and lower(s.identifier)=lower(ct.email))
       and not exists(select 1 from outbound_contact_permissions p
                      where p.workspace='default' and p.channel='email'
                        and p.status='verified' and p.revoked_at is null
                        and (p.contact_id=ct.id or p.company_id=l.company_id))
       and not exists(select 1 from outbound_permission_reviews r
                      where r.workspace='default' and r.channel='email'
                        and r.status='pending' and r.contact_id=ct.id)
     order by ct.id`,
  );
}

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const rows = await candidates();
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Telefonische Zusagen freigeben</title>
<body style="font-family:system-ui;max-width:560px;margin:48px auto;padding:0 16px">
<h1>Telefonische Zusagen freigeben</h1>
<p><b>${rows.length}</b> Kontakte würden als <code>explicit_consent</code> (Quelle: Telefon) freigegeben, mit dir als Freigeber.</p>
<p>Stichprobe: ${rows.slice(0, 5).map((r) => r.email.replace(/</g, "&lt;")).join(", ") || "–"}</p>
<form method="post"><button type="submit" style="font-size:18px;padding:12px 20px"${rows.length ? "" : " disabled"}>Jetzt freigeben</button></form>
</body>`;
  return new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

export async function POST() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const rows = await candidates();
  let ok = 0;
  const errors: string[] = [];
  for (const r of rows) {
    try {
      const review = await requestPermissionReview(
        {
          contactId: r.contact_id,
          companyId: r.company_id,
          channel: "email",
          jurisdiction: "DE",
          basis: "explicit_consent",
          source: SOURCE,
          evidenceSummary: EVIDENCE,
        },
        ACTOR,
      );
      await decidePermissionReview({ reviewId: review.id, decision: "approved", reason: DECISION_REASON }, ACTOR);
      ok++;
    } catch (e) {
      if (errors.length < 20) errors.push(`${r.email}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return NextResponse.json({ kandidaten: rows.length, freigegeben: ok, fehler: rows.length - ok, fehlerBeispiele: errors });
}

// Holt fehlende E-Mail-Adressen für Pflegedienste, die schon im CRM liegen (Anruf-Leads, Recherche) und eine Website haben.
// Nur Betriebe mit belegter offener Stelle werden übernommen, denn die Mail spricht die offene Stelle an.
import { query } from "@/lib/db";
import { findPvSiteContact, isExcludedPflegeName } from "@/lib/ba-lead-source";
import { persistRadarLead } from "@/lib/sales-os";

type Row = { id: string; name: string; website: string; city: string; phone: string; job_title: string };

export async function enrichPflegeContacts({ limit = 40, budgetMs = 200_000 }: { limit?: number; budgetMs?: number } = {}) {
  const startedAt = Date.now();
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
  let checked = 0, added = 0;
  while (Date.now() - startedAt < budgetMs - 25_000 && added < limit) {
    const rows = await query<Row>(
      `update sales_companies c set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('email_enrich_at',now()::text)
       where c.id in (
         select c2.id from sales_companies c2
         where c2.workspace='default' and c2.industry='Pflege' and coalesce(c2.website,'')<>'' and c2.source not in ('ba-jobboerse','ba-pv')
           and c2.metadata->>'email_enrich_at' is null
           and (coalesce(c2.metadata->>'jobUrl','')<>'' or coalesce((c2.metadata->'daily_qualification'->'jobGrowth'->>'relevantOpenJobs')::int,0)>0)
           and not exists(select 1 from sales_contacts k where k.workspace=c2.workspace and k.company_id=c2.id and coalesce(k.email,'')<>'')
         order by c2.latest_score desc nulls last limit 16 for update skip locked)
       returning c.id, c.name, c.website, coalesce(c.city,'') city, coalesce(c.phone,'') phone, coalesce(nullif(c.metadata->>'jobTitle',''),'') job_title`,
    );
    if (!rows.length) break;
    await Promise.all(rows.map(async (r) => {
      try {
        checked++;
        if (isExcludedPflegeName(r.name)) return;
        const found = await findPvSiteContact(r.website, "pflege");
        if (!found.email) return;
        const dup = await query("select 1 from sales_contacts where workspace='default' and lower(email)=lower($1) limit 1", [found.email]);
        if (dup.length) return;
        const saved = await persistRadarLead({ id: `crm-enrich:${r.id}`, company: r.name, contact: found.person || "", email: found.email, phone: found.phone || r.phone, website: r.website, city: r.city, industry: "Pflege", source: "ba-jobboerse" }, { email: found.email, phone: found.phone || r.phone } as never, undefined, "default");
        await query(
          "update sales_companies set source='ba-jobboerse', metadata=coalesce(metadata,'{}'::jsonb)||$2::jsonb, updated_at=now() where id=$1",
          [saved.companyId, JSON.stringify({ source: "ba-jobboerse", via: "crm-enrichment", email_enriched_on: today, jobTitle: r.job_title || "Pflegefachkräfte" })],
        );
        added++;
      } catch {
        // Fehler bei einer Website blockiert die anderen nicht
      }
    }));
  }
  return { checked, added, seconds: Math.round((Date.now() - startedAt) / 1000) };
}

export async function enrichedToday() {
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
  const [row] = await query<{ n: number }>("select count(*)::int n from sales_companies where workspace='default' and metadata->>'email_enriched_on'=$1", [today]);
  return row?.n || 0;
}

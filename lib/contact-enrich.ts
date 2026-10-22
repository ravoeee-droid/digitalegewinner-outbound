// Hintergrund-Agent: liest für jeden Lead einmal Impressum und Kontaktseite und ergänzt Ansprechpartner, Telefon und (falls vorhanden) die persönliche Adresse der Geschäftsführung.
import { query } from "@/lib/db";
import { findPvSiteContact } from "@/lib/ba-lead-source";
import { cleanPersonName } from "@/lib/outreach-copy";
import { websiteFor } from "@/lib/lead-screenshot";

type Row = { lead_id: string; company_id: string; source: string; website: string; email: string; contact_id: string | null; contact_name: string; contact_phone: string };

export async function enrichContactsOnce({ limit = 48, budgetMs = 200_000 }: { limit?: number; budgetMs?: number } = {}) {
  const startedAt = Date.now();
  let checked = 0, named = 0, personal = 0;
  while (Date.now() - startedAt < budgetMs - 40_000 && checked < limit) {
    // Zuerst die Leads, die noch nicht angeschrieben wurden (dort wirkt ein besserer Ansprechpartner am meisten).
    const rows = await query<Row>(
      `with pick as (
         select l.id, c.id company_id
         from sales_leads l join sales_companies c on c.id=l.company_id and c.workspace=l.workspace
         where l.workspace='default' and l.status='active' and c.metadata->>'contact_enriched_at' is null
           and (coalesce(c.website,'')<>'' or coalesce(c.domain,'')<>'')
         order by exists(select 1 from er_outbox o where o.workspace='default' and o.lead_id=l.id::text and o.status not in ('failed','suppressed')) asc,
                  l.priority_score desc nulls last
         limit 8 for update of c skip locked)
       , marked as (
         update sales_companies c set metadata=coalesce(c.metadata,'{}'::jsonb)||jsonb_build_object('contact_enriched_at',now()::text)
         from pick where c.id=pick.company_id returning c.id)
       select pick.id::text lead_id, pick.company_id::text, coalesce(c.source,'') source, coalesce(nullif(c.website,''),c.domain) website,
              coalesce(k.email,'') email, k.id::text contact_id, coalesce(k.name,'') contact_name, coalesce(k.phone,c.phone,'') contact_phone
       from pick join marked m on m.id=pick.company_id join sales_companies c on c.id=pick.company_id
       left join lateral (select * from sales_contacts k where k.company_id=c.id and k.workspace='default' order by (coalesce(k.email,'')<>'') desc, k.is_primary desc, k.created_at limit 1) k on true`,
    ).catch(() => [] as Row[]);
    if (!rows.length) break;
    await Promise.all(rows.map(async (row) => {
      try {
        checked++;
        const site = websiteFor(row.website, row.email);
        if (!site) return;
        const found = await findPvSiteContact(site, row.source === "ba-pv" ? "pv" : "pflege");
        const name = cleanPersonName(found.person || "");
        if (row.contact_id) {
          if (name && !cleanPersonName(row.contact_name)) { await query("update sales_contacts set name=$2, updated_at=now() where id=$1", [row.contact_id, name]); named++; }
          if (found.phone && !row.contact_phone) await query("update sales_contacts set phone=$2, updated_at=now() where id=$1 and coalesce(phone,'')=''", [row.contact_id, found.phone]);
          // Persönliche Adresse nur, solange noch keine Mail an den Lead rausging oder eingeplant ist.
          if ("personal" in found && found.personal && found.email && found.email.toLowerCase() !== row.email.toLowerCase()) {
            const [busy] = await query("select 1 from er_outbox where workspace='default' and lead_id=$1 and status not in ('failed','suppressed') limit 1", [row.lead_id]);
            const [dup] = await query("select 1 from sales_contacts where workspace='default' and lower(email)=lower($1) limit 1", [found.email]);
            if (!busy && !dup) {
              await query("update sales_contacts set email=$2, metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('previous_email',$3::text,'email_source','impressum_geschaeftsfuehrung'), updated_at=now() where id=$1", [row.contact_id, found.email, row.email]);
              personal++;
            }
          }
        }
      } catch { /* ein Fehler bei einer Website stoppt die anderen nicht */ }
    }));
  }
  return { checked, named, personal, seconds: Math.round((Date.now() - startedAt) / 1000) };
}

export async function contactEnrichProgress() {
  const [row] = await query<{ done: number; total: number }>(
    `select count(*) filter(where c.metadata->>'contact_enriched_at' is not null)::int done, count(*)::int total
     from sales_leads l join sales_companies c on c.id=l.company_id and c.workspace=l.workspace
     where l.workspace='default' and l.status='active' and (coalesce(c.website,'')<>'' or coalesce(c.domain,'')<>'')`,
  ).catch(() => []);
  return { done: row?.done || 0, total: row?.total || 0 };
}

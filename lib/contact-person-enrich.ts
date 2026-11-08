import { randomUUID } from "node:crypto";
import { query } from "@/lib/db";
import { findPvSiteContact } from "@/lib/ba-lead-source";

// Sucht für Leads ohne Ansprechpartner auf der Firmenwebsite (Startseite, Impressum, Kontakt) nach Geschäftsführung/Inhaber/PDL.
// Trägt den Namen nur ein, wenn beim Kontakt noch keiner steht; Vorhandenes wird nie überschrieben. Jede Firma wird nur einmal versucht.
export async function enrichContactPersons(leadIds: string[], { limit = 20, budgetMs = 55_000, concurrency = 5 } = {}) {
  const startedAt = Date.now();
  const rows = leadIds.length ? await query<{ lead_id: string; company_id: string; contact_id: string | null; website: string; workspace: string }>(
    `select l.id lead_id, l.company_id, l.contact_id, c.website, l.workspace
       from sales_leads l join sales_companies c on c.id=l.company_id and c.workspace=l.workspace left join sales_contacts ct on ct.id=l.contact_id
      where l.id=any($1::text[]) and coalesce(ct.name,'')='' and coalesce(c.website,'')<>'' and c.metadata->>'person_enrich_at' is null
      limit $2`, [leadIds, limit]) : [];
  let found = 0, tried = 0;
  const queue = [...rows];
  await Promise.all(Array.from({ length: concurrency }, async () => {
    for (let r; (r = queue.shift()) && Date.now() - startedAt < budgetMs;) {
      tried++;
      let person = "";
      try { person = ((await findPvSiteContact(r.website, "pflege")).person || "").trim(); } catch { /* Webseite nicht lesbar: trotzdem als versucht markieren */ }
      try {
        await query(`update sales_companies set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('person_enrich_at',now()::text,'person_found',$2::text) where id=$1`, [r.company_id, person]);
        if (!person) continue;
        if (r.contact_id) await query(`update sales_contacts set name=$2,updated_at=now() where id=$1 and coalesce(name,'')=''`, [r.contact_id, person]);
        else {
          const id = `pe-${randomUUID()}`;
          await query(`insert into sales_contacts(id,workspace,company_id,name,source,is_primary,metadata) values($1,$2,$3,$4,'public-website',true,'{}'::jsonb)`, [id, r.workspace, r.company_id, person]);
          await query(`update sales_leads set contact_id=$2,updated_at=now() where id=$1 and contact_id is null`, [r.lead_id, id]);
        }
        found++;
      } catch { /* einzelner Datensatz darf die anderen nicht blockieren */ }
    }
  }));
  const [left] = leadIds.length ? await query<{ n: number }>(
    `select count(*)::int n from sales_leads l join sales_companies c on c.id=l.company_id and c.workspace=l.workspace left join sales_contacts ct on ct.id=l.contact_id
      where l.id=any($1::text[]) and coalesce(ct.name,'')='' and coalesce(c.website,'')<>'' and c.metadata->>'person_enrich_at' is null`, [leadIds]) : [{ n: 0 }];
  return { tried, found, open: left?.n ?? 0 };
}

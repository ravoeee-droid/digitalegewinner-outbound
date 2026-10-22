// Sperrliste: Kunden aus Fallstudien, Referenzen und andere Betriebe, die keine Kaltmail bekommen dürfen.
// Ein Eintrag sperrt jeden Lead, dessen Firmenname, Website oder E-Mail den Text enthält (ohne Groß-/Kleinschreibung).
import { query } from "@/lib/db";

const DEFAULTS: Array<[string, string]> = [
  ["libi elektronik", "PV-Fallstudie Libi Elektronik"],
  ["libielektronik", "PV-Fallstudie Libi Elektronik"],
  ["solavol", "PV-Fallstudie Solavol"],
  ["drk", "Fallstudie 01 (DRK)"],
  ["rotes kreuz", "Fallstudie 01 (DRK)"],
  ["pflegeresidenz rose", "Fallstudie 02"],
  ["maternus", "Fallstudie 03"],
  ["radloff", "Fallstudie 04 (Häusliche Krankenpflege Raik Radloff)"],
  ["kögler", "Beispielkampagne Pflegehaus Kögler"],
  ["koegler", "Beispielkampagne Pflegehaus Kögler"],
  ["knoblauch", "Referenz Pflege-Service Knoblauch"],
  ["cura-tagespflege", "Referenz Cura Tagespflege"],
  ["gbs-seniorenhilfe", "Referenz GBS Seniorenhilfe"],
  ["linimed", "Referenz Linimed"],
];

export async function ensureBlocklist() {
  await query(`create table if not exists lead_blocklist (
    id bigserial primary key, pattern text not null unique, note text not null default '', created_at timestamptz not null default now())`);
  for (const [pattern, note] of DEFAULTS) {
    await query("insert into lead_blocklist(pattern,note) values($1,$2) on conflict (pattern) do nothing", [pattern, note]);
  }
}

// Sperrt passende Leads (nicht kontaktieren) und nimmt ihre wartenden Mails aus dem Versand.
export async function applyBlocklist() {
  await ensureBlocklist();
  const blocked = await query<{ id: string }>(`
    update sales_leads l set do_not_contact=true, updated_at=now()
    from sales_companies c
    where c.id=l.company_id and c.workspace=l.workspace and l.workspace='default' and coalesce(l.do_not_contact,false)=false
      and exists(
        select 1 from lead_blocklist b where position(lower(b.pattern) in lower(c.name))>0
          or position(lower(b.pattern) in lower(coalesce(c.website,'')||' '||coalesce(c.domain,'')))>0
          or exists(select 1 from sales_contacts k where k.company_id=c.id and k.workspace=l.workspace and position(lower(b.pattern) in lower(coalesce(k.email,'')))>0))
    returning l.id::text id`);
  if (blocked.length) {
    await query("update er_outbox set status='suppressed', error='Sperrliste' where workspace='default' and status='queued' and lead_id::text=any($1::text[])", [blocked.map((row) => row.id)]);
  }
  return blocked.length;
}

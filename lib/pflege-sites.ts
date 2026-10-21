// Lead-Pool aus Google-Maps-Listen mit Pflegebetrieben (data/pflege-sites.json).
// Ein Betrieb wird nur übernommen, wenn seine Webseite eine offene Pflegestelle zeigt und eine Geschäfts-E-Mail zu finden ist.
import sites from "@/data/pflege-sites.json";
import { query } from "@/lib/db";
import { findPflegeSiteLead, isExcludedPflegeName } from "@/lib/ba-lead-source";
import { persistRadarLead } from "@/lib/sales-os";

type SiteRow = { n: string; w: string; p: string; c: string; s: string; k: string };

function hostOf(url: string) { return new URL(url).hostname.replace(/^www\./, ""); }

async function ensurePool() {
  await query(`create table if not exists pflege_sites (
    host text primary key, name text not null, website text not null, phone text, city text, state text,
    status text not null default 'pending', job text, email text, checked_at timestamptz, created_at timestamptz not null default now())`);
  const [{ n }] = await query<{ n: number }>("select count(*)::int n from pflege_sites");
  const rows = sites as SiteRow[];
  if (Number(n) >= rows.length) return;
  for (let i = 0; i < rows.length; i += 400) {
    await query(
      `insert into pflege_sites (host,name,website,phone,city,state)
       select x->>'h',x->>'n',x->>'w',x->>'p',x->>'c',x->>'s' from jsonb_array_elements($1::jsonb) x on conflict (host) do nothing`,
      [JSON.stringify(rows.slice(i, i + 400).map((row) => ({ ...row, h: hostOf(row.w) })))],
    );
  }
}

export async function pflegeSitesStats() {
  await ensurePool();
  const rows = await query<{ status: string; n: number }>("select status,count(*)::int n from pflege_sites group by 1");
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

export async function processPflegeSites({ limit = 40, budgetMs = 200_000 }: { limit?: number; budgetMs?: number } = {}) {
  await ensurePool();
  await query("update pflege_sites set status='pending' where status='checking' and checked_at<now()-interval '15 minutes'");
  const startedAt = Date.now();
  let checked = 0, added = 0;
  while (Date.now() - startedAt < budgetMs - 30_000 && added < limit) {
    const rows = await query<{ host: string; name: string; website: string; phone: string; city: string; state: string }>(
      "update pflege_sites set status='checking', checked_at=now() where host in (select host from pflege_sites where status='pending' limit 10 for update skip locked) returning host,name,website,phone,city,state",
    );
    if (!rows.length) break;
    await Promise.all(rows.map(async (r) => {
      try {
        checked++;
        if (isExcludedPflegeName(r.name)) { await query("update pflege_sites set status='skipped' where host=$1", [r.host]); return; }
        const found = await findPflegeSiteLead(r.website);
        if (!found.email) { await query("update pflege_sites set status='no_email' where host=$1", [r.host]); return; }
        if (!found.job) { await query("update pflege_sites set status='no_job',email=$2 where host=$1", [r.host, found.email]); return; }
        const dup = await query("select 1 from sales_contacts where workspace='default' and lower(email)=lower($1) limit 1", [found.email]);
        if (dup.length) { await query("update pflege_sites set status='duplicate',email=$2 where host=$1", [r.host, found.email]); return; }
        const sourceId = `pflege-site:${r.host}`;
        await persistRadarLead({ id: sourceId, company: r.name, contact: found.person || "", email: found.email, phone: found.phone || r.phone || "", website: r.website, city: r.city, industry: "Pflege", source: "ba-jobboerse" }, { email: found.email, phone: found.phone || r.phone || "" } as never, undefined, "default");
        await query(
          "update sales_companies set source='ba-jobboerse', metadata=coalesce(metadata,'{}'::jsonb)||$2::jsonb, updated_at=now() where workspace='default' and source_id=$1",
          [sourceId, JSON.stringify({ source: "ba-jobboerse", via: "pflege-sites", jobTitle: found.job, state: r.state, category: "ambulatory_care" })],
        );
        await query("update pflege_sites set status='lead',email=$2,job=$3 where host=$1", [r.host, found.email, found.job]);
        added++;
      } catch {
        await query("update pflege_sites set status='pending' where host=$1", [r.host]).catch(() => null);
      }
    }));
  }
  return { checked, added, seconds: Math.round((Date.now() - startedAt) / 1000) };
}

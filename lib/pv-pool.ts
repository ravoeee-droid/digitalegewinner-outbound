// Lead-Pool für die PV-Kampagne: Google-Maps-Betriebe (Liste liegt in data/pv-pool.json), deren Webseite nach einer Geschäfts-E-Mail durchsucht wird.
// Gefundene Betriebe werden als Lead (source ba-pv) angelegt und von der Kampagne wie alle anderen PV-Leads angeschrieben.
import pool from "@/data/pv-pool.json";
import { query } from "@/lib/db";
import { findPvSiteContact } from "@/lib/ba-lead-source";
import { persistRadarLead } from "@/lib/sales-os";

type PoolRow = { n: string; w: string; p: string; c: string; s: string; r: number; v: number };

function hash(v: string) { let h = 2166136261; for (let i = 0; i < v.length; i++) { h ^= v.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); }

async function ensurePool() {
  await query(`create table if not exists pv_pool (
    host text primary key, name text not null, website text not null, phone text, city text, state text,
    rating numeric, reviews int, status text not null default 'pending', email text, checked_at timestamptz, created_at timestamptz not null default now())`);
  const [{ n }] = await query<{ n: number }>("select count(*)::int n from pv_pool");
  if (Number(n) >= (pool as PoolRow[]).length) return;
  const rows = pool as PoolRow[];
  for (let i = 0; i < rows.length; i += 500) {
    const part = rows.slice(i, i + 500);
    await query(
      `insert into pv_pool (host,name,website,phone,city,state,rating,reviews)
       select (x->>'h'),(x->>'n'),(x->>'w'),(x->>'p'),(x->>'c'),(x->>'s'),(x->>'r')::numeric,(x->>'v')::int from jsonb_array_elements($1::jsonb) x
       on conflict (host) do nothing`,
      [JSON.stringify(part.map((r) => ({ ...r, h: new URL(r.w).hostname.replace(/^www\./, "") })))],
    );
  }
}

export async function poolStats() {
  await ensurePool();
  const rows = await query<{ status: string; n: number }>("select status,count(*)::int n from pv_pool group by 1");
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

// Prüft einen Teil der Betriebe; maximal `limit` Leads werden neu angelegt.
export async function processPvPool({ batch = 40, limit = 40, budgetMs = 200_000 }: { batch?: number; limit?: number; budgetMs?: number } = {}) {
  await ensurePool();
  await query("update pv_pool set status='pending' where status='checking' and checked_at<now()-interval '15 minutes'");
  const startedAt = Date.now();
  let checked = 0, added = 0;
  while (Date.now() - startedAt < budgetMs - 25_000 && added < limit) {
    const rows = await query<{ host: string; name: string; website: string; phone: string; city: string; state: string }>(
      `update pv_pool set status='checking', checked_at=now() where host in (select host from pv_pool where status='pending' order by reviews desc nulls last limit $1 for update skip locked) returning host,name,website,phone,city,state`,
      [Math.min(batch, 16)],
    );
    if (!rows.length) break;
    await Promise.all(rows.map(async (r) => {
      try {
        const c = await findPvSiteContact(r.website);
        checked++;
        if (!c.email) { await query("update pv_pool set status='no_email' where host=$1", [r.host]); return; }
        const dup = await query("select 1 from sales_contacts where workspace='default' and lower(email)=lower($1) limit 1", [c.email]);
        if (dup.length) { await query("update pv_pool set status='duplicate',email=$2 where host=$1", [r.host, c.email]); return; }
        const sourceId = `pvpool:${hash(r.host)}`;
        await persistRadarLead({ id: sourceId, company: r.name, contact: c.person || "", email: c.email, phone: c.phone || r.phone || "", website: r.website, city: r.city || "", industry: "Photovoltaik", source: "ba-pv" }, { email: c.email, phone: c.phone || r.phone || "" } as never, undefined, "default");
        await query(
          "update sales_companies set source='ba-pv', metadata=coalesce(metadata,'{}'::jsonb) || $2::jsonb, updated_at=now() where workspace='default' and source_id=$1",
          [sourceId, JSON.stringify({ source: "ba-pv", via: "pv-pool", contact_enriched_at: new Date().toISOString(), state: r.state, category: "pv_installer" })],
        );
        await query("update pv_pool set status='lead',email=$2 where host=$1", [r.host, c.email]);
        added++;
      } catch {
        await query("update pv_pool set status='pending' where host=$1", [r.host]).catch(() => null);
      }
    }));
  }
  return { checked, added, seconds: Math.round((Date.now() - startedAt) / 1000) };
}

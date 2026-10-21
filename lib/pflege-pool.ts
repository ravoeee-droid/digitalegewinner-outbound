// Lead-Pool für die Pflege-Kampagne aus einem Export der Stellenbörse (data/pflege-pool.json):
// Jede Zeile ist ein Pflegebetrieb mit Bewerbungs-E-Mail und Stellenanzeige. Vor der Übernahme wird geprüft, ob die Anzeige noch online ist.
import pool from "@/data/pflege-pool.json";
import { query } from "@/lib/db";
import { adStillOpen, evaluatePflegePoolRow } from "@/lib/ba-lead-source";
import { persistRadarLead } from "@/lib/sales-os";

type PoolRow = { n: string; e: string; r: string; t: string; p: string; c: string; s: string; d: string };

const STATES: Record<string, string> = { NORDRHEIN_WESTFALEN: "Nordrhein-Westfalen", BADEN_WUERTTEMBERG: "Baden-Württemberg", BAYERN: "Bayern", NIEDERSACHSEN: "Niedersachsen", HESSEN: "Hessen", RHEINLAND_PFALZ: "Rheinland-Pfalz", SAARLAND: "Saarland", SACHSEN: "Sachsen", BERLIN: "Berlin", BRANDENBURG: "Brandenburg", HAMBURG: "Hamburg", BREMEN: "Bremen", THUERINGEN: "Thüringen", SACHSEN_ANHALT: "Sachsen-Anhalt", SCHLESWIG_HOLSTEIN: "Schleswig-Holstein", MECKLENBURG_VORPOMMERN: "Mecklenburg-Vorpommern" };

async function ensurePool() {
  await query(`create table if not exists pflege_pool (
    email text primary key, name text not null, ref text, title text, published text, city text, state text,
    status text not null default 'pending', checked_at timestamptz, created_at timestamptz not null default now())`);
  const [{ n }] = await query<{ n: number }>("select count(*)::int n from pflege_pool");
  const rows = pool as PoolRow[];
  if (Number(n) >= rows.length) return;
  for (let i = 0; i < rows.length; i += 400) {
    await query(
      `insert into pflege_pool (email,name,ref,title,published,city,state)
       select x->>'e',x->>'n',x->>'r',x->>'t',x->>'p',x->>'c',x->>'s' from jsonb_array_elements($1::jsonb) x on conflict (email) do nothing`,
      [JSON.stringify(rows.slice(i, i + 400).map(({ d: _d, ...rest }) => rest))],
    );
  }
}

export async function pflegePoolStats() {
  await ensurePool();
  const rows = await query<{ status: string; n: number }>("select status,count(*)::int n from pflege_pool group by 1");
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

export async function processPflegePool({ limit = 40, budgetMs = 200_000 }: { limit?: number; budgetMs?: number } = {}) {
  await ensurePool();
  await query("update pflege_pool set status='pending' where status='checking' and checked_at<now()-interval '15 minutes'");
  const byEmail = new Map((pool as PoolRow[]).map((row) => [row.e, row]));
  const startedAt = Date.now();
  let checked = 0, added = 0;
  while (Date.now() - startedAt < budgetMs - 25_000 && added < limit) {
    const rows = await query<{ email: string }>(
      "update pflege_pool set status='checking', checked_at=now() where email in (select email from pflege_pool where status='pending' order by published asc limit 12 for update skip locked) returning email",
    );
    if (!rows.length) break;
    await Promise.all(rows.map(async ({ email }) => {
      const row = byEmail.get(email);
      try {
        checked++;
        if (!row) { await query("update pflege_pool set status='skipped' where email=$1", [email]); return; }
        const clean = evaluatePflegePoolRow(row);
        if (!clean) { await query("update pflege_pool set status='skipped' where email=$1", [email]); return; }
        const dup = await query("select 1 from sales_contacts where workspace='default' and lower(email)=lower($1) limit 1", [clean]);
        if (dup.length) { await query("update pflege_pool set status='duplicate' where email=$1", [email]); return; }
        if (!(await adStillOpen(row.r))) { await query("update pflege_pool set status='expired' where email=$1", [email]); return; }
        const sourceId = `ba:pool-${row.r}`;
        await persistRadarLead({ id: sourceId, company: row.n, contact: "", email: clean, phone: "", website: "", city: row.c, industry: "Pflege", source: "ba-jobboerse" }, { email: clean } as never, undefined, "default");
        await query(
          "update sales_companies set source='ba-jobboerse', metadata=coalesce(metadata,'{}'::jsonb)||$2::jsonb, updated_at=now() where workspace='default' and source_id=$1",
          [sourceId, JSON.stringify({ source: "ba-jobboerse", via: "pflege-pool", jobTitle: row.t, jobPublishedAt: row.p, jobAdUrl: `https://www.arbeitsagentur.de/jobsuche/jobdetail/${row.r}`, state: STATES[row.s] || row.s, category: "ambulatory_care" })],
        );
        await query("update pflege_pool set status='lead' where email=$1", [email]);
        added++;
      } catch {
        await query("update pflege_pool set status='pending' where email=$1", [email]).catch(() => null);
      }
    }));
  }
  return { checked, added, seconds: Math.round((Date.now() - startedAt) / 1000) };
}

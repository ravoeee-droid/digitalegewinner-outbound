import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { query, db, log, sleep } from "./lib.mjs";
import { enrichWebsite } from "./enrichers/website.mjs";
import { enrichMetaAds } from "./enrichers/meta-ads.mjs";
import { enrichGoogleAds } from "./enrichers/google-ads.mjs";
import { enrichSocial } from "./enrichers/social.mjs";
import { runLearning, applyBoosts } from "./learn.mjs";

const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY || 3);
const BATCH = Number(process.env.WORKER_BATCH || 12);
const WORKSPACE = process.env.WORKSPACE_ID || "default";

async function ensureSchema() {
  const sql = await readFile(new URL(process.env.MIGRATION_FILE || "./schema.sql", import.meta.url), "utf8");
  await db().query(sql);
}

async function save(companyId, source, result, error = "") {
  await query(`insert into lead_enrichment(company_id,source,status,data,error,fetched_at) values($1,$2,$3,$4::jsonb,$5,now())
    on conflict(company_id,source) do update set status=$3,data=$4::jsonb,error=$5,fetched_at=now()`,
    [companyId, source, result?.status || "error", JSON.stringify(result?.data || {}), error.slice(0, 300)]);
}

// Gefundene Kontaktdaten nur ergänzen, nie überschreiben.
async function fillGaps(company, web) {
  if (!web) return;
  if (!company.phone && web.phones?.[0]) await query("update sales_companies set phone=$2,updated_at=now() where id=$1 and coalesce(phone,'')=''", [company.id, web.phones[0]]);
  const has = await query("select 1 from sales_contacts where company_id=$1 and coalesce(email,'')<>'' limit 1", [company.id]);
  const email = web.emails?.find((e) => !/^(?:noreply|no-reply|datenschutz|privacy)@/i.test(e));
  if (!has.length && email) {
    await query(`insert into sales_contacts(id,workspace,company_id,name,email,phone,source,metadata) values($1,$2,$3,$4,$5,$6,'worker-website','{}'::jsonb)`,
      [`wk-${randomUUID()}`, WORKSPACE, company.id, web.people?.[0]?.name || "", email, web.phones?.[0] || ""]);
  }
}

async function enrichCompany(company) {
  const run = async (source, fn) => {
    try { const r = await fn(); await save(company.id, source, r); return r; }
    catch (e) { await save(company.id, source, { status: "error" }, String(e.message || e)); log(`  ${company.name} · ${source}: ${e.message}`); return null; }
  };
  const web = await run("website", () => enrichWebsite(company));
  const webData = web?.status === "ok" ? web.data : null;
  const [meta, google, social] = await Promise.all([
    run("meta_ads", () => enrichMetaAds(company)), run("google_ads", () => enrichGoogleAds(company)), run("social", () => enrichSocial(company, webData)),
  ]);
  await fillGaps(company, webData);
  const summary = { at: new Date().toISOString(), tech: webData?.tech || [], tracking: webData?.tracking || [], runsMetaAds: meta?.data?.runsAds ?? null, runsGoogleAds: google?.data?.runsAds ?? null, social: Object.keys(webData?.social || {}) };
  await query("update sales_companies set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('enrichment',$2::jsonb),updated_at=now() where id=$1", [company.id, JSON.stringify(summary)]);
}

// Priorität: Leads mit aktivem Lead-Eintrag und hohem Score zuerst; Erfolge 14 Tage, Fehler 2 Tage Ruhe.
async function nextBatch() {
  return query(`select c.id,c.name,c.domain,c.website,c.phone,c.city from sales_companies c
    where c.workspace=$1 and coalesce(c.website,'')<>''
      and not exists(select 1 from lead_enrichment e where e.company_id=c.id and e.source='website'
        and e.fetched_at > now() - case when e.status in ('ok','blocked') then interval '14 days' else interval '2 days' end)
    order by exists(select 1 from sales_leads l where l.company_id=c.id and l.status='active') desc, c.latest_score desc nulls last limit $2`, [WORKSPACE, BATCH]);
}

async function main() {
  const [{ locked }] = await query("select pg_try_advisory_lock(4242001) locked");
  if (!locked) { log("Anderer Worker läuft bereits, beende."); process.exit(0); }
  await ensureSchema();
  log(`Worker gestartet · Workspace ${WORKSPACE} · Meta ${process.env.META_ACCESS_TOKEN ? "an" : "aus"} · Google ${process.env.SERPAPI_KEY ? "an" : "aus"} · Social-Provider ${process.env.SOCIAL_SCRAPER_URL ? "an" : "OG-Modus"}`);
  let lastLearn = 0;
  for (;;) {
    try {
      const batch = await nextBatch();
      if (!batch.length) { log("Nichts zu tun, warte 5 Minuten."); await sleep(300_000); }
      else {
        const queue = [...batch];
        await Promise.all(Array.from({ length: CONCURRENCY }, async () => { for (let c; (c = queue.shift());) { log(`→ ${c.name}`); await enrichCompany(c); } }));
        log(`Batch fertig (${batch.length})`);
      }
      if (Date.now() - lastLearn > 3600_000) { lastLearn = Date.now(); await runLearning(); if (process.env.LEARN_APPLY !== "0") await applyBoosts(); }
    } catch (e) { log("Loop-Fehler:", e.message); await sleep(30_000); }
  }
}
main();

import { query } from "@/lib/db";
import { ensureSalesOsSchema, persistRadarLead } from "@/lib/sales-os";
import { buildDailyOutboundPlan } from "@/lib/outbound-engine";

export const runtime = "nodejs";
export const maxDuration = 300;

const INDEX_URLS = [
  "https://www.pflegedienstjobs24.de/nordrhein-westfalen",
  "https://www.pflegedienstjobs24.de/koeln",
  "https://www.pflegedienstjobs24.de/duesseldorf",
  "https://www.pflegedienstjobs24.de/bonn",
  "https://www.pflegedienstjobs24.de/leverkusen",
  "https://www.pflegedienstjobs24.de/bergisch-gladbach",
  "https://www.pflegedienstjobs24.de/aachen",
  "https://www.pflegedienstjobs24.de/moenchengladbach",
  "https://www.pflegedienstjobs24.de/krefeld",
  "https://www.pflegedienstjobs24.de/duisburg",
  "https://www.pflegedienstjobs24.de/essen",
  "https://www.pflegedienstjobs24.de/bochum",
  "https://www.pflegedienstjobs24.de/wuppertal",
  "https://www.pflegedienstjobs24.de/solingen",
  "https://www.pflegedienstjobs24.de/remscheid",
  "https://www.pflegedienstjobs24.de/siegburg",
  "https://www.pflegedienstjobs24.de/troisdorf",
  "https://www.pflegedienstjobs24.de/dueren",
  "https://www.pflegedienstjobs24.de/euskirchen",
  "https://www.pflegedienstjobs24.de/erftstadt",
  "https://www.pflegedienstjobs24.de/huerth",
  "https://www.pflegedienstjobs24.de/frechen",
];

const EXCLUDED = /(caritas|arbeiterwohlfahrt|\bawo\b|johanniter|diakonie|deutsches rotes kreuz|\bdrk\b|malteser|\basb\b|\bbrk\b|lebenshilfe|stiftung|ggmbh|gemeinnützig|zeitarbeit|personalvermittlung|personaldienst|staffing)/i;
const LOW_VALUE_ROLE = /(ausbildung|azubi|fsj|praktikum)/i;

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET;
  return Boolean(expected && (request.headers.get("authorization") || "") === `Bearer ${expected}`);
}
function decodeHtml(value: string) {
  return value
    .replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ").replace(/&ndash;|&#8211;/gi, "–").replace(/&mdash;|&#8212;/gi, "—");
}
function stripHtml(html: string) {
  return decodeHtml(
    html.replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<\/(p|div|li|h\d|section|article|br)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  ).replace(/[ \t]+/g, " ").replace(/\n\s+/g, "\n").trim();
}
function attr(html: string, name: string) {
  const re = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["']`, "i");
  const reverse = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${name}["']`, "i");
  return decodeHtml((html.match(re)?.[1] || html.match(reverse)?.[1] || "").trim());
}
async function fetchHtml(url: string) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { "user-agent": "DigitaleGewinner-PflegeSource/1.0", accept: "text/html,application/xhtml+xml" },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}
function absolute(base: string, href: string) {
  try { return new URL(href, base).toString(); } catch { return ""; }
}
function jobLinks(html: string, base: string) {
  const out = new Set<string>();
  for (const m of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    const url = absolute(base, decodeHtml(m[1]));
    if (!url.startsWith("https://www.pflegedienstjobs24.de/")) continue;
    if (!/\/(pflegefachkraft|pflegehelfer|pflegedienstleitung|pflegedienstfahrer)\//i.test(url)) continue;
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    if (parts.length >= 4) out.add(url.split("#")[0]);
  }
  return [...out];
}
function homepageFromHtml(html: string, detailUrl: string) {
  const links: string[] = [];
  for (const m of html.matchAll(/href\s*=\s*["'](https?:\/\/[^"']+)["']/gi)) {
    const url = decodeHtml(m[1]).trim();
    if (!url || url.includes("pflegedienstjobs24.de")) continue;
    if (/(facebook|instagram|linkedin|youtube|tiktok|xing)\.com/i.test(url)) continue;
    links.push(url);
  }
  return links.find(Boolean) || "";
}
function titleCaseSlug(slug: string) {
  return slug.split("-").filter(Boolean).map(p => p ? p[0].toUpperCase()+p.slice(1) : p).join(" ");
}
function contactFromText(text: string) {
  const direct = text.match(/\b(Frau|Herr)\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß.'-]+(?:\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüß.'-]+){0,2})/);
  if (direct) return `${direct[1]} ${direct[2]}`;
  const role = text.match(/\b(Geschäftsführer(?:in)?|Einrichtungsleitung|Pflegedienstleitung|Heimleitung)\b\s*[:\-]?\s*((?:[A-ZÄÖÜ][A-Za-zÄÖÜäöüß.'-]+\s+){1,2}[A-ZÄÖÜ][A-Za-zÄÖÜäöüß.'-]+)/);
  return role?.[2] || "";
}
function roleClass(title: string) {
  if (/(pflegefachkraft|pflegefachmann|pflegefachfrau|altenpfleger|gesundheits- und krankenpfleger|examiniert)/i.test(title)) return "Pflegefachkraft";
  if (/(pflegedienstleitung|\bpdl\b|wohnbereichsleitung|teamleitung pflege)/i.test(title)) return "Pflegedienstleitung";
  if (/(pflegehelfer|pflegeassist|pflegefachassist|pflegehilfskraft)/i.test(title)) return "Pflegeassistenz";
  return "Pflege";
}
function parseDetail(url: string, html: string) {
  const description = attr(html, "description") || attr(html, "og:description");
  const match = description.match(/^(.*?)\s+sucht:\s*(.*?)\.\s*Jetzt bewerben!?$/i);
  const text = stripHtml(html);
  const company = (match?.[1] || text.match(/Stellenangebot[^\n]*,\s*([^\n]+)/i)?.[1] || "").trim();
  const jobTitle = (match?.[2] || "").trim();
  const date = text.match(new RegExp(company.replace(/[.*+?^$()|[\]{}\\]/g, "\\$&")+"\\s+vom\\s+(\\d{2}\\.\\d{2}\\.\\d{4})", "i"))?.[1] || "";
  const path = new URL(url).pathname.split("/").filter(Boolean);
  const city = titleCaseSlug(path[0] || "");
  const category = path[1] || "";
  const workload = (text.match(/Arbeitsumfang:\\s*([^\\n]+)/i)?.[1] || text.match(/\\b(Vollzeit(?:\\s+oder\\s+Teilzeit|\\s*\\/\\s*Teilzeit)?)\\b/i)?.[1] || "").trim();
  let ageDays = -1;
  if (date) { const [d,m,y]=date.split(".").map(Number); ageDays=Math.floor((Date.now()-new Date(y,m-1,d).getTime())/86400000); }
  return {
    company,
    jobTitle,
    publishedAt: date,
    city,
    category,
    homepage: homepageFromHtml(html, url),
    contact: contactFromText(text),
    roleClass: roleClass(jobTitle),
    workload,
    ageDays,
    adUrl: url,
  };
}
function ownerFor(seed: string) {
  let h=0; for (let i=0;i<seed.length;i++) h=((h<<5)-h)+seed.charCodeAt(i);
  return Math.abs(h)%2===0 ? "Raphael" : "Mattias";
}
function scoreFor(role: string, publishedAt: string) {
  let score = role === "Pflegedienstleitung" ? 96 : role === "Pflegefachkraft" ? 94 : 88;
  if (publishedAt) {
    const [d,m,y]=publishedAt.split(".").map(Number);
    const age=Math.floor((Date.now()-new Date(y,m-1,d).getTime())/86400000);
    if (age >= 30) score += 3;
    else if (age <= 7) score -= 2;
  }
  return Math.max(70,Math.min(99,score));
}

async function ensureSyncSchema() {
  await ensureSalesOsSchema();
  await query(`
    create table if not exists pflege_source_sync_runs(
      id text primary key,
      status text not null default 'running',
      total integer not null default 0,
      processed integer not null default 0,
      imported integer not null default 0,
      skipped integer not null default 0,
      failed integer not null default 0,
      started_at timestamptz not null default now(),
      completed_at timestamptz,
      quality_version text not null default ''
    );
    alter table pflege_source_sync_runs add column if not exists quality_version text not null default '';
    create table if not exists pflege_source_jobs(
      run_id text not null references pflege_source_sync_runs(id) on delete cascade,
      url text not null,
      status text not null default 'pending',
      company text not null default '',
      job_title text not null default '',
      homepage text not null default '',
      contact text not null default '',
      city text not null default '',
      role_class text not null default '',
      published_at text not null default '',
      error text not null default '',
      updated_at timestamptz not null default now(),
      primary key(run_id,url)
    );
    create index if not exists pflege_source_jobs_status_idx on pflege_source_jobs(run_id,status,updated_at);
  `);
}

async function prepareRun() {
  const runId = crypto.randomUUID();
  const pages = await Promise.allSettled(INDEX_URLS.map(async url => ({url,html:await fetchHtml(url)})));
  const urls = new Set<string>();
  for (const page of pages) if (page.status === "fulfilled") jobLinks(page.value.html,page.value.url).forEach(u=>urls.add(u));
  await query(`insert into pflege_source_sync_runs(id,total,quality_version) values($1,$2,\'pflegefachkraft_fulltime_60d_v4\')`,[runId,urls.size]);
  for (const url of urls) {
    await query(`insert into pflege_source_jobs(run_id,url) values($1,$2) on conflict do nothing`,[runId,url]);
  }
  return { runId, total: urls.size };
}

async function processOne(runId: string, url: string) {
  try {
    const html = await fetchHtml(url);
    const d = parseDetail(url,html);
    if (!d.company || !d.jobTitle) throw new Error("Arbeitgeber/Stellentitel nicht erkannt");

    const fullTimeOk = /\\bvollzeit\\b/i.test(d.workload);
    const ageOk = d.ageDays >= 60;
    if (EXCLUDED.test(d.company) || LOW_VALUE_ROLE.test(d.jobTitle) || d.roleClass !== "Pflegefachkraft" || !fullTimeOk || !ageOk) {
      const reason = EXCLUDED.test(d.company) ? "excluded-employer"
        : d.roleClass !== "Pflegefachkraft" ? "wrong-role"
        : !fullTimeOk ? "no-fulltime"
        : !ageOk ? "under-60-days"
        : "excluded";
      await query(`update pflege_source_jobs set status='skipped',company=$3,job_title=$4,homepage=$5,contact=$6,city=$7,role_class=$8,published_at=$9,error=$10,updated_at=now() where run_id=$1 and url=$2`,
        [runId,url,d.company,d.jobTitle,d.homepage,d.contact,d.city,d.roleClass,d.publishedAt,reason]);
      return "skipped";
    }

    const sourceSlug = new URL(url).pathname.split("/").filter(Boolean)[2] || d.company.toLowerCase().replace(/[^a-z0-9]+/g,"-");
    const persisted = await persistRadarLead({
      id:`pdj24:${sourceSlug}`,
      company:d.company,
      contact:d.contact,
      email:"",
      phone:"",
      website:d.homepage,
      city:d.city,
      industry:"Pflege",
      source:"pflegedienstjobs24",
    },{},undefined,"default");

    const priority=scoreFor(d.roleClass,d.publishedAt);
    const owner=ownerFor(d.company);
    await query(`
      update sales_companies
      set source='pflegedienstjobs24',
          metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
            'source','pflegedienstjobs24',
            'sourceRunId',$2::text,
            'jobAdUrl',$3::text,
            'jobTitle',$4::text,
            'jobRole',$5::text,
            'jobPublishedAt',$6::text,
            'jobAds',coalesce(metadata->'jobAds','[]'::jsonb) || $7::jsonb
          ),
          updated_at=now()
      where id=$1
    `,[persisted.companyId,runId,d.adUrl,d.jobTitle,d.roleClass,d.publishedAt,JSON.stringify([{url:d.adUrl,title:d.jobTitle,publishedAt:d.publishedAt}])]);
    await query(`
      update sales_leads
      set owner=$2,intent_score=95,fit_score=85,opportunity_score=90,priority_score=$3,
          notes=$4,status='active',stage=case when stage='Verloren' then 'Neu' else stage end,updated_at=now()
      where id=$1
    `,[persisted.leadId,owner,priority,`${d.roleClass}: ${d.jobTitle} · Anzeige: ${d.adUrl}${d.publishedAt ? ` · seit ${d.publishedAt}` : ""}`]);

    await query(`update pflege_source_jobs set status='imported',company=$3,job_title=$4,homepage=$5,contact=$6,city=$7,role_class=$8,published_at=$9,updated_at=now() where run_id=$1 and url=$2`,
      [runId,url,d.company,d.jobTitle,d.homepage,d.contact,d.city,d.roleClass,d.publishedAt]);
    return "imported";
  } catch (error) {
    await query(`update pflege_source_jobs set status='failed',error=$3,updated_at=now() where run_id=$1 and url=$2`,
      [runId,url,error instanceof Error?error.message:"Fehler"]);
    return "failed";
  }
}

async function archiveOldActiveLeads(runId: string) {
  await query(`
    update sales_leads l
       set status='archived',updated_at=now()
      from sales_companies c
     where l.company_id=c.id and l.workspace='default' and l.status='active'
       and l.stage in ('Neu','Research','Bereit','Kontaktiert')
       and coalesce(c.metadata->>'sourceRunId','')<>$1
  `,[runId]);
  await query(`
    delete from sales_outbound_tasks t
    using sales_leads l,sales_companies c
    where t.lead_id=l.id and l.company_id=c.id and t.workspace='default'
      and l.status='archived'
  `);
}

async function finalize(runId: string) {
  await query(`
    update sales_leads l
       set status='archived',updated_at=now()
      from sales_companies c
     where l.company_id=c.id and l.workspace='default' and l.status='active'
       and l.stage in ('Neu','Research','Bereit','Kontaktiert')
       and coalesce(c.metadata->>'sourceRunId','')<>$1
  `,[runId]);
  await query(`
    delete from sales_outbound_tasks t
    using sales_leads l,sales_companies c
    where t.lead_id=l.id and l.company_id=c.id and t.workspace='default'
      and coalesce(c.metadata->>'sourceRunId','')<>$1
  `,[runId]);
  const [counts]=await query<{processed:number;imported:number;skipped:number;failed:number}>(`
    select count(*) filter(where status<>'pending')::int processed,
           count(*) filter(where status='imported')::int imported,
           count(*) filter(where status='skipped')::int skipped,
           count(*) filter(where status='failed')::int failed
    from pflege_source_jobs where run_id=$1
  `,[runId]);
  await query(`update pflege_source_sync_runs set status='complete',processed=$2,imported=$3,skipped=$4,failed=$5,completed_at=now() where id=$1`,
    [runId,counts?.processed||0,counts?.imported||0,counts?.skipped||0,counts?.failed||0]);
  await buildDailyOutboundPlan("default");
  return counts;
}

async function runSync() {
  await ensureSyncSchema();
  const running=await query<{id:string}>(`select id from pflege_source_sync_runs where status='running' order by started_at desc limit 1`);
  let runId=running[0]?.id;
  if (!runId) {
    const recent=await query<{id:string}>(`select id from pflege_source_sync_runs where status='complete' and quality_version='pflegefachkraft_fulltime_60d_v4' and completed_at>now()-interval '20 hours' order by completed_at desc limit 1`);
    if (recent[0]) return {ok:true,status:"fresh",runId:recent[0].id};
    const prepared=await prepareRun();
    runId=prepared.runId;
  }

  await archiveOldActiveLeads(runId);
  const jobs=await query<{url:string}>(`select url from pflege_source_jobs where run_id=$1 and status='pending' order by url limit 72`,[runId]);
  if (!jobs.length) return {ok:true,status:"complete",runId,counts:await finalize(runId)};

  const results:string[]=[];
  for (let i=0;i<jobs.length;i+=9) {
    const batch=jobs.slice(i,i+9);
    const part=await Promise.all(batch.map(j=>processOne(runId!,j.url)));
    results.push(...part);
  }
  const [remaining]=await query<{n:number}>(`select count(*)::int n from pflege_source_jobs where run_id=$1 and status='pending'`,[runId]);
  const [counts]=await query<{imported:number;skipped:number;failed:number}>(`
    select count(*) filter(where status='imported')::int imported,
           count(*) filter(where status='skipped')::int skipped,
           count(*) filter(where status='failed')::int failed
    from pflege_source_jobs where run_id=$1`,[runId]);
  if ((remaining?.n||0)===0) return {ok:true,status:"complete",runId,counts:await finalize(runId)};
  return {ok:true,status:"running",runId,processedThisRun:results.length,remaining:remaining?.n||0,counts};
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({error:"Unauthorized"},{status:401});
  try {
    const result=await runSync();
    console.log("[pflege-source-sync]",JSON.stringify(result));
    return Response.json(result);
  }
  catch(error){
    console.error("[pflege-source-sync-error]",error);
    return Response.json({ok:false,error:error instanceof Error?error.message:"Sync failed"},{status:500});
  }
}
export async function POST(request: Request) { return GET(request); }

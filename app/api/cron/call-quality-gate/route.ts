import { query } from "@/lib/db";
import { ensureSalesOsSchema } from "@/lib/sales-os";
import { buildDailyOutboundPlan } from "@/lib/outbound-engine";

export const runtime = "nodejs";
export const maxDuration = 300;

const VERSION = "pflegefachkraft_fulltime_60d_v1";
const EXCLUDED = /(caritas|arbeiterwohlfahrt|\bawo\b|johanniter|diakonie|deutsches rotes kreuz|\bdrk\b|malteser|\basb\b|\bbrk\b|stiftung|verein|gGmbH|zeitarbeit|personalvermittlung|personaldienst)/i;

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET;
  return Boolean(expected && (request.headers.get("authorization") || "") === `Bearer ${expected}`);
}
function decode(value: string) {
  return value.replace(/&amp;/gi,"&").replace(/&nbsp;/gi," ").replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'");
}
function textOf(html: string) {
  return decode(html.replace(/<script\b[\s\S]*?<\/script>/gi," ").replace(/<style\b[\s\S]*?<\/style>/gi," ").replace(/<\/(p|div|li|h\d|section|article|br)>/gi,"\n").replace(/<br\s*\/?>/gi,"\n").replace(/<[^>]+>/g," ")).replace(/[ \t]+/g," ").replace(/\n\s+/g,"\n");
}
function ageDays(date: string) {
  const m = date.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!m) return -1;
  return Math.floor((Date.now()-new Date(Number(m[3]),Number(m[2])-1,Number(m[1])).getTime())/86400000);
}
async function verify(url: string, company: string) {
  if (!url || !url.startsWith("https://www.pflegedienstjobs24.de/")) return {ok:false,reason:"kein gültiger Stellenlink"};
  try {
    const res = await fetch(url,{cache:"no-store",headers:{"user-agent":"DigitaleGewinner-CallQA/1.0"},signal:AbortSignal.timeout(12000)});
    if (!res.ok) return {ok:false,reason:`Anzeige HTTP ${res.status}`};
    const text = textOf(await res.text());
    const title = (text.match(/sucht:\s*([^\n.]+)/i)?.[1] || text.match(/Pflegefachkraft[^\n]*/i)?.[0] || "").trim();
    const published = text.match(/\bvom\s+(\d{2}\.\d{2}\.\d{4})/i)?.[1] || "";
    const workload = (text.match(/Arbeitsumfang:\s*([^\n]+)/i)?.[1] || "").trim();
    const roleOk = /(pflegefachkraft|pflegefachmann|pflegefachfrau|altenpfleger|gesundheits- und krankenpfleger|examiniert)/i.test(title);
    const fulltime = /\bVollzeit\b/i.test(workload) || /\bin Vollzeit\b/i.test(text);
    const age = ageDays(published);
    const excluded = EXCLUDED.test(company);
    return {ok:roleOk && fulltime && age>=60 && !excluded,reason:excluded?"Ausschluss-Träger":!roleOk?"keine Pflegefachkraft":!fulltime?"kein Vollzeit-Angebot":age<60?`nur ${age} Tage offen`:"ok",title,published,workload,age};
  } catch (e) {
    return {ok:false,reason:e instanceof Error?e.message:"Prüfung fehlgeschlagen"};
  }
}

async function run() {
  await ensureSalesOsSchema();
  await query(`create table if not exists pflege_call_quality_runs(run_date date not null,version text not null,status text not null default 'running',qualified int not null default 0,rejected int not null default 0,started_at timestamptz not null default now(),completed_at timestamptz,primary key(run_date,version))`);
  const [done]=await query<{status:string;qualified:number;rejected:number}>(`select status,qualified,rejected from pflege_call_quality_runs where run_date=(now() at time zone 'Europe/Berlin')::date and version=$1`,[VERSION]);
  if (done?.status==="complete") return {ok:true,status:"already_complete",qualified:done.qualified,rejected:done.rejected};

  await query(`insert into pflege_call_quality_runs(run_date,version) values((now() at time zone 'Europe/Berlin')::date,$1) on conflict(run_date,version) do update set status='running',started_at=now(),completed_at=null`,[VERSION]);

  const rows=await query<{lead_id:string;company_id:string;company:string;job_url:string;score:number}>(`
    select l.id lead_id,c.id company_id,c.name company,coalesce(c.metadata->>'jobAdUrl','') job_url,l.priority_score score
    from sales_leads l join sales_companies c on c.id=l.company_id and c.workspace=l.workspace
    where l.workspace='default' and l.status='active' and l.stage in ('Neu','Research','Bereit')
      and l.owner in ('Raphael','Mattias') and coalesce(l.do_not_contact,false)=false
    order by l.priority_score desc,c.name asc
  `);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prüfergebnis hat je Fall unterschiedliche Felder
  const checked:any[]=[];
  for (let i=0;i<rows.length;i+=8) {
    const part=await Promise.all(rows.slice(i,i+8).map(async r=>({...r,check:await verify(r.job_url,r.company)})));
    checked.push(...part);
  }
  const good=checked.filter(x=>x.check.ok).sort((a,b)=>b.check.age-a.check.age || b.score-a.score);
  const bad=checked.filter(x=>!x.check.ok);

  if (bad.length) {
    await query(`update sales_leads set status='archived',updated_at=now() where id=any($1::text[]) and last_contact_at is null`,[bad.map(x=>x.lead_id)]);
    await query(`delete from sales_outbound_tasks where task_date=(now() at time zone 'Europe/Berlin')::date and channel='call' and lead_id=any($1::text[]) and status in ('ready','drafted','queued')`,[bad.map(x=>x.lead_id)]);
  }

  for (let i=0;i<good.length;i++) {
    const x=good[i];
    const owner=i%2===0?"Raphael":"Mattias";
    await query(`update sales_leads set status='active',owner=$2,priority_score=least(99,greatest(priority_score,90)+least(9,floor($3::numeric/30)::int)),updated_at=now() where id=$1`,[x.lead_id,owner,x.check.age]);
    await query(`update sales_companies set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('callQualityGate',$2::text,'jobVerifiedAt',now()::text,'jobAgeDays',$3::int,'jobWorkload',$4::text,'jobTitleVerified',$5::text,'jobPublishedAtVerified',$6::text),updated_at=now() where id=$1`,[x.company_id,VERSION,x.check.age,x.check.workload,x.check.title,x.check.published]);
  }

  await query(`delete from sales_outbound_tasks t using sales_leads l where t.lead_id=l.id and t.workspace='default' and t.task_date=(now() at time zone 'Europe/Berlin')::date and t.channel='call' and t.status in ('ready','drafted','queued')`);
  const snapshot=await buildDailyOutboundPlan("default");
  const raphael=snapshot.tasks.filter(t=>t.channel==="call" && String(t.payload?.owner||"")==="Raphael").length;
  const mattias=snapshot.tasks.filter(t=>t.channel==="call" && String(t.payload?.owner||"")==="Mattias").length;

  await query(`update pflege_call_quality_runs set status='complete',qualified=$2,rejected=$3,completed_at=now() where run_date=(now() at time zone 'Europe/Berlin')::date and version=$1`,[VERSION,good.length,bad.length]);
  return {ok:true,status:"complete",qualified:good.length,rejected:bad.length,raphael,mattias};
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({error:"Unauthorized"},{status:401});
  try { const result=await run(); console.log("[pflege-call-quality]",JSON.stringify(result)); return Response.json(result); }
  catch(e){ console.error("[pflege-call-quality-error]",e); return Response.json({ok:false,error:e instanceof Error?e.message:"failed"},{status:500}); }
}
export async function POST(request: Request){ return GET(request); }

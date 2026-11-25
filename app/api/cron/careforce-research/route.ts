import { Pool } from "pg";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as http } from "node:http";
import { request as https } from "node:https";

export const runtime = "nodejs";
export const maxDuration = 300;
type Job = { id: string; source_key: string; website: string; imprint_url: string; attempts: number };
type Page = { url: string; html: string };
let pool: Pool | undefined;
function db() {
  if (!process.env.CAREFORCE_DATABASE_URL) throw new Error("CARE FORCE database URL missing");
  return pool ??= new Pool({connectionString:process.env.CAREFORCE_DATABASE_URL,max:4,connectionTimeoutMillis:10000});
}
function public4(ip:string) {
  if(isIP(ip)!==4) return false;
  const [a,b,c]=ip.split(".").map(Number);
  return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===2)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);
}
async function page(raw:string, depth=0):Promise<Page>{
  const u=new URL(raw);
  if(depth>3||!["http:","https:"].includes(u.protocol)||u.username||u.password||u.port&&!["80","443"].includes(u.port)) throw new Error("Unsafe URL");
  const ip=(await lookup(u.hostname,{family:4})).address;
  if(!public4(ip)) throw new Error("Non-public IP");
  return new Promise((resolve,reject)=>{
    const req=(u.protocol==="https:"?https:http)(u,{family:4,lookup:(_host,_options,cb)=>cb(null,ip,4),headers:{"User-Agent":"CareForceResearch/1.0","Accept":"text/html"}},res=>{
      if([301,302,303,307,308].includes(res.statusCode||0)&&res.headers.location){res.resume();page(new URL(res.headers.location,u).href,depth+1).then(resolve,reject);return;}
      if(res.statusCode!==200||!/html/i.test(String(res.headers["content-type"]||""))){res.resume();reject(new Error("HTTP "+res.statusCode));return;}
      let html="",bytes=0;res.setEncoding("utf8");res.on("data",(chunk:string)=>{bytes+=Buffer.byteLength(chunk);if(bytes>1000000){req.destroy(new Error("Page too large"));return;}html+=chunk;});res.on("end",()=>resolve({url:u.href,html}));res.on("error",reject);
    });
    const timer=setTimeout(()=>req.destroy(new Error("Timeout")),7000);req.on("close",()=>clearTimeout(timer));req.on("error",reject);req.end();
  });
}
function clean(s:string){return s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi," ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/\s+/g," ").trim();}
function links(p:Page){return [...p.html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)].flatMap(m=>{try{return [new URL(m[1].replace(/&amp;/g,"&"),p.url)];}catch{return [];}});}
async function inspect(j:Job){
  const home=await page(j.website);
  const same=(u:URL)=>u.hostname.replace(/^www\./,"")===new URL(home.url).hostname.replace(/^www\./,"");
  const all=links(home);
  const imprintCandidates=[...all.filter(u=>same(u)&&/impressum|imprint/i.test(u.pathname)).map(u=>u.href)];
  if(j.imprint_url){try{if(same(new URL(j.imprint_url)))imprintCandidates.unshift(j.imprint_url);}catch{}}
  imprintCandidates.push(new URL("/impressum",home.url).href);
  let imprint:Page|undefined;
  for(const url of [...new Set(imprintCandidates)].slice(0,3)){try{const p=await page(url);if(same(new URL(p.url))&&/impressum|anbieterkennzeichnung|angaben gemäß/i.test(clean(p.html))){imprint=p;break;}}catch{}}
  const careerUrls=[...new Set(all.filter(u=>same(u)&&/karriere|stellenangebot|jobs|bewerb/i.test(u.pathname)).map(u=>u.href))].slice(0,3);
  const careers=await Promise.allSettled(careerUrls.map(url=>page(url)));
  const jobs=careers.flatMap(p=>{if(p.status!=="fulfilled")return [];const t=clean(p.value.html);const m=t.match(/(?:pflegefachkr[aä]ft\w*|pflegehelfer\w*|pflegefachmann|pflegefachfrau|pflegedienstleitung)/i);if(!m)return [];const excerpt=t.slice(Math.max(0,(m.index||0)-120),(m.index||0)+200);return /wir suchen|m\/w\/d|bewerben|ab sofort|offene stelle/i.test(excerpt)?[{url:p.value.url,excerpt}]:[];});
  const it=imprint?clean(imprint.html):"";
  const director=it.match(/(?:Geschäftsführ(?:er(?:in)?|ung)|vertreten durch)\s*[:–-]?\s*.{3,110}/i)?.[0]||"";
  const phones=imprint?[...new Set([...imprint.html.matchAll(/href=["']tel:([^"']+)["']/gi)].map(m=>m[1]))]:[];
  const findings=[...(!/<meta[^>]+name=["']viewport/i.test(home.html)?["Viewport-Metatag nicht gefunden"]:[]),...(!careerUrls.length?["Kein Karriere-Link auf Startseite erkannt"]:[])];
  const evidence={checkedAt:new Date().toISOString(),home:home.url,imprint:imprint?.url||null,directorExcerpt:director,phoneCandidates:phones,careerUrls,jobs,social:all.filter(u=>/^(www\.)?(facebook\.com|instagram\.com|linkedin\.com)$/.test(u.hostname)).map(u=>u.href).slice(0,10),findings,score:Math.min(100,jobs.length*30+findings.length*10),requiresManualReview:true};
  return evidence;
}
export async function GET(req:Request){
  if(!process.env.CRON_SECRET||req.headers.get("authorization")!=="Bearer "+process.env.CRON_SECRET)return Response.json({error:"Unauthorized"},{status:401});
  const start=Date.now();let checked=0,review=0,failed=0;
  while(Date.now()-start<190000){
    const {rows}=await db().query<Job>(`UPDATE careforce_research_queue SET status='running',attempts=attempts+1,lease_until=now()+interval '6 minutes',updated_at=now() WHERE id IN (SELECT id FROM careforce_research_queue WHERE ((status IN ('pending','retry') AND available_at<=now()) OR (status='running' AND lease_until<now())) AND attempts<4 ORDER BY priority DESC,id LIMIT 12 FOR UPDATE SKIP LOCKED) RETURNING id,source_key,website,imprint_url,attempts`);
    if(!rows.length)break;
    await Promise.all(rows.map(async j=>{checked++;try{const e=await inspect(j);await db().query("UPDATE careforce_research_queue SET status='review',evidence=$2::jsonb,lease_until=null,last_error=null,updated_at=now() WHERE id=$1 AND attempts=$3 AND status='running'",[j.id,JSON.stringify(e),j.attempts]);review++;}catch(err){await db().query("UPDATE careforce_research_queue SET status=CASE WHEN attempts>=4 THEN 'blocked' ELSE 'retry' END,available_at=now()+interval '1 hour',lease_until=null,last_error=$2,updated_at=now() WHERE id=$1 AND attempts=$3 AND status='running'",[j.id,String(err).slice(0,500),j.attempts]);failed++;}}));
  }
  return Response.json({checked,review,failed});
}

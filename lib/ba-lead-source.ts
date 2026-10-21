/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable prefer-const */
// Lead-Suche über die Stellenbörse der Bundesagentur für Arbeit (Port der früheren Supabase-Funktion pflege-email-outreach).
// Findet ambulante Pflegedienste und Intensivpflege mit offener Stelle, liest Webseite und Kontakt aus und legt sie als Lead an.
// Mails an Träger, Zeitarbeit, große Ketten und stationäre Heime werden aussortiert.
import { query } from "@/lib/db";
import { persistRadarLead } from "@/lib/sales-os";

const BA_BASE="https://rest.arbeitsagentur.de/jobboerse/jobsuche-service";
const BA_KEY="jobboerse-jobsuche";
const TERMS=["Pflegedienst Pflegefachkraft","ambulante Pflege Pflegefachkraft","Sozialstation Pflegefachkraft","Intensivpflege Pflegefachkraft","häusliche Krankenpflege","ambulanter Pflegedienst","Pflegedienstleitung ambulant","Pflegefachkraft ambulant","mobiler Pflegedienst","außerklinische Intensivpflege","Pflege zuhause Pflegefachkraft","ambulante Krankenpflege","Pflegeheim Pflegefachkraft","Seniorenzentrum Pflegefachkraft","Altenheim Pflegefachkraft","Seniorenresidenz Pflegefachkraft"];
const DAYS=[30,60,100];
const STAFF=/(randstad|adecco|manpower|tempton|persona service|personaservice|pluss|akut|avanti|piening|unique personal|in care|incare|all\.medi|medwing|pacura|felten|iperdimed|zeitarbeit|arbeitnehmerüberlass|arbeitnehmeruberlass|personaldienst|personalvermittlung|staffing|leiharbeit|recruiting agentur|personalmanagement|personalservice|arbeitsvermittlung|personal und |personal & |klinikpersonal|personalberatung|managementberatung|unternehmensberatung|personalleasing|personalagentur|pflegevermittlung|vermittlung)/i;
const BIG=/(universitätsklin|universitaetsklin|universitätsmedizin|klinikum|\bklinik\b|krankenhaus|charit[eé]|helios|asklepios|sana klin|korian|alloheim|caritas|diakonie|deutsches rotes kreuz|\bdrk\b|\bbrk\b|arbeiterwohlfahrt|\bawo\b|johanniter|malteser|lebenshilfe|deutsche fachpflege|renafan|advita|aiutanda|compassio|dorea|emeis|pro seniore|kursana|azurit|münchenstift|munchenstift|landkreis|stadtverwaltung|bundeswehr|holding|konzern|bundesweit|zentrale geschäftsführung|zentrale geschaeftsfuehrung)/i;
const INPATIENT=/(pflegeheim|altenheim|seniorenheim|seniorenzentrum|seniorenresidenz|pflegezentrum|pflegewohn|wohnstift|wohnpark|stationäre pflege|stationaere pflege|tagespflege|hospiz)/i;
const AMB=/(pflegedienst|ambulant|sozialstation|häusliche pflege|haeusliche pflege|häusliche krankenpflege|haeusliche krankenpflege|mobile pflege|mobiler pflege|pflegeteam|pflege zuhause|pflege zu hause)/i;
const INTENSIVE=/(intensivpflege|1:1 pflege|außerklinische intensiv|ausserklinische intensiv|beatmungspflege)/i;
const PORTAL=/(arbeitsagentur\.de|jobboerse|jobbörse|indeed\.|stepstone\.|meinestadt\.|kimeta\.|adzuna\.|talent\.com|xing\.com\/jobs|linkedin\.com\/jobs|joblift\.|jobrapido\.)/i;
const BAD_MAIL=/(crafthunt\.app|join\.com|personio\.(de|com)|softgarden\.(io|de)|onlyfy\.jobs|recruitee\.com|heyjobs\.co|jobware\.de|stellenanzeigen\.de|arbeitsagentur\.de|jobcenter\.|indeed\.|stepstone\.|meinestadt\.|kimeta\.|adzuna\.|talent\.com|joblift\.|jobrapido\.)$/i;

function norm(v:unknown){return String(v??"").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g," ").trim();}
function hash(v:string){let h=2166136261;for(let i=0;i<v.length;i++){h^=v.charCodeAt(i);h=Math.imul(h,16777619);}return(h>>>0).toString(16);}
function strings(v:unknown,out:string[]=[]):string[]{if(typeof v==="string")out.push(v);else if(Array.isArray(v))for(const x of v)strings(x,out);else if(v&&typeof v==="object")for(const x of Object.values(v as Record<string,unknown>))strings(x,out);return out;}
function first(o:Record<string,unknown>,ks:string[]){for(const k of ks){const v=o?.[k];if(typeof v==="string"&&v.trim())return v.trim();}return"";}
function ms(v:unknown){const x=Date.parse(String(v||""));return Number.isFinite(x)?x:0;}
function excluded(name:string,text=""){const v=`${name} ${text}`;return !name||STAFF.test(v)||BIG.test(v)||(SEG.key==="pv"&&UTILITY.test(name));}
function catPflege(name:string,text:string){const v=`${name} ${text}`;if(INTENSIVE.test(v))return"intensive_care";if(AMB.test(v)&&!INPATIENT.test(name))return"ambulatory_care";if(INPATIENT.test(name))return"inpatient_care";return"";}
const PV_MATCH=/(photovoltaik|\bsolar|\bpv[- ]?(anlage|montage|monteur|installa|techn|projekt|service)?\b|stromspeicher|wärmepumpe)/i;
const UTILITY=/(stadtwerke|\brwe\b|e\.on|\beon\b|enbw|vattenfall|siemens|bosch|enercon|vestas|senvion|sma solar|solarwatt|meyer burger|1komma5|enpal|zolar|thüga|innogy|\btüv\b|dekra|handwerkskammer|bundesagentur|jobcenter|hochschule|universität|fraunhofer|verband|energieversorg|netzbetreiber|netze\b|konzern)/i;
function catPv(name:string,text:string){return PV_MATCH.test(`${name} ${text}`)?"pv_installer":"";}
export type BaSegmentKey="pflege"|"pv";
const SEGMENTS={
  pflege:{key:"pflege" as BaSegmentKey,source:"ba-jobboerse",industry:"Pflege",terms:TERMS,match:(seed:string)=>AMB.test(seed)||INTENSIVE.test(seed)||INPATIENT.test(seed),cat:catPflege},
  pv:{key:"pv" as BaSegmentKey,source:"ba-pv",industry:"Photovoltaik",terms:["Photovoltaik Monteur","Solarteur","Photovoltaik Elektriker","Elektroniker Photovoltaik","Photovoltaikanlagen Installation","Solaranlagen Monteur","PV Projektleiter","Bauleiter Photovoltaik","Solartechnik Elektriker","Stromspeicher Installateur","Photovoltaik Dachmontage","PV Servicetechniker","Solar Montage","Elektriker Photovoltaik Wallbox","Energietechnik Photovoltaik"],match:(seed:string)=>PV_MATCH.test(seed),cat:catPv},
};
let SEG: { key: BaSegmentKey; source: string; industry: string; terms: string[]; match: (seed: string) => boolean; cat: (name: string, text: string) => string } = SEGMENTS.pflege;
function cat(name:string,text:string){return SEG.cat(name,text);}
const HR_MAIL=/^(bewerbung|bewerbungen|bewerber|karriere|jobs?|hr|personal|recruiting|career|careers|application|applications|stellen|ausbildung)[._-]?[a-z0-9]*@/i;
function mail(v:string){const e=String(v||"").trim().toLowerCase().replace(/^mailto:/,"").replace(/[>,;.)]+$/g,"");if(!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(e)||/^(no-?reply|noreply|donotreply)@/i.test(e))return"";if(SEG.key==="pv"&&HR_MAIL.test(e))return"";return BAD_MAIL.test(e.split("@")[1]||"")?"":e;}
function mailText(t:string){for(const x of t.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)||[]){const e=mail(x);if(e)return e;}return"";}
function phone(t:string){for(const m of t.matchAll(/(?:Tel\.?|Telefon|Mobil|Handy|Phone|href=["']tel:)\s*[:=]?\s*["']?((?:\+49|0049|0)[\d\s()\/-]{7,20})/gi)){let p=m[1].replace(/[^\d+]/g,"");if(p.startsWith("0049"))p=`+49${p.slice(4)}`;const d=p.replace(/\D/g,"");if(p.startsWith("+49")&&d.length>=11&&d.length<=14)return`+${d}`;if(d.startsWith("0")&&d.length>=9&&d.length<=13)return d;}return"";}
function person(t:string){const p=t.replace(/<[^>]+>/g," ").replace(/\s+/g," ");for(const r of [/(?:Geschäftsführer(?:in)?|Inhaber(?:in)?|Pflegedienstleitung|PDL|Ansprechpartner(?:in)?|Kontaktperson)\s*:?\s*(?:Herrn?|Frau)?\s*([A-ZÄÖÜ][A-Za-zÄÖÜäöüß'’.-]+\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüß'’.-]+)/g,/(?:Herr|Frau)\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß'’.-]+\s+[A-ZÄÖÜ][A-Za-zÄÖÜäöüß'’.-]+)/g])for(const m of p.matchAll(r)){const n=m[1].trim();if(n.length<61&&!/(Pflege|Team|Bewohner|Menschen|Kontakt|Bewerbung)/i.test(n))return n;}return"";}
function state(v:string){const t=norm(v),map:Array<[RegExp,string]>=[[/baden.wurttemberg|baden_wuerttemberg/,"Baden-Württemberg"],[/bayern/,"Bayern"],[/berlin/,"Berlin"],[/brandenburg/,"Brandenburg"],[/bremen/,"Bremen"],[/hamburg/,"Hamburg"],[/hessen/,"Hessen"],[/mecklenburg/,"Mecklenburg-Vorpommern"],[/niedersachsen/,"Niedersachsen"],[/nordrhein|nrw/,"Nordrhein-Westfalen"],[/rheinland.pfalz/,"Rheinland-Pfalz"],[/saarland/,"Saarland"],[/sachsen.anhalt/,"Sachsen-Anhalt"],[/sachsen/,"Sachsen"],[/schleswig.holstein/,"Schleswig-Holstein"],[/thuringen/,"Thüringen"]];for(const[r,l]of map)if(r.test(t))return l;return"Unbekannt";}
function loc(s:Record<string,unknown>,d:Record<string,unknown>){let a:Record<string,unknown>={};const dl=Array.isArray(d.stellenlokationen)?d.stellenlokationen as Record<string,unknown>[]:[],sl=Array.isArray(s.stellenlokationen)?s.stellenlokationen as Record<string,unknown>[]:[];if(dl[0]?.adresse&&typeof dl[0].adresse==="object")a=dl[0].adresse as Record<string,unknown>;else if(sl[0]?.adresse&&typeof sl[0].adresse==="object")a=sl[0].adresse as Record<string,unknown>;else if(d.arbeitgeberAdresse&&typeof d.arbeitgeberAdresse==="object")a=d.arbeitgeberAdresse as Record<string,unknown>;const street=first(a,["strasseHausnummer","strasse","straße"]),plz=String(a.plz||a.postleitzahl||""),city=first(a,["ort","stadt","city"]),region=first(a,["region","bundesland"]),address=[street,[plz,city].filter(Boolean).join(" "),region].filter(Boolean).join(", ");return{city,address,state:state(`${region} ${address}`)};}
function site(d:Record<string,unknown>,email:string){for(const x of strings(d))if(/^https?:\/\//i.test(x))try{const u=new URL(x);if(!PORTAL.test(u.hostname+u.pathname))return`${u.protocol}//${u.hostname}`;}catch{}const dm=email.split("@")[1]||"";return dm&&!BAD_MAIL.test(dm)?`https://${dm}`:"";}
async function fetchText(url:string){const c=new AbortController(),tm=setTimeout(()=>c.abort(),3500);try{const r=await fetch(url,{redirect:"follow",signal:c.signal,headers:{"User-Agent":"Mozilla/5.0 DigitaleGewinnerPflegeRadar/2.1"}});if(!r.ok||PORTAL.test(r.url))return{url:r.url||url,text:""};return{url:r.url,text:(await r.text()).slice(0,140000)};}catch{return{url,text:""};}finally{clearTimeout(tm);}}
async function inspect(website:string,needEmail:boolean){if(!website)return{url:"",email:"",phone:"",person:"",finding:"Keine eigene Website sicher erkannt",opp:94,career:false,form:false};const home=await fetchText(website);let text=home.text,email=mailText(text),ph=phone(text),per=person(text);if(needEmail&&!email&&home.url)try{const u=new URL(home.url).origin,x=await fetchText(`${u}/kontakt`);text+=`\n${x.text}`;email||=mailText(text);ph||=phone(text);per||=person(text);}catch{}const career=/(karriere|stellenangebote|jobs|bewerben|offene stellen)/i.test(text),form=/<form\b/i.test(text);let finding="Online-Auftritt mit Recruiting-Potenzial",opp=70;if(!text){finding="Website nicht zuverlässig erreichbar";opp=88;}else if(!career){finding="Kein klarer Karriere-/Bewerberweg erkannt";opp=92;}else if(!form){finding="Kein direktes Bewerbungsformular erkannt";opp=84;}return{url:home.url||website,email,phone:ph,person:per,finding,opp,career,form};}
async function ba(url:string){const c=new AbortController(),tm=setTimeout(()=>c.abort(),12000);try{const r=await fetch(url,{headers:{"X-API-Key":BA_KEY,Accept:"application/json"},signal:c.signal});if(!r.ok)throw new Error(`BA ${r.status}`);return await r.json();}finally{clearTimeout(tm);}}
async function detail(ref:string){try{return await ba(`${BA_BASE}/pc/v4/jobdetails/${encodeURIComponent(btoa(ref))}`) as Record<string,unknown>;}catch{return null;}}
async function build(ref:string,s:Record<string,unknown>,d:Record<string,unknown>){const name=String(d.firma||d.arbeitgeber||s.firma||s.arbeitgeber||"").trim(),text=strings(d).join("\n");if(excluded(name,text))return null;const category=cat(name,`${String(s.stellenangebotsTitel||s.beruf||s.hauptberuf||"")} ${text}`);if(!category)return null;const l=loc(s,d);if(l.state==="Unbekannt")return null;let email=mailText(text),website=site(d,email),ph=phone(text),per=person(text);const a=await inspect(website,!email);email=mail(email||a.email);ph||=a.phone;per||=a.person;if(!email)return null;const title=first(d,["stellenangebotsTitel","titel","beruf","hauptberuf"])||String(s.stellenangebotsTitel||s.beruf||"Pflegefachkraft"),pub=first(d,["datumErsteVeroeffentlichung","aktuelleVeroeffentlichungsdatum","veroeffentlichungsdatum"])||String((s.veroeffentlichungszeitraum as any)?.von||""),upd=first(d,["aenderungsdatum","modifikationsTimestamp","lastUpdatedAt"])||String(s.aenderungsdatum||pub),age=Math.max(0,Math.floor((Date.now()-Math.max(ms(upd),ms(pub),Date.now()-30*86400000))/86400000)),fresh=age<=7?100:age<=14?95:88,fit=category==="intensive_care"?100:98,access=Math.min(100,90+(ph?4:0)+(per?3:0)),score=Math.min(99,Math.round(94*.32+fit*.27+access*.21+fresh*.1+a.opp*.1));if(score<80)return null;const lead={id:`${SEG.key}-email-${hash(norm(name))}`,name,address:l.address,federalState:l.state,city:l.city,website:a.url||website,phone:ph,email,contactPerson:per,category,score,fitScore:fit,opportunityScore:a.opp,needScore:94,accessibilityScore:access,organizationRisk:"low",tier:"1A",callPriority:"1A",confidence:.96,recommendedOffer:"Premium-Websystem für Pflegedienste: Website + Bewerber/Kunden-Funnel + Terminbuchung + Automationen + Admin-Dashboard",pitch:`Aktive Stelle ${title} bestätigt. ${a.finding}.`,summary:`Aktiver Pflege-Personalbedarf · öffentliche Geschäfts-E-Mail · ${category==="intensive_care"?"Intensivpflege":"ambulanter Pflegedienst"}.`,status:"new",sourceType:"pflege-email-outreach-v2",scoringVersion:"pflege-email-1a-v2",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),jobReferences:[{title,referenceNumber:ref,url:`https://www.arbeitsagentur.de/jobsuche/jobdetail/${ref}`,publishingStartDate:pub||null,lastUpdatedAt:upd||pub||null}],signals:{hiringStatus:"confirmed",jobCount:1,jobTitles:[title],websiteAudit:{ok:!!a.url,career:a.career,form:a.form,finding:a.finding,opportunity:a.opp},points:["Aktive Pflege-Stelle bestätigt","Öffentliche Geschäfts-E-Mail verifiziert",a.finding,per?`Ansprechpartner: ${per}`:"Direkter Betriebskontakt"]}};return{key:`${norm(name)}|${l.state}`,lead};}

export const BA_SOURCE = "ba-jobboerse";
export const BA_SOURCES = ["ba-jobboerse", "ba-pv"];

async function ensureCursorTable() {
  await query("create table if not exists ba_source_cursor(day text primary key, cursor integer not null default 0, updated_at timestamptz not null default now())");
}

function berlinDay() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());
}

export async function countTodaysBaLeads(source: string = SEG.source) {
  const rows = await query<{ n: number }>("select count(*)::int n from sales_companies where workspace='default' and source=$1 and (created_at at time zone 'Europe/Berlin')::date=(now() at time zone 'Europe/Berlin')::date", [source]);
  return Number(rows[0]?.n || 0);
}

async function saveLead(l: Record<string, any>) {
  const sourceId = `ba:${l.id}`;
  const known = await query<{ id: string }>("select id from sales_companies where workspace='default' and source_id=$1 limit 1", [sourceId]);
  if (known.length) return false;
  const title = String(l.jobReferences?.[0]?.title || "Pflegefachkräfte");
  await persistRadarLead({ id: sourceId, company: l.name, contact: l.contactPerson || "", email: l.email, phone: l.phone || "", website: l.website || "", city: l.city || "", industry: SEG.industry, source: SEG.source }, { email: l.email, phone: l.phone || "" } as never, undefined, "default");
  await query(
    `update sales_companies set source=$2, metadata=coalesce(metadata,'{}'::jsonb) || $3::jsonb, updated_at=now() where workspace='default' and source_id=$1`,
    [sourceId, SEG.source, JSON.stringify({ source: SEG.source, jobTitle: title, jobAdUrl: l.jobReferences?.[0]?.url || "", jobPublishedAt: l.jobReferences?.[0]?.publishingStartDate || "", category: l.category, websiteFinding: l.signals?.websiteAudit?.finding || "", score: l.score })],
  );
  return true;
}

async function oneTask(cursor: number, seen: Set<string>) {
  const terms = SEG.terms, term = terms[cursor % terms.length], page = Math.floor(cursor / terms.length) % 5 + 1, days = DAYS[Math.floor(cursor / (terms.length * 5)) % DAYS.length];
  const q = new URLSearchParams({ was: term, page: String(page), size: "100", veroeffentlichtseit: String(days), angebotsart: "1", zeitarbeit: "false" });
  const data = await ba(`${BA_BASE}/pc/v6/jobs?${q}`) as any;
  const jobs = (Array.isArray(data.ergebnisliste) ? data.ergebnisliste : []) as Record<string, unknown>[];
  const filtered = jobs.filter((j) => { const n = String(j.firma || j.arbeitgeber || ""), seed = `${n} ${String(j.stellenangebotsTitel || j.beruf || j.hauptberuf || "")}`; return n && !excluded(n, seed) && SEG.match(seed); }).slice(0, 18);
  let added = 0;
  for (let i = 0; i < filtered.length; i += 6) {
    const batch = filtered.slice(i, i + 6);
    const details = await Promise.all(batch.map((j) => detail(String(j.referenznummer || j.refnr || ""))));
    const built = await Promise.all(batch.map((j, k) => details[k] ? build(String(j.referenznummer || j.refnr || ""), j, details[k] as Record<string, unknown>) : Promise.resolve(null)));
    for (const item of built) {
      if (!item || seen.has(item.key)) continue;
      seen.add(item.key);
      if (await saveLead(item.lead)) added += 1;
    }
  }
  return { added, term, page, days, raw: jobs.length, candidates: filtered.length };
}

// Sammelt neue Leads, bis das Tagesziel erreicht ist oder die Zeit knapp wird.
export async function collectBaLeads(options: { target?: number; budgetMs?: number; segment?: BaSegmentKey } = {}) {
  SEG = SEGMENTS[options.segment || "pflege"];
  const target = options.target ?? 100;
  const deadline = Date.now() + (options.budgetMs ?? 200_000);
  await ensureCursorTable();
  const day = `${berlinDay()}${SEG.key === "pflege" ? "" : ":" + SEG.key}`;
  const [row] = await query<{ cursor: number }>("select cursor from ba_source_cursor where day=$1", [day]);
  let cursor = Number(row?.cursor || 0);
  let have = await countTodaysBaLeads();
  let added = 0, tasks = 0;
  const seen = new Set<string>();
  const log: Array<Record<string, unknown>> = [];
  while (have < target && Date.now() < deadline - 25_000 && tasks < 40) {
    try {
      const result = await oneTask(cursor, seen);
      added += result.added; have += result.added; log.push(result);
    } catch (error) {
      log.push({ error: (error as Error)?.message || "Fehler", cursor });
    }
    cursor += 1; tasks += 1;
    await query("insert into ba_source_cursor(day,cursor) values($1,$2) on conflict(day) do update set cursor=excluded.cursor, updated_at=now()", [day, cursor]);
  }
  return { day, target, addedToday: have, addedThisRun: added, tasks, cursor, log: log.slice(-6) };
}

// Sucht auf der Webseite eines PV-Betriebs (Startseite, Impressum, Kontakt) eine Geschäfts-E-Mail; Bewerbungs-/Personaladressen zählen nicht.
export async function findPvSiteContact(website: string, segment: BaSegmentKey = "pv") {
  SEG = SEGMENTS[segment];
  const pick = (t: string, host: string) => {
    const all: string[] = [];
    for (const raw of t.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []) { const x = raw.replace(/^(u00[0-9a-f]{2}|%20|x[0-9a-f]{2})/i, ""); const e = mail(x); if (e && !/\.(png|jpe?g|gif|svg|webp|css|js)$/i.test(e) && !all.includes(e)) all.push(e); }
    return all.find((e) => e.endsWith(`@${host}`) || e.endsWith(`.${host}`)) || all.find((e) => !/(wixpress|sentry|example|domain\.|beispiel|muster)/i.test(e)) || "";
  };
  let origin = "", host = "";
  try { const u = new URL(website); origin = u.origin; host = u.hostname.replace(/^www\./, ""); } catch { return { email: "", phone: "", person: "" }; }
  let text = "", email = "";
  for (const path of ["", "/impressum", "/kontakt"]) {
    const x = await fetchText(origin + path);
    if (path === "" && !x.text) { const http = origin.replace(/^https:/, "http:"); if (http !== origin) { const y = await fetchText(http); text += `\n${y.text}`; } }
    text += `\n${x.text}`;
    email = pick(text, host);
    if (email) break;
  }
  return { email, phone: phone(text), person: person(text) };
}

// Für den Pflege-Bestand: Träger, Zeitarbeit, Ketten und stationäre Einrichtungen werden wie bei der Stellenbörse aussortiert.
export function isExcludedPflegeName(name: string) {
  SEG = SEGMENTS.pflege;
  return excluded(name);
}

// Anzeigen-Pool (Export der Stellenbörse): Passt der Arbeitgeber zur Pflege-Kampagne? Gibt die geprüfte Adresse zurück oder "".
export function evaluatePflegePoolRow(row: { n: string; e: string; t: string; d: string }) {
  SEG = SEGMENTS.pflege;
  if (excluded(row.n, row.t)) return "";
  if (!/(pflege|sozialstation|\bcare\b|betreuung|krankenpfleg|häusliche|haeusliche|intensiv|senioren|alten|residenz|stift|heim|wohn)/i.test(row.n)) return "";
  if (!SEG.cat(row.n, `${row.t} ${row.d}`)) return "";
  return mail(row.e);
}

// Prüft bei der Stellenbörse, ob die Anzeige noch online ist.
export async function adStillOpen(ref: string) {
  return (await detail(ref)) !== null || (await detail(ref)) !== null;
}

// Pflege-Betrieb aus einer Maps-Liste: Geschäfts-E-Mail suchen und prüfen, ob die Webseite eine offene Pflegestelle zeigt.
const JOB_ROLE = /(pflegefachkr[aä]ft\w*|pflegefachmann|pflegefachfrau|pflegekr[aä]ft\w*|altenpfleger\w*|gesundheits- und (?:kranken|alten)pfleger\w*|krankenschwester|krankenpfleger\w*|pflegehelfer\w*|pflegeassistent\w*|pflegedienstleitung|examinierte\w* pflege\w*)/i;
const JOB_SIGNAL = /(\(\s*[mwdfgx*\/]+(?:\s*[\/,]\s*[mwdfgx*]+)+\s*\)|[mwd]\s*\/\s*[wmd]\s*\/\s*[dxm]|wir suchen|stellenangebot|stellenanzeige|offene stelle|jetzt bewerben|verstärk\w* (?:unser|dein|ihr)|ab sofort|zum nächstmöglichen)/i;
export async function findPflegeSiteLead(website: string) {
  SEG = SEGMENTS.pflege;
  const contact = await findPvSiteContact(website, "pflege");
  if (!contact.email) return { ...contact, job: "" };
  let origin = "";
  try { origin = new URL(website).origin; } catch { return { ...contact, job: "" }; }
  const home = await fetchText(origin);
  const links = new Set<string>();
  for (const m of home.text.matchAll(/href=["']([^"'#]+)["']/gi)) {
    try { const u = new URL(m[1], origin); if (u.origin === origin && /(karriere|jobs?|stellen|bewerb|arbeiten-bei|offene-stellen)/i.test(u.pathname) && !/\.(pdf|jpg|png)$/i.test(u.pathname)) links.add(u.href); } catch { /* ungültiger Link */ }
    if (links.size >= 3) break;
  }
  if (!links.size) for (const p of ["/karriere", "/jobs", "/stellenangebote"]) links.add(origin + p);
  const pages = [home.text];
  for (const href of links) { const page = await fetchText(href); if (page.text) pages.push(page.text); }
  for (const raw of pages) {
    const text = raw.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, " ").replace(/\s+/g, " ");
    const role = text.match(JOB_ROLE);
    if (role && JOB_SIGNAL.test(text.slice(Math.max(0, (role.index || 0) - 200), (role.index || 0) + 300))) const r = role[0].toLowerCase(); return { ...contact, job: /pflegekr|pflegefachkr|pflegefachmann|pflegefachfrau|examinierte|krankenschwester|krankenpfleger|gesundheits-/.test(r) ? "Pflegefachkraft" : /pflegehelfer|pflegeassistent/.test(r) ? "Pflegehelfer" : /altenpfleger/.test(r) ? "Altenpfleger" : "Pflegefachkraft" };
  }
  return { ...contact, job: "" };
}

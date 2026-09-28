import { createHash, randomUUID } from "node:crypto";
import { promises as dns } from "node:dns";
import OpenAI from "openai";
import { z } from "zod";
import { query } from "@/lib/db";
import { recordOutboundEventByMode } from "@/lib/outbound-event-ledger";

export const RESEARCH_STRATEGY_VERSION="dg-research-2026-09-27-v1";
export const RESEARCH_PROMPT_VERSION="strategy-hypothesis-v1";

type CompanyRow={
  id:string;name:string;domain:string|null;website:string|null;city:string|null;industry:string|null;
  research_status:string|null;metadata:Record<string,unknown>;updated_at:Date;
};
type LeadRow={id:string;company_id:string|null;notes:string|null;stage:string|null;status:string|null};
type ResearchRun={id:string;company_id:string;lead_id:string|null;status:string;attempt:number;max_attempts:number};
type Evidence={
  id:string;
  evidenceKey:string;
  evidenceType:"website"|"career_page"|"job_signal"|"crm"|"public_page"|"operator"|"derived";
  claim:string;
  valueText:string|null;
  sourceUrl:string|null;
  sourceTitle:string|null;
  observedAt:string;
  confidence:number;
  contentHash:string|null;
  excerpt:string|null;
  metadata:Record<string,unknown>;
};
type StrategyHypothesis={
  segmentKey:string;
  hypothesis:string;
  audienceAngle:string;
  painStatement:string;
  valueProposition:string;
  proofRequirements:string[];
  confidence:number;
};

const reviewSchema=z.object({
  hypothesisId:z.string().uuid(),
  decision:z.enum(["approved","rejected"]),
  reason:z.string().min(3).max(2000),
});

function sha(value:string){return createHash("sha256").update(value).digest("hex")}
function normalizeUrl(raw:string|null|undefined){
  if(!raw)return null;
  let value=raw.trim();
  if(!/^https?:\/\//i.test(value))value="https://"+value;
  try{
    const url=new URL(value);
    if(!["http:","https:"].includes(url.protocol))return null;
    url.hash="";
    return url;
  }catch{return null}
}
function isPrivateIp(ip:string){
  if(ip==="::1"||ip==="0.0.0.0")return true;
  if(/^127\./.test(ip)||/^10\./.test(ip)||/^192\.168\./.test(ip))return true;
  const m=/^172\.(\d+)\./.exec(ip);
  if(m&&Number(m[1])>=16&&Number(m[1])<=31)return true;
  if(/^169\.254\./.test(ip))return true;
  if(/^fc/i.test(ip)||/^fd/i.test(ip)||/^fe8/i.test(ip)||/^fe9/i.test(ip)||/^fea/i.test(ip)||/^feb/i.test(ip))return true;
  return false;
}
async function assertPublicUrl(url:URL){
  const host=url.hostname.toLowerCase();
  if(host==="localhost"||host.endsWith(".local"))throw new Error("Private host is not allowed.");
  if(/^\d+\.\d+\.\d+\.\d+$/.test(host)&&isPrivateIp(host))throw new Error("Private IP is not allowed.");
  const addresses=await dns.lookup(host,{all:true,verbatim:true});
  if(!addresses.length||addresses.some(item=>isPrivateIp(item.address)))throw new Error("Resolved private/non-public address.");
}
async function readLimitedBody(response:Response,maxBytes=350_000){
  if(!response.body)return "";
  const reader=response.body.getReader();
  const chunks:Uint8Array[]=[];
  let total=0;
  while(true){
    const {done,value}=await reader.read();
    if(done)break;
    if(!value)continue;
    total+=value.byteLength;
    if(total>maxBytes)throw new Error("Public page exceeds research size limit.");
    chunks.push(value);
  }
  const merged=new Uint8Array(total);
  let offset=0;
  for(const chunk of chunks){merged.set(chunk,offset);offset+=chunk.byteLength}
  return new TextDecoder().decode(merged);
}
function stripHtml(html:string){
  return html
    .replace(/<script[\s\S]*?<\/script>/gi," ")
    .replace(/<style[\s\S]*?<\/style>/gi," ")
    .replace(/<svg[\s\S]*?<\/svg>/gi," ")
    .replace(/<[^>]+>/g," ")
    .replace(/&nbsp;/gi," ")
    .replace(/&amp;/gi,"&")
    .replace(/&quot;/gi,'"')
    .replace(/&#39;/gi,"'")
    .replace(/\s+/g," ")
    .trim();
}
function titleFromHtml(html:string){
  const m=/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m?stripHtml(m[1]).slice(0,220):null;
}
async function fetchPublicPage(input:URL){
  let url=new URL(input.toString());
  for(let redirect=0;redirect<4;redirect++){
    await assertPublicUrl(url);
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),10_000);
    try{
      const response=await fetch(url,{
        redirect:"manual",
        signal:controller.signal,
        headers:{
          "user-agent":"DigitaleGewinnerResearch/1.0 (+evidence-only)",
          "accept":"text/html,text/plain;q=0.9",
        },
      });
      if([301,302,303,307,308].includes(response.status)){
        const location=response.headers.get("location");
        if(!location)throw new Error("Redirect without location.");
        url=new URL(location,url);
        continue;
      }
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const type=(response.headers.get("content-type")||"").toLowerCase();
      if(!type.includes("text/html")&&!type.includes("text/plain"))throw new Error("Unsupported public content type.");
      const html=await readLimitedBody(response);
      return {url:url.toString(),html,text:stripHtml(html).slice(0,60_000),title:titleFromHtml(html)};
    }finally{clearTimeout(timer)}
  }
  throw new Error("Too many redirects.");
}

function candidateUrls(company:CompanyRow){
  const root=normalizeUrl(company.website||company.domain);
  if(!root)return [];
  const result=[root];
  const paths=["/karriere","/karriere/","/jobs","/jobs/","/stellenangebote","/stellenangebote/"];
  for(const path of paths)result.push(new URL(path,root));
  const metadata=company.metadata||{};
  for(const key of ["job_url","jobs_url","career_url","karriere_url"]){
    const value=metadata[key];
    if(typeof value==="string"){
      const parsed=normalizeUrl(value);
      if(parsed)result.push(parsed);
    }
  }
  const seen=new Set<string>();
  return result.filter(url=>{
    const normalized=url.toString();
    if(seen.has(normalized))return false;
    seen.add(normalized);return true;
  }).slice(0,7);
}
function extractEvidence(page:{url:string;text:string;title:string|null},company:CompanyRow){
  const items:Array<Omit<Evidence,"id"|"observedAt">>=[];
  const text=page.text;
  const lower=text.toLowerCase();
  const pageHash=sha(text);
  const path=new URL(page.url).pathname.toLowerCase();
  const careerLike=/karriere|career|jobs|stellen/.test(path)||/karriere|offene stellen|stellenangebote|jobs bei|werde teil/.test(lower);
  const hiring=/pflegefachkraft|pflegekraft|elektriker|elektromeister|monteur|photovoltaik|solar|wir suchen|offene stellen|stellenangebote|jetzt bewerben|bewerben sie sich/.test(lower);

  items.push({
    evidenceKey:"public_page_snapshot",
    evidenceType:path==="/"?"website":"public_page",
    claim:"Public company page was reachable at research time.",
    valueText:page.title,
    sourceUrl:page.url,
    sourceTitle:page.title,
    confidence:1,
    contentHash:pageHash,
    excerpt:text.slice(0,500),
    metadata:{path},
  });
  if(careerLike){
    const idx=Math.max(0,Math.min(
      ...["karriere","offene stellen","stellenangebote","jobs bei","jetzt bewerben"].map(term=>{
        const p=lower.indexOf(term);return p<0?999999:p;
      })
    ));
    items.push({
      evidenceKey:"career_page_detected",
      evidenceType:"career_page",
      claim:"A public career/jobs page or career section was detected.",
      valueText:"career_page",
      sourceUrl:page.url,
      sourceTitle:page.title,
      confidence:0.92,
      contentHash:pageHash,
      excerpt:text.slice(idx===999999?0:Math.max(0,idx-160),idx===999999?600:idx+520),
      metadata:{path},
    });
  }
  if(hiring){
    const terms=["pflegefachkraft","pflegekraft","elektriker","elektromeister","monteur","photovoltaik","solar","wir suchen","offene stellen","stellenangebote","jetzt bewerben"];
    let idx=0;let term="";
    for(const t of terms){const p=lower.indexOf(t);if(p>=0&&(term===""||p<idx)){idx=p;term=t}}
    items.push({
      evidenceKey:"active_hiring_signal",
      evidenceType:"job_signal",
      claim:"A current public-page hiring signal was detected.",
      valueText:term||"hiring",
      sourceUrl:page.url,
      sourceTitle:page.title,
      confidence:0.88,
      contentHash:pageHash,
      excerpt:text.slice(Math.max(0,idx-180),Math.min(text.length,idx+520)),
      metadata:{matchedTerm:term,path},
    });
  }
  return items;
}

function metadataJobEvidence(company:CompanyRow):Array<Omit<Evidence,"id"|"observedAt">>{
  const metadata=company.metadata||{};
  const qualification=metadata.daily_qualification;
  if(!qualification||typeof qualification!=="object")return [];
  const jobGrowth=(qualification as Record<string,unknown>).jobGrowth;
  if(!jobGrowth||typeof jobGrowth!=="object")return [];
  const growth=jobGrowth as Record<string,unknown>;
  const roles=Array.isArray(growth.roles)?growth.roles:[];
  const checkedAt=typeof growth.checkedAt==="string"?growth.checkedAt:"";
  return roles.slice(0,12).flatMap((raw)=>{
    if(!raw||typeof raw!=="object")return [];
    const role=raw as Record<string,unknown>;
    const title=String(role.title||"").trim();
    const employer=String(role.employer||company.name||"").trim();
    const reference=String(role.reference||"").trim();
    const externalUrl=String(role.externalUrl||"").trim();
    const city=String(role.city||company.city||"").trim();
    const publishedAt=String(role.publishedAt||"").trim();
    if(!title||!reference)return [];
    const sourceUrl=externalUrl||`https://www.arbeitsagentur.de/jobsuche/jobdetail/${encodeURIComponent(reference)}`;
    return [{
      evidenceKey:"active_hiring_signal",
      evidenceType:"job_signal" as const,
      claim:"A verified current job listing is associated with this company.",
      valueText:title,
      sourceUrl,
      sourceTitle:"Bundesagentur für Arbeit",
      confidence:0.98,
      contentHash:sha(JSON.stringify({employer,title,reference,publishedAt,city})),
      excerpt:[title,city,publishedAt?`veröffentlicht ${publishedAt}`:"",employer].filter(Boolean).join(" · ").slice(0,800),
      metadata:{employer,reference,publishedAt,city,checkedAt,source:"daily_qualification.jobGrowth"},
    }];
  });
}

async function persistEvidence(runId:string,company:CompanyRow,leadId:string|null,items:Array<Omit<Evidence,"id"|"observedAt">>){
  const output:Evidence[]=[];
  for(const item of items){
    const [row]=await query<{id:string}>(
      `insert into outbound_evidence_items(
         workspace,research_run_id,company_id,lead_id,evidence_key,evidence_type,claim,value_text,
         source_url,source_title,observed_at,confidence,content_hash,excerpt,metadata,expires_at
       )
       values(
         'default',$1,$2,$3,$4,$5,$6,$7,$8,$9,now(),$10,$11,$12,$13::jsonb,
         case when $5 in ('website','career_page','job_signal','public_page') then now()+interval '30 days' else null end
       )
       returning id`,
      [
        runId,company.id,leadId,item.evidenceKey,item.evidenceType,item.claim,item.valueText,item.sourceUrl,
        item.sourceTitle,item.confidence,item.contentHash,item.excerpt,JSON.stringify(item.metadata),
      ],
    );
    if(row)output.push({...item,id:row.id,observedAt:new Date().toISOString()});
  }
  return output;
}

function deterministicHypothesis(company:CompanyRow,evidence:Evidence[]):StrategyHypothesis{
  const hasHiring=evidence.some(item=>item.evidenceKey==="active_hiring_signal");
  const hasCareer=evidence.some(item=>item.evidenceKey==="career_page_detected");
  const industry=(company.industry||"").toLowerCase();
  const segmentKey=/pflege|care|senior/.test(industry)?"pflege":/elektro|solar|photovoltaik|pv/.test(industry)?"elektro-pv":"other";

  if(hasHiring){
    return {
      segmentKey,
      hypothesis:"Companies with a current public hiring signal may respond better to an offer framed around reducing time-to-fill and dependence on intermediaries.",
      audienceAngle:"Current hiring activity",
      painStatement:"The company is publicly recruiting, which is evidence of an active hiring need; the actual vacancy cost must still be validated in conversation.",
      valueProposition:"Test a recruiting-system angle focused on measurable applicant generation and a simpler applicant path.",
      proofRequirements:[
        "Current hiring signal URL must stay attached to the outreach record.",
        "Do not claim a vacancy count, cost, urgency, reach percentage or time-to-fill unless separately evidenced.",
      ],
      confidence:0.82,
    };
  }
  if(hasCareer){
    return {
      segmentKey,
      hypothesis:"Companies maintaining a career area may be suitable for a recruiting-system test, but active hiring should be verified before personalized outreach.",
      audienceAngle:"Recruiting infrastructure exists",
      painStatement:"A career presence exists; active demand is not yet proven.",
      valueProposition:"Test whether a conversion-focused recruiting path and social distribution are relevant.",
      proofRequirements:["Verify active hiring before using vacancy-specific personalization."],
      confidence:0.62,
    };
  }
  return {
    segmentKey,
    hypothesis:"Insufficient public evidence for a vacancy-specific outbound hypothesis.",
    audienceAngle:"Evidence gap",
    painStatement:"No reliable current hiring signal was observed in the available public pages.",
    valueProposition:"Research further before personalized recruiting outreach.",
    proofRequirements:["Obtain a current job signal or operator-provided evidence before using hiring claims."],
    confidence:0.35,
  };
}

async function modelHypothesis(company:CompanyRow,evidence:Evidence[]):Promise<{hypothesis:StrategyHypothesis;generator:string;model:string|null}>{
  const fallback=deterministicHypothesis(company,evidence);
  const apiKey=process.env.OPENAI_API_KEY;
  if(!apiKey)return {hypothesis:fallback,generator:"deterministic-evidence",model:null};

  const model=process.env.OUTBOUND_RESEARCH_MODEL||"gpt-5.6-luna";
  const client=new OpenAI({apiKey});
  const evidencePayload=evidence.map(item=>({
    id:item.id,key:item.evidenceKey,claim:item.claim,value:item.valueText,source:item.sourceUrl,
    excerpt:item.excerpt,confidence:item.confidence,
  }));
  const response=await (client.responses.create as any)({
    model,
    input:[
      {role:"system",content:[{type:"input_text",text:[
        "Generate one B2B outbound strategy hypothesis from evidence only.",
        "Do not invent facts, vacancy counts, urgency, costs, reach, ROI, guarantees, social-media use, or decision-maker details.",
        "A hypothesis is a testable strategy, not a factual claim about the company.",
        "If evidence is weak, explicitly recommend further research.",
        "Return strict JSON only."
      ].join("\n")}]},
      {role:"user",content:[{type:"input_text",text:JSON.stringify({
        company:{name:company.name,industry:company.industry,city:company.city,domain:company.domain},
        evidence:evidencePayload,
      })}]},
    ],
    max_output_tokens:800,
    text:{format:{
      type:"json_schema",name:"strategy_hypothesis",strict:true,
      schema:{
        type:"object",additionalProperties:false,
        required:["segmentKey","hypothesis","audienceAngle","painStatement","valueProposition","proofRequirements","confidence"],
        properties:{
          segmentKey:{type:"string"},
          hypothesis:{type:"string"},
          audienceAngle:{type:"string"},
          painStatement:{type:"string"},
          valueProposition:{type:"string"},
          proofRequirements:{type:"array",items:{type:"string"}},
          confidence:{type:"number",minimum:0,maximum:1},
        },
      },
    }},
  });
  const text=String(response.output_text||"").trim();
  if(!text)return {hypothesis:fallback,generator:"deterministic-evidence",model:null};
  const parsed=z.object({
    segmentKey:z.string().min(1).max(120),
    hypothesis:z.string().min(10).max(1400),
    audienceAngle:z.string().min(3).max(700),
    painStatement:z.string().min(3).max(1000),
    valueProposition:z.string().min(3).max(1000),
    proofRequirements:z.array(z.string().min(2).max(500)).max(12),
    confidence:z.number().min(0).max(1),
  }).parse(JSON.parse(text));
  return {hypothesis:parsed,generator:"openai-responses",model};
}

async function processRun(run:ResearchRun){
  const [company]=await query<CompanyRow>(
    `select id,name,domain,website,city,industry,research_status,metadata,updated_at
     from sales_companies where workspace='default' and id=$1 limit 1`,
    [run.company_id],
  );
  if(!company)throw new Error("Company not found.");
  const [lead]=run.lead_id?await query<LeadRow>(
    `select id,company_id,notes,stage,status from sales_leads where workspace='default' and id=$1 limit 1`,
    [run.lead_id],
  ):[];

  const evidence:Evidence[]=[];
  const sourceUrls:string[]=[];
  const urls=candidateUrls(company);
  for(const url of urls){
    try{
      const page=await fetchPublicPage(url);
      sourceUrls.push(page.url);
      const items=extractEvidence(page,company);
      evidence.push(...await persistEvidence(run.id,company,lead?.id??null,items));
      if(evidence.some(item=>item.evidenceKey==="active_hiring_signal")&&sourceUrls.length>=2)break;
    }catch{
      // Research continues with remaining public URLs.
    }
  }

  const verifiedJobItems=metadataJobEvidence(company);
  if(verifiedJobItems.length){
    evidence.push(...await persistEvidence(run.id,company,lead?.id??null,verifiedJobItems));
    for(const item of verifiedJobItems){
      if(item.sourceUrl&&!sourceUrls.includes(item.sourceUrl))sourceUrls.push(item.sourceUrl);
    }
  }

  if(company.industry||company.city||lead?.notes){
    const crmItems:Array<Omit<Evidence,"id"|"observedAt">>=[];
    if(company.industry)crmItems.push({
      evidenceKey:"crm_industry",evidenceType:"crm",claim:"CRM industry value.",valueText:company.industry,
      sourceUrl:null,sourceTitle:"CRM",confidence:0.75,contentHash:null,excerpt:null,metadata:{field:"industry"},
    });
    if(company.city)crmItems.push({
      evidenceKey:"crm_city",evidenceType:"crm",claim:"CRM city value.",valueText:company.city,
      sourceUrl:null,sourceTitle:"CRM",confidence:0.8,contentHash:null,excerpt:null,metadata:{field:"city"},
    });
    if(lead?.notes)crmItems.push({
      evidenceKey:"crm_lead_notes",evidenceType:"crm",claim:"Operator/CRM lead notes are available.",valueText:null,
      sourceUrl:null,sourceTitle:"CRM",confidence:0.6,contentHash:sha(lead.notes),excerpt:lead.notes.slice(0,800),metadata:{field:"notes"},
    });
    evidence.push(...await persistEvidence(run.id,company,lead?.id??null,crmItems));
  }

  const generated=await modelHypothesis(company,evidence);
  const hypothesisKey=sha(JSON.stringify({
    companyId:company.id,
    segmentKey:generated.hypothesis.segmentKey,
    hypothesis:generated.hypothesis.hypothesis,
    evidenceIds:evidence.map(item=>item.id).sort(),
  })).slice(0,40);
  const [latest]=await query<{version:number}>(
    `select version from outbound_strategy_hypotheses
     where workspace='default' and hypothesis_key=$1 order by version desc limit 1`,
    [hypothesisKey],
  );
  const [strategy]=await query<{id:string}>(
    `insert into outbound_strategy_hypotheses(
       workspace,research_run_id,company_id,segment_key,hypothesis_key,version,status,hypothesis,
       audience_angle,pain_statement,value_proposition,proof_requirements,evidence_ids,confidence,
       generator,model,prompt_version,created_by
     )
     values(
       'default',$1,$2,$3,$4,$5,'proposed',$6,$7,$8,$9,$10::jsonb,$11::uuid[],$12,$13,$14,$15,'research-agent'
     )
     returning id`,
    [
      run.id,company.id,generated.hypothesis.segmentKey,hypothesisKey,Number(latest?.version||0)+1,
      generated.hypothesis.hypothesis,generated.hypothesis.audienceAngle,generated.hypothesis.painStatement,
      generated.hypothesis.valueProposition,JSON.stringify(generated.hypothesis.proofRequirements),
      evidence.map(item=>item.id),generated.hypothesis.confidence,generated.generator,generated.model,
      RESEARCH_PROMPT_VERSION,
    ],
  );
  if(!strategy)throw new Error("Strategy hypothesis could not be persisted.");

  await query(
    `update outbound_research_runs
     set status='completed',source_urls=$2::jsonb,summary=$3::jsonb,confidence=$4,
         completed_at=now(),lease_owner=null,lease_expires_at=null,last_error=null
     where id=$1`,
    [
      run.id,JSON.stringify(sourceUrls),JSON.stringify({
        evidenceCount:evidence.length,
        hiringSignal:evidence.some(item=>item.evidenceKey==="active_hiring_signal"),
        careerPage:evidence.some(item=>item.evidenceKey==="career_page_detected"),
        hypothesisId:strategy.id,
      }),generated.hypothesis.confidence,
    ],
  );
  await query(
    `update sales_companies set research_status='researched',last_enriched_at=now(),updated_at=now()
     where workspace='default' and id=$1`,
    [company.id],
  );

  await recordOutboundEventByMode({
    workspace:"default",
    type:"research_completed",
    actorType:"agent",
    actorId:"research-agent",
    companyId:company.id,
    leadId:lead?.id??null,
    idempotencyKey:`research-completed:${run.id}`,
    payload:{
      researchRunId:run.id,hypothesisId:strategy.id,evidenceCount:evidence.length,
      sourceUrls,confidence:generated.hypothesis.confidence,generator:generated.generator,
      policyVersion:RESEARCH_STRATEGY_VERSION,
    },
  });
  await recordOutboundEventByMode({
    workspace:"default",
    type:"strategy_hypothesis_proposed",
    actorType:"agent",
    actorId:"research-agent",
    companyId:company.id,
    leadId:lead?.id??null,
    idempotencyKey:`strategy-hypothesis:${strategy.id}`,
    payload:{hypothesisId:strategy.id,researchRunId:run.id,confidence:generated.hypothesis.confidence},
  });
  return {runId:run.id,hypothesisId:strategy.id,evidenceCount:evidence.length,sourceUrls};
}

export async function enqueueCompanyResearch(input:{companyId:string;leadId?:string|null;workspace?:string}){
  const workspace=input.workspace??"default";
  const [existing]=await query<{id:string}>(
    `select id from outbound_research_runs
     where workspace=$1 and company_id=$2 and status in ('queued','processing')
     order by created_at desc limit 1`,
    [workspace,input.companyId],
  );
  if(existing)return {id:existing.id,reused:true};
  const [row]=await query<{id:string}>(
    `insert into outbound_research_runs(workspace,company_id,lead_id,status,strategy_version)
     values($1,$2,$3,'queued',$4) returning id`,
    [workspace,input.companyId,input.leadId??null,RESEARCH_STRATEGY_VERSION],
  );
  if(!row)throw new Error("Research run could not be queued.");
  return {id:row.id,reused:false};
}

async function claimResearchRuns(limit:number){
  const workerId=`research-${randomUUID()}`;
  const rows=await query<ResearchRun>(
    `with claim as (
       select id from outbound_research_runs
       where workspace='default'
         and status in ('queued','processing')
         and attempt<max_attempts
         and (status='queued' or lease_expires_at is null or lease_expires_at<now())
       order by queued_at asc
       for update skip locked
       limit $1
     )
     update outbound_research_runs r
     set status='processing',attempt=r.attempt+1,lease_owner=$2,lease_expires_at=now()+interval '90 seconds',
         started_at=coalesce(started_at,now()),last_error=null
     from claim where r.id=claim.id
     returning r.id,r.company_id,r.lead_id,r.status,r.attempt,r.max_attempts`,
    [Math.max(1,Math.min(20,limit)),workerId],
  );
  return {workerId,rows};
}

export async function processResearchQueue(limit=4){
  const {workerId,rows}=await claimResearchRuns(limit);
  let completed=0,failed=0;
  const results=[];
  for(const run of rows){
    try{
      const result=await processRun(run);
      results.push(result);completed++;
    }catch(error){
      const message=error instanceof Error?error.message:"Research failed";
      const terminal=run.attempt>=run.max_attempts;
      await query(
        `update outbound_research_runs
         set status=$2,lease_owner=null,lease_expires_at=null,last_error=$3
         where id=$1`,
        [run.id,terminal?"failed":"queued",message],
      );
      failed++;results.push({runId:run.id,error:message});
    }
  }
  return {workerId,claimed:rows.length,completed,failed,results};
}

export async function seedResearchQueue(limit=20){
  const candidates=await query<{company_id:string;lead_id:string}>(
    `select l.company_id,l.id as lead_id
     from sales_leads l
     join sales_companies c on c.id=l.company_id and c.workspace=l.workspace
     where l.workspace='default'
       and l.company_id is not null
       and coalesce(l.do_not_contact,false)=false
       and (c.website is not null or c.domain is not null)
       and not exists (
         select 1 from outbound_research_runs r
         where r.workspace=l.workspace and r.company_id=l.company_id
           and r.created_at>=now()-interval '14 days'
           and r.status in ('queued','processing','completed')
       )
     order by l.priority_score desc nulls last,l.updated_at desc
     limit $1`,
    [Math.max(1,Math.min(100,limit))],
  );
  let queued=0;
  for(const candidate of candidates){
    const result=await enqueueCompanyResearch({companyId:candidate.company_id,leadId:candidate.lead_id});
    if(!result.reused)queued++;
  }
  return {candidates:candidates.length,queued};
}

export async function reviewStrategyHypothesis(raw:z.infer<typeof reviewSchema>,actorId="admin-session"){
  const input=reviewSchema.parse(raw);
  const [row]=await query<{id:string;company_id:string|null}>(
    `update outbound_strategy_hypotheses
     set status=$2,reviewed_by=$3,reviewed_at=now(),review_reason=$4
     where workspace='default' and id=$1 and status='proposed'
     returning id,company_id`,
    [input.hypothesisId,input.decision,actorId,input.reason],
  );
  if(!row)throw new Error("Hypothesis not found or already reviewed.");
  await recordOutboundEventByMode({
    workspace:"default",
    type:input.decision==="approved"?"strategy_hypothesis_approved":"strategy_hypothesis_rejected",
    actorType:"human",actorId,companyId:row.company_id,
    idempotencyKey:`strategy-review:${row.id}:${input.decision}`,
    payload:{hypothesisId:row.id,decision:input.decision,reason:input.reason},
  });
  return {id:row.id,status:input.decision};
}

export async function getResearchDashboard(){
  const [counts]=await query<{queued:string;processing:string;completed:string;failed:string;proposed:string;approved:string}>(
    `select
       (select count(*) from outbound_research_runs where workspace='default' and status='queued')::text as queued,
       (select count(*) from outbound_research_runs where workspace='default' and status='processing')::text as processing,
       (select count(*) from outbound_research_runs where workspace='default' and status='completed')::text as completed,
       (select count(*) from outbound_research_runs where workspace='default' and status='failed')::text as failed,
       (select count(*) from outbound_strategy_hypotheses where workspace='default' and status='proposed')::text as proposed,
       (select count(*) from outbound_strategy_hypotheses where workspace='default' and status='approved')::text as approved`
  );
  const hypotheses=await query<{
    id:string;company_id:string|null;segment_key:string;status:string;hypothesis:string;audience_angle:string;
    pain_statement:string;value_proposition:string;proof_requirements:string[];evidence_ids:string[];confidence:number;
    generator:string;model:string|null;prompt_version:string;created_at:Date;company_name:string|null;domain:string|null
  }>(
    `select h.id,h.company_id,h.segment_key,h.status,h.hypothesis,h.audience_angle,h.pain_statement,
            h.value_proposition,h.proof_requirements,h.evidence_ids,h.confidence,h.generator,h.model,h.prompt_version,
            h.created_at,c.name as company_name,c.domain
     from outbound_strategy_hypotheses h
     left join sales_companies c on c.id=h.company_id and c.workspace=h.workspace
     where h.workspace='default'
     order by case h.status when 'proposed' then 0 when 'approved' then 1 else 2 end,h.created_at desc
     limit 80`
  );
  const evidenceIds=[...new Set(hypotheses.flatMap(h=>h.evidence_ids||[]))];
  const evidence=evidenceIds.length?await query<{
    id:string;company_id:string;evidence_key:string;evidence_type:string;claim:string;value_text:string|null;
    source_url:string|null;source_title:string|null;observed_at:Date;confidence:number;excerpt:string|null
  }>(
    `select id,company_id,evidence_key,evidence_type,claim,value_text,source_url,source_title,observed_at,confidence,excerpt
     from outbound_evidence_items where id=any($1::uuid[]) order by observed_at desc`,
    [evidenceIds],
  ):[];
  const byId=new Map(evidence.map(item=>[item.id,item]));
  return {
    aiConfigured:Boolean(process.env.OPENAI_API_KEY),
    model:process.env.OUTBOUND_RESEARCH_MODEL||"gpt-5.6-luna",
    strategyVersion:RESEARCH_STRATEGY_VERSION,
    counts:{
      queued:Number(counts?.queued||0),processing:Number(counts?.processing||0),
      completed:Number(counts?.completed||0),failed:Number(counts?.failed||0),
      proposed:Number(counts?.proposed||0),approved:Number(counts?.approved||0),
    },
    hypotheses:hypotheses.map(h=>({...h,evidence:(h.evidence_ids||[]).map(id=>byId.get(id)).filter(Boolean)})),
  };
}

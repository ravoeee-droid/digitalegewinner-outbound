import { createHash } from "node:crypto";
import OpenAI from "openai";
import { z } from "zod";
import { query } from "@/lib/db";
import { recordOutboundEventByMode } from "@/lib/outbound-event-ledger";

export const COPY_CRITIC_POLICY_VERSION="dg-copy-critic-2026-09-27-v1";
export const COPY_GENERATOR_VERSION="cold-email-copy-v1";

type PromptRow={
  id:string;prompt_key:string;version:number;status:string;purpose:string;model:string|null;
  system_prompt:string;user_template:string;response_schema:Record<string,unknown>;policy_version:string;
};
type EvidenceRow={
  id:string;company_id:string;evidence_key:string;evidence_type:string;claim:string;value_text:string|null;
  source_url:string|null;source_title:string|null;observed_at:Date;confidence:number;excerpt:string|null;
};
type HypothesisRow={
  id:string;company_id:string|null;segment_key:string;status:string;hypothesis:string;audience_angle:string;
  pain_statement:string;value_proposition:string;proof_requirements:string[];evidence_ids:string[];
  confidence:number;company_name:string|null;
};
type CopyClaim={text:string;evidenceIds:string[]};
type CopyDraft={subject:string;body:string;claims:CopyClaim[]};

const reviewSchema=z.object({
  candidateId:z.string().uuid(),
  decision:z.enum(["approved","rejected"]),
  reason:z.string().min(3).max(2000),
});
const draftSchema=z.object({
  subject:z.string().min(1).max(140),
  body:z.string().min(1).max(5000),
  claims:z.array(z.object({
    text:z.string().min(2).max(1000),
    evidenceIds:z.array(z.string().uuid()).max(20),
  })).max(20),
});

function sha(value:string){return createHash("sha256").update(value).digest("hex")}
function wordCount(text:string){return text.trim()?text.trim().split(/\s+/).length:0}
function count(text:string,pattern:RegExp){return (text.match(pattern)||[]).length}
function uppercaseRatio(text:string){
  const letters=text.replace(/[^A-Za-zÄÖÜäöüß]/g,"");
  if(letters.length<12)return 0;
  const upper=letters.replace(/[^A-ZÄÖÜ]/g,"").length;
  return upper/letters.length;
}
function normalizeText(text:string){return text.replace(/\r\n/g,"\n").trim()}

export function critiqueCopy(input:{
  subject:string;
  body:string;
  claims?:CopyClaim[];
  evidenceIds?:string[];
  companyName?:string|null;
}){
  const subject=normalizeText(input.subject);
  const body=normalizeText(input.body);
  const claims=input.claims||[];
  const evidenceIds=new Set(input.evidenceIds||[]);
  const violations:Array<{code:string;severity:"hard"|"warn";message:string}>=[];
  const words=wordCount(body);

  if(subject.length>80)violations.push({code:"subject_too_long",severity:"hard",message:"Subject exceeds 80 characters."});
  if(words<12)violations.push({code:"body_too_short",severity:"warn",message:"Body is unusually short."});
  if(words>120)violations.push({code:"body_too_long",severity:"hard",message:"Cold email body exceeds 120 words."});
  if(count(subject+" "+body,/!/g)>2)violations.push({code:"excess_exclamation",severity:"hard",message:"Too many exclamation marks."});
  if(uppercaseRatio(subject+" "+body)>0.42)violations.push({code:"excess_uppercase",severity:"hard",message:"Excessive uppercase/spam formatting."});
  if(/\{\{|\}\}/.test(subject+" "+body))violations.push({code:"unresolved_placeholder",severity:"hard",message:"Unresolved template placeholder."});
  if(/utm_|fbclid=|gclid=/i.test(body))violations.push({code:"tracking_link",severity:"hard",message:"Tracking parameters are not allowed in cold-email copy."});
  if((body.match(/https?:\/\//gi)||[]).length>1)violations.push({code:"too_many_links",severity:"hard",message:"More than one link in cold-email body."});

  const riskyPatterns:Array<[string,RegExp,string]>= [
    ["guarantee",/\bgarant(?:ie|iert|ieren)|\bguarantee(?:d)?\b/i,"Guarantee/result promise requires specific approved proof."],
    ["roi_claim",/\broi\b|return on investment/i,"ROI claim requires specific approved proof."],
    ["time_claim",/\b(?:in|innerhalb von)\s+\d+\s*(?:tag|tage|tagen|wochen)\b/i,"Time-to-result claim requires specific approved proof."],
    ["price_result_claim",/\b\d{1,3}(?:[.\s]\d{3})*(?:,\d+)?\s*€\b/i,"Numeric price/result claim requires specific approved proof."],
    ["percentage_claim",/\b\d{1,3}(?:[.,]\d+)?\s*%/i,"Percentage claim requires specific approved proof."],
    ["superlative",/\b(?:beste|bestes|besten|marktführer|nummer\s*1|#1)\b/i,"Superlative claim requires specific approved proof."],
  ];

  const claimHasEvidence=(code:string)=>{
    const relevant=claims.filter(claim=>riskyPatterns.find(([key])=>key===code)?.[1].test(claim.text));
    return relevant.length>0&&relevant.every(claim=>claim.evidenceIds.length>0&&claim.evidenceIds.every(id=>evidenceIds.has(id)));
  };
  for(const [code,pattern,message] of riskyPatterns){
    if(pattern.test(subject+" "+body)&&!claimHasEvidence(code)){
      violations.push({code,severity:"hard",message});
    }
  }

  const companySpecific=/(auf ihrer|bei ihnen|sie suchen|ihre offene|ihre karriereseite|ihr unternehmen|aktuell bei)/i.test(body);
  if(companySpecific&&claims.length===0){
    violations.push({code:"company_claim_without_claim_map",severity:"hard",message:"Company-specific factual statement has no structured claim/evidence mapping."});
  }
  for(const claim of claims){
    if(!claim.evidenceIds.length){
      violations.push({code:"claim_without_evidence",severity:"hard",message:`Claim has no evidence: ${claim.text.slice(0,120)}`});
      continue;
    }
    for(const id of claim.evidenceIds){
      if(!evidenceIds.has(id)){
        violations.push({code:"claim_unknown_evidence",severity:"hard",message:`Claim references evidence not attached to candidate: ${id}`});
      }
    }
  }

  const hard=violations.filter(v=>v.severity==="hard").length;
  const warnings=violations.filter(v=>v.severity==="warn").length;
  const score=Math.max(0,Math.min(1,1-hard*0.24-warnings*0.06));
  return {
    passed:hard===0,
    score,
    wordCount:words,
    violations,
    checks:{
      subjectLength:subject.length,
      bodyWordCount:words,
      links:(body.match(/https?:\/\//gi)||[]).length,
      exclamations:count(subject+" "+body,/!/g),
      uppercaseRatio:uppercaseRatio(subject+" "+body),
      claims:claims.length,
      evidenceIds:evidenceIds.size,
    },
    policyVersion:COPY_CRITIC_POLICY_VERSION,
  };
}

async function loadActivePrompt(){
  const [row]=await query<PromptRow>(
    `select id,prompt_key,version,status,purpose,model,system_prompt,user_template,response_schema,policy_version
     from outbound_prompt_versions
     where workspace='default' and prompt_key='cold-email-copy' and status='active'
     order by version desc limit 1`
  );
  if(!row)throw new Error("No active cold-email-copy prompt.");
  return row;
}

async function loadHypothesis(hypothesisId:string){
  const [row]=await query<HypothesisRow>(
    `select h.id,h.company_id,h.segment_key,h.status,h.hypothesis,h.audience_angle,h.pain_statement,
            h.value_proposition,h.proof_requirements,h.evidence_ids,h.confidence,c.name as company_name
     from outbound_strategy_hypotheses h
     left join sales_companies c on c.id=h.company_id and c.workspace=h.workspace
     where h.workspace='default' and h.id=$1 limit 1`,
    [hypothesisId],
  );
  if(!row)throw new Error("Strategy hypothesis not found.");
  return row;
}
async function loadEvidence(ids:string[]){
  if(!ids.length)return [] as EvidenceRow[];
  return query<EvidenceRow>(
    `select id,company_id,evidence_key,evidence_type,claim,value_text,source_url,source_title,observed_at,confidence,excerpt
     from outbound_evidence_items where id=any($1::uuid[]) order by observed_at desc`,
    [ids],
  );
}

function deterministicDraft(hypothesis:HypothesisRow,evidence:EvidenceRow[]):CopyDraft{
  const hiring=evidence.find(item=>item.evidence_key==="active_hiring_signal");
  const career=evidence.find(item=>item.evidence_key==="career_page_detected");
  const company=hypothesis.company_name||"Ihrem Unternehmen";
  if(hiring){
    const claim="Auf Ihrer öffentlich erreichbaren Karriere-/Stellenseite ist aktuell ein Recruiting-Signal zu sehen.";
    return {
      subject:`Kurze Frage zu ${company}`,
      body:[
        "Hallo zusammen,",
        "",
        claim,
        "",
        "Wir bauen Recruiting-Systeme, die den Weg von der Ansprache bis zur Bewerbung vereinfachen und messbar machen.",
        "",
        "Ist Personalgewinnung aktuell ein Thema, über das sich ein kurzes Gespräch lohnt?",
        "",
        "Viele Grüße",
        "Raphael Hermann",
      ].join("\n"),
      claims:[{text:claim,evidenceIds:[hiring.id]}],
    };
  }
  if(career){
    const claim="Ich bin über Ihren öffentlich erreichbaren Karrierebereich auf Ihr Unternehmen gestoßen.";
    return {
      subject:`Personalgewinnung bei ${company}`,
      body:[
        "Hallo zusammen,",
        "",
        claim,
        "",
        "Wir entwickeln Recruiting-Systeme, die Arbeitgeberstory, Bewerberweg und messbare Ansprache zusammenführen.",
        "",
        "Ist das grundsätzlich ein relevantes Thema für Sie?",
        "",
        "Viele Grüße",
        "Raphael Hermann",
      ].join("\n"),
      claims:[{text:claim,evidenceIds:[career.id]}],
    };
  }
  return {
    subject:`Kurze Frage an ${company}`,
    body:[
      "Hallo zusammen,",
      "",
      "ich melde mich kurz zum Thema Personalgewinnung.",
      "",
      "Wir entwickeln Recruiting-Systeme, die Ansprache und Bewerberweg in einem messbaren Prozess zusammenführen.",
      "",
      "Ist das aktuell grundsätzlich relevant für Sie?",
      "",
      "Viele Grüße",
      "Raphael Hermann",
    ].join("\n"),
    claims:[],
  };
}

async function modelDraft(prompt:PromptRow,hypothesis:HypothesisRow,evidence:EvidenceRow[]){
  const fallback=deterministicDraft(hypothesis,evidence);
  const apiKey=process.env.OPENAI_API_KEY;
  if(!apiKey)return {draft:fallback,generator:"deterministic-copy",model:null};
  const model=process.env.OUTBOUND_COPY_MODEL||"gpt-5.6-luna";
  const client=new OpenAI({apiKey});
  const response=await (client.responses.create as any)({
    model,
    input:[
      {role:"system",content:[{type:"input_text",text:prompt.system_prompt}]},
      {role:"user",content:[{type:"input_text",text:JSON.stringify({
        company:hypothesis.company_name,
        strategy:{
          segment:hypothesis.segment_key,
          hypothesis:hypothesis.hypothesis,
          audienceAngle:hypothesis.audience_angle,
          painStatement:hypothesis.pain_statement,
          valueProposition:hypothesis.value_proposition,
          proofRequirements:hypothesis.proof_requirements,
        },
        evidence:evidence.map(item=>({
          id:item.id,key:item.evidence_key,claim:item.claim,value:item.value_text,
          source:item.source_url,excerpt:item.excerpt,confidence:item.confidence,
        })),
      })}]},
    ],
    max_output_tokens:900,
    text:{format:{
      type:"json_schema",name:"cold_email_copy",strict:true,
      schema:{
        type:"object",additionalProperties:false,required:["subject","body","claims"],
        properties:{
          subject:{type:"string"},
          body:{type:"string"},
          claims:{type:"array",items:{
            type:"object",additionalProperties:false,required:["text","evidenceIds"],
            properties:{
              text:{type:"string"},
              evidenceIds:{type:"array",items:{type:"string"}},
            },
          }},
        },
      },
    }},
  });
  const text=String(response.output_text||"").trim();
  if(!text)return {draft:fallback,generator:"deterministic-copy",model:null};
  return {draft:draftSchema.parse(JSON.parse(text)),generator:"openai-responses",model};
}

export async function createCopyCandidate(hypothesisId:string){
  const hypothesis=await loadHypothesis(hypothesisId);
  if(hypothesis.status!=="approved")throw new Error("Only approved strategy hypotheses can generate production copy candidates.");
  const evidence=await loadEvidence(hypothesis.evidence_ids||[]);
  const prompt=await loadActivePrompt();
  const generated=await modelDraft(prompt,hypothesis,evidence);
  const draft=draftSchema.parse(generated.draft);
  const attachedEvidenceIds=[...new Set(draft.claims.flatMap(claim=>claim.evidenceIds))];
  const knownIds=new Set(evidence.map(item=>item.id));
  for(const id of attachedEvidenceIds){
    if(!knownIds.has(id))throw new Error(`Generated copy referenced unknown evidence: ${id}`);
  }
  const critic=critiqueCopy({
    subject:draft.subject,body:draft.body,claims:draft.claims,
    evidenceIds:attachedEvidenceIds,companyName:hypothesis.company_name,
  });
  const contentHash=sha(JSON.stringify({subject:draft.subject,body:draft.body,claims:draft.claims,promptId:prompt.id}));
  const [candidate]=await query<{id:string}>(
    `insert into outbound_copy_candidates(
       workspace,strategy_hypothesis_id,company_id,prompt_version_id,channel,status,subject,body,
       claims,evidence_ids,quality_score,critic,content_hash,generator,model,prompt_version,created_by
     )
     values(
       'default',$1,$2,$3,'email',$4,$5,$6,$7::jsonb,$8::uuid[],$9,$10::jsonb,$11,$12,$13,'copy-agent'
     )
     returning id`,
    [
      hypothesis.id,hypothesis.company_id,prompt.id,critic.passed?"passed":"failed",draft.subject,draft.body,
      JSON.stringify(draft.claims),attachedEvidenceIds,critic.score,JSON.stringify(critic),contentHash,
      generated.generator,generated.model,`${prompt.prompt_key}:v${prompt.version}`,
    ],
  );
  if(!candidate)throw new Error("Copy candidate could not be persisted.");
  await recordOutboundEventByMode({
    workspace:"default",
    type:"copy_candidate_created",
    actorType:"agent",actorId:"copy-agent",companyId:hypothesis.company_id,
    idempotencyKey:`copy-candidate:${candidate.id}`,
    payload:{
      candidateId:candidate.id,hypothesisId:hypothesis.id,status:critic.passed?"passed":"failed",
      qualityScore:critic.score,promptVersionId:prompt.id,generator:generated.generator,
    },
  });
  await recordOutboundEventByMode({
    workspace:"default",
    type:critic.passed?"copy_critic_passed":"copy_critic_failed",
    actorType:"agent",actorId:"copy-critic",companyId:hypothesis.company_id,
    idempotencyKey:`copy-critic:${candidate.id}`,
    payload:{candidateId:candidate.id,score:critic.score,violations:critic.violations,policyVersion:COPY_CRITIC_POLICY_VERSION},
  });
  return {id:candidate.id,critic,status:critic.passed?"passed":"failed"};
}

export async function reviewCopyCandidate(raw:z.infer<typeof reviewSchema>,actorId="admin-session"){
  const input=reviewSchema.parse(raw);
  const [candidate]=await query<{id:string;status:string;company_id:string|null}>(
    `select id,status,company_id from outbound_copy_candidates
     where workspace='default' and id=$1 limit 1`,
    [input.candidateId],
  );
  if(!candidate)throw new Error("Copy candidate not found.");
  if(input.decision==="approved"&&candidate.status!=="passed"){
    throw new Error("Only critic-passed copy can be approved.");
  }
  const [row]=await query<{id:string}>(
    `update outbound_copy_candidates
     set status=$2,reviewed_by=$3,reviewed_at=now(),review_reason=$4
     where workspace='default' and id=$1 and status in ('passed','failed','proposed')
     returning id`,
    [input.candidateId,input.decision,actorId,input.reason],
  );
  if(!row)throw new Error("Copy candidate already reviewed or unavailable.");
  await recordOutboundEventByMode({
    workspace:"default",
    type:input.decision==="approved"?"copy_candidate_approved":"copy_candidate_rejected",
    actorType:"human",actorId,companyId:candidate.company_id,
    idempotencyKey:`copy-review:${candidate.id}:${input.decision}`,
    payload:{candidateId:candidate.id,decision:input.decision,reason:input.reason},
  });
  return {id:candidate.id,status:input.decision};
}

export async function runCriticRegression(actorId="admin-session"){
  const [dataset]=await query<{id:string}>(
    `select id from outbound_eval_datasets
     where workspace='default' and dataset_key='cold-email-critic-regression' and status='active'
     order by version desc limit 1`
  );
  if(!dataset)throw new Error("No active critic regression dataset.");
  const prompt=await loadActivePrompt();
  const cases=await query<{id:string;case_key:string;input:Record<string,unknown>;expected:Record<string,unknown>;weight:number}>(
    `select id,case_key,input,expected,weight from outbound_eval_cases where dataset_id=$1 order by case_key`,
    [dataset.id],
  );
  const [run]=await query<{id:string}>(
    `insert into outbound_eval_runs(
       workspace,dataset_id,prompt_version_id,status,trigger_kind,model,total_cases,created_by
     )
     values('default',$1,$2,'running','regression',$3,$4,$5)
     returning id`,
    [dataset.id,prompt.id,process.env.OUTBOUND_COPY_MODEL||null,cases.length,actorId],
  );
  if(!run)throw new Error("Eval run could not be created.");

  let weightedPass=0,totalWeight=0,passedCases=0;
  const failures:Array<{caseKey:string;expected:boolean;actual:boolean;violations:unknown}>=[];
  try{
    for(const item of cases){
      const input=item.input||{};
      const critic=critiqueCopy({
        subject:String(input.subject||""),
        body:String(input.body||""),
        claims:Array.isArray(input.claims)?input.claims as CopyClaim[]:[],
        evidenceIds:Array.isArray(input.evidenceIds)?input.evidenceIds.map(String):[],
      });
      const expectedPass=Boolean(item.expected?.pass);
      const passed=critic.passed===expectedPass;
      const score=passed?1:0;
      await query(
        `insert into outbound_eval_results(run_id,case_id,passed,score,output,violations,critic)
         values($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb)`,
        [
          run.id,item.id,passed,score,JSON.stringify({actualPass:critic.passed,expectedPass}),
          JSON.stringify(critic.violations),JSON.stringify(critic),
        ],
      );
      totalWeight+=Number(item.weight);
      if(passed){weightedPass+=Number(item.weight);passedCases++}
      else failures.push({caseKey:item.case_key,expected:expectedPass,actual:critic.passed,violations:critic.violations});
    }
    const score=totalWeight?weightedPass/totalWeight:0;
    await query(
      `update outbound_eval_runs
       set status='completed',passed_cases=$2,score=$3,summary=$4::jsonb,completed_at=now()
       where id=$1`,
      [run.id,passedCases,score,JSON.stringify({failures,policyVersion:COPY_CRITIC_POLICY_VERSION})],
    );
    await recordOutboundEventByMode({
      workspace:"default",type:"prompt_eval_completed",actorType:"system",actorId:"copy-eval",
      idempotencyKey:`prompt-eval:${run.id}`,
      payload:{runId:run.id,datasetId:dataset.id,promptVersionId:prompt.id,totalCases:cases.length,passedCases,score,failures},
    });
    return {runId:run.id,totalCases:cases.length,passedCases,score,failures};
  }catch(error){
    await query(
      `update outbound_eval_runs set status='failed',summary=$2::jsonb,completed_at=now() where id=$1`,
      [run.id,JSON.stringify({error:error instanceof Error?error.message:"Eval failed"})],
    );
    throw error;
  }
}

export async function getCopyEvalDashboard(){
  const [counts]=await query<{passed:string;failed:string;approved:string;proposed_hypotheses:string}>(
    `select
       (select count(*) from outbound_copy_candidates where workspace='default' and status='passed')::text as passed,
       (select count(*) from outbound_copy_candidates where workspace='default' and status='failed')::text as failed,
       (select count(*) from outbound_copy_candidates where workspace='default' and status='approved')::text as approved,
       (select count(*) from outbound_strategy_hypotheses h
        where h.workspace='default' and h.status='approved'
          and not exists(select 1 from outbound_copy_candidates c where c.strategy_hypothesis_id=h.id)
       )::text as proposed_hypotheses`
  );
  const candidates=await query<{
    id:string;strategy_hypothesis_id:string|null;company_id:string|null;status:string;subject:string;body:string;
    claims:CopyClaim[];evidence_ids:string[];quality_score:number|null;critic:Record<string,unknown>;
    generator:string;model:string|null;prompt_version:string;created_at:Date;company_name:string|null
  }>(
    `select c.id,c.strategy_hypothesis_id,c.company_id,c.status,c.subject,c.body,c.claims,c.evidence_ids,
            c.quality_score,c.critic,c.generator,c.model,c.prompt_version,c.created_at,co.name as company_name
     from outbound_copy_candidates c
     left join sales_companies co on co.id=c.company_id and co.workspace=c.workspace
     where c.workspace='default'
     order by case c.status when 'passed' then 0 when 'failed' then 1 when 'approved' then 2 else 3 end,c.created_at desc
     limit 80`
  );
  const hypotheses=await query<{id:string;company_id:string|null;hypothesis:string;company_name:string|null}>(
    `select h.id,h.company_id,h.hypothesis,co.name as company_name
     from outbound_strategy_hypotheses h
     left join sales_companies co on co.id=h.company_id and co.workspace=h.workspace
     where h.workspace='default' and h.status='approved'
       and not exists(select 1 from outbound_copy_candidates c where c.strategy_hypothesis_id=h.id)
     order by h.created_at desc limit 80`
  );
  const evalRuns=await query<{
    id:string;status:string;trigger_kind:string;model:string|null;total_cases:number;passed_cases:number;
    score:number|null;summary:Record<string,unknown>;started_at:Date;completed_at:Date|null
  }>(
    `select id,status,trigger_kind,model,total_cases,passed_cases,score,summary,started_at,completed_at
     from outbound_eval_runs where workspace='default' order by started_at desc limit 30`
  );
  const prompts=await query<{
    id:string;prompt_key:string;version:number;status:string;purpose:string;model:string|null;policy_version:string;created_at:Date
  }>(
    `select id,prompt_key,version,status,purpose,model,policy_version,created_at
     from outbound_prompt_versions where workspace='default' order by prompt_key,version desc`
  );
  return {
    aiConfigured:Boolean(process.env.OPENAI_API_KEY),
    model:process.env.OUTBOUND_COPY_MODEL||"gpt-5.6-luna",
    criticPolicy:COPY_CRITIC_POLICY_VERSION,
    counts:{
      passed:Number(counts?.passed||0),failed:Number(counts?.failed||0),
      approved:Number(counts?.approved||0),readyHypotheses:Number(counts?.proposed_hypotheses||0),
    },
    candidates,hypotheses,evalRuns,prompts,
  };
}

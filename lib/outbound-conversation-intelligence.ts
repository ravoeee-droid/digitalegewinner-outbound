import { createHash, randomUUID } from "node:crypto";
import OpenAI from "openai";
import { z } from "zod";
import { query } from "@/lib/db";
import { recordOutboundEventByMode } from "@/lib/outbound-event-ledger";
import { evaluateAutonomy } from "@/lib/outbound-policy";
import { replyClassSchema, type ReplyClass } from "@/lib/outbound-contracts";
import { resolveOutboundRuntimeConfig } from "@/lib/outbound-runtime-config";
import { createComplianceSuppression } from "@/lib/outbound-compliance-engine";

export const CONVERSATION_POLICY_VERSION="dg-conversation-2026-09-27-v1";
export const CONVERSATION_PROMPT_VERSION="reply-classifier-v1";

const actionSchema=z.enum([
  "call_now",
  "book_meeting",
  "send_information",
  "human_reply",
  "ask_referral",
  "retry_later",
  "close_loop",
  "no_action",
  "suppress",
  "legal_review",
  "human_review",
]);
const prioritySchema=z.enum(["low","normal","high","urgent"]);

const classificationSchema=z.object({
  replyClass:replyClassSchema,
  confidence:z.number().min(0).max(1),
  rationale:z.string().max(600),
  recommendedAction:actionSchema,
  priority:prioritySchema,
  requiresHuman:z.boolean(),
  draftReply:z.string().max(1800).nullable(),
});
type Classification=z.infer<typeof classificationSchema>;

type ThreadRow={
  id:string;
  lead_id:string;
  contact_id:string|null;
  company_id:string|null;
  mailbox_id:string|null;
  status:string;
};
type MessageRow={
  id:string;
  thread_id:string;
  direction:"inbound"|"outbound";
  provider_message_id:string|null;
  mailbox_id:string|null;
  subject:string;
  body_text:string;
  attempt:number;
  max_attempts:number;
};
type ConversationContext={
  leadId:string;
  contactName:string|null;
  companyName:string|null;
  city:string|null;
  latestOutboundSubject:string|null;
  latestOutboundBody:string|null;
};

function cleanText(value:string,max=12000){
  return String(value||"").replace(/\u0000/g,"").trim().slice(0,max);
}
function bodyHash(value:string){
  return createHash("sha256").update(value).digest("hex");
}
function excerpt(value:string,max=420){
  const normalized=cleanText(value,max*2).replace(/\s+/g," ");
  return normalized.slice(0,max);
}

function safetyPolicy(result:Classification,trustedOptOut=false):Classification{
  const klass=result.replyClass;
  if(klass==="legal_complaint"){
    return {...result,priority:"urgent",requiresHuman:true,recommendedAction:"legal_review",draftReply:null};
  }
  if(klass==="unsubscribe"){
    return trustedOptOut
      ? {...result,priority:"normal",requiresHuman:false,recommendedAction:"suppress",draftReply:null}
      : {...result,priority:"urgent",requiresHuman:true,recommendedAction:"human_review",draftReply:null};
  }
  if(klass==="out_of_office"){
    return {...result,priority:"low",requiresHuman:false,recommendedAction:"retry_later",draftReply:null};
  }
  if(klass==="meeting_intent"){
    return {...result,priority:"high",requiresHuman:true,recommendedAction:"book_meeting"};
  }
  if(klass==="positive"){
    return {...result,priority:"high",requiresHuman:true,recommendedAction:"call_now"};
  }
  if(klass==="referral"||klass==="not_responsible"){
    return {...result,priority:"normal",requiresHuman:true,recommendedAction:"ask_referral"};
  }
  if(klass==="needs_information"){
    return {...result,priority:"normal",requiresHuman:true,recommendedAction:"send_information"};
  }
  if(klass==="not_interested"||klass==="already_filled"){
    return {...result,priority:"normal",requiresHuman:true,recommendedAction:"close_loop"};
  }
  if(klass==="unknown"||result.confidence<0.72){
    return {...result,replyClass:"unknown",priority:"high",requiresHuman:true,recommendedAction:"human_review"};
  }
  return {...result,requiresHuman:true};
}

function heuristicClassification(subject:string,body:string):Classification{
  const text=`${subject}\n${body}`.toLowerCase();
  const has=(pattern:RegExp)=>pattern.test(text);

  if(has(/\b(out of office|automatic reply|automatische antwort|abwesen|urlaub|nicht im büro|not in the office)\b/i)){
    return safetyPolicy({replyClass:"out_of_office",confidence:0.98,rationale:"Eindeutige Abwesenheits-/Auto-Reply-Signale.",recommendedAction:"retry_later",priority:"low",requiresHuman:false,draftReply:null});
  }
  if(has(/\b(anwalt|rechtsanwalt|abmahn|dsgvo|datenschutz|unzulässig|rechtswidrig|beschwerde|legal action|lawyer)\b/i)){
    return safetyPolicy({replyClass:"legal_complaint",confidence:0.91,rationale:"Rechtliche oder Datenschutz-Beschwerde erkannt.",recommendedAction:"legal_review",priority:"urgent",requiresHuman:true,draftReply:null});
  }
  if(has(/\b(stelle|position|vakanz).{0,28}\b(besetzt|vergeben|geschlossen)\b|\bkein(?:en)? personalbedarf\b/i)){
    return safetyPolicy({replyClass:"already_filled",confidence:0.92,rationale:"Antwort deutet darauf hin, dass die Stelle bzw. der Bedarf bereits erledigt ist.",recommendedAction:"close_loop",priority:"normal",requiresHuman:true,draftReply:null});
  }
  if(has(/\b(nicht zuständig|falsche ansprechperson|bin nicht zuständig|not responsible)\b/i)){
    return safetyPolicy({replyClass:"not_responsible",confidence:0.94,rationale:"Kontakt bezeichnet sich als nicht zuständig.",recommendedAction:"ask_referral",priority:"normal",requiresHuman:true,draftReply:null});
  }
  if(has(/\b(wenden sie sich an|zuständig ist|kontaktieren sie|ansprechpartner ist|please contact)\b/i)){
    return safetyPolicy({replyClass:"referral",confidence:0.90,rationale:"Antwort verweist auf eine andere zuständige Person.",recommendedAction:"ask_referral",priority:"normal",requiresHuman:true,draftReply:null});
  }
  if(has(/\b(termin|kalender|meeting|call|telefonieren|sprechen|wann passt|zeitfenster)\b/i)&&has(/\b(gerne|ja|passt|interessiert|können|möchte|möchten)\b/i)){
    return safetyPolicy({replyClass:"meeting_intent",confidence:0.89,rationale:"Konkretes Gesprächs-/Termininteresse erkannt.",recommendedAction:"book_meeting",priority:"high",requiresHuman:true,draftReply:null});
  }
  if(has(/\b(interessiert|klingt gut|spannend|gerne mehr|ja gerne|grundsätzlich interessant)\b/i)){
    return safetyPolicy({replyClass:"positive",confidence:0.84,rationale:"Positive Kauf-/Informationsbereitschaft erkannt.",recommendedAction:"call_now",priority:"high",requiresHuman:true,draftReply:null});
  }
  if(has(/\b(mehr infos|mehr information|details|wie funktioniert|schicken sie|senden sie|unterlagen)\b/i)){
    return safetyPolicy({replyClass:"needs_information",confidence:0.84,rationale:"Kontakt bittet um weitere Informationen.",recommendedAction:"send_information",priority:"normal",requiresHuman:true,draftReply:null});
  }
  if(has(/\b(zu teuer|preis|kosten|budget|finanziell)\b/i)){
    return safetyPolicy({replyClass:"objection_price",confidence:0.80,rationale:"Preis-/Budgeteinwand erkannt.",recommendedAction:"human_reply",priority:"normal",requiresHuman:true,draftReply:null});
  }
  if(has(/\b(agentur|dienstleister|personalvermittler|intern gelöst|machen wir intern|bereits.*partner)\b/i)){
    return safetyPolicy({replyClass:"objection_existing_solution",confidence:0.80,rationale:"Bestehende Lösung bzw. Anbieter wird genannt.",recommendedAction:"human_reply",priority:"normal",requiresHuman:true,draftReply:null});
  }
  if(has(/\b(später|aktuell nicht|momentan nicht|nächstes jahr|nächsten monat|keine zeit|timing)\b/i)){
    return safetyPolicy({replyClass:"objection_timing",confidence:0.78,rationale:"Timing-Einwand erkannt.",recommendedAction:"retry_later",priority:"normal",requiresHuman:true,draftReply:null});
  }
  if(has(/\b(kein interesse|nicht interessiert|nicht interessant|kein bedarf|bitte nicht|danke,? nein)\b/i)){
    return safetyPolicy({replyClass:"not_interested",confidence:0.90,rationale:"Ablehnende Antwort erkannt.",recommendedAction:"close_loop",priority:"normal",requiresHuman:true,draftReply:null});
  }
  return safetyPolicy({
    replyClass:"unknown",
    confidence:0.45,
    rationale:"Keine ausreichend eindeutige Klasse durch die lokale Heuristik.",
    recommendedAction:"human_review",
    priority:"high",
    requiresHuman:true,
    draftReply:null,
  });
}

async function classifyWithModel(input:{
  subject:string;
  body:string;
  context:ConversationContext;
}):Promise<{classification:Classification;classifier:string;model:string|null;raw:Record<string,unknown>}>{
  const apiKey=process.env.OPENAI_API_KEY;
  const heuristic=heuristicClassification(input.subject,input.body);
  if(!apiKey){
    return {classification:heuristic,classifier:"heuristic",model:null,raw:{fallback:"OPENAI_API_KEY missing"}};
  }

  const model=process.env.OUTBOUND_REPLY_MODEL||"gpt-5.6-luna";
  const client=new OpenAI({apiKey});
  const system=[
    "You classify inbound replies to B2B outbound sales emails.",
    "Return only the requested JSON schema.",
    "Classify the CURRENT reply, not quoted history.",
    "Never infer consent, legal permission, or legal conclusions.",
    "Never invent facts, prices, guarantees, case studies, or meeting availability.",
    "A draft reply is only a human-review draft and will never be auto-sent at this autonomy level.",
    "For legal_complaint or unsubscribe, draftReply must be null.",
    "Keep draft replies concise, natural German when the reply is German, otherwise match the reply language.",
    "If uncertain, choose unknown and requiresHuman=true.",
  ].join("\n");

  const user=[
    `Company: ${input.context.companyName||"unknown"}`,
    `Contact: ${input.context.contactName||"unknown"}`,
    `City: ${input.context.city||"unknown"}`,
    `Latest outbound subject: ${input.context.latestOutboundSubject||"unknown"}`,
    `Latest outbound message:\n${cleanText(input.context.latestOutboundBody||"",3500)}`,
    `Inbound subject: ${cleanText(input.subject,500)}`,
    `CURRENT inbound reply:\n${cleanText(input.body,5000)}`,
  ].join("\n\n");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK-Typen kennen diesen Aufruf nicht
  const response=await (client.responses.create as any)({
    model,
    input:[
      {role:"system",content:[{type:"input_text",text:system}]},
      {role:"user",content:[{type:"input_text",text:user}]},
    ],
    max_output_tokens:900,
    text:{
      format:{
        type:"json_schema",
        name:"reply_classification",
        strict:true,
        schema:{
          type:"object",
          additionalProperties:false,
          required:["replyClass","confidence","rationale","recommendedAction","priority","requiresHuman","draftReply"],
          properties:{
            replyClass:{type:"string",enum:[
              "positive","meeting_intent","needs_information","objection_price","objection_existing_solution",
              "objection_timing","not_responsible","referral","not_interested","already_filled",
              "out_of_office","unsubscribe","legal_complaint","unknown"
            ]},
            confidence:{type:"number",minimum:0,maximum:1},
            rationale:{type:"string"},
            recommendedAction:{type:"string",enum:[
              "call_now","book_meeting","send_information","human_reply","ask_referral","retry_later",
              "close_loop","no_action","suppress","legal_review","human_review"
            ]},
            priority:{type:"string",enum:["low","normal","high","urgent"]},
            requiresHuman:{type:"boolean"},
            draftReply:{type:["string","null"]},
          },
        },
      },
    },
  });
  const text=String(response.output_text||"").trim();
  if(!text)throw new Error("Reply classifier returned no structured output.");
  const parsed=classificationSchema.parse(JSON.parse(text));
  return {
    classification:safetyPolicy(parsed),
    classifier:"openai-responses",
    model,
    raw:{responseId:response.id||null},
  };
}

async function loadContext(thread:ThreadRow):Promise<ConversationContext>{
  const [crm]=await query<{contact_name:string|null;company_name:string|null;city:string|null}>(
    `select c.name as contact_name,co.name as company_name,co.city
     from sales_leads l
     left join sales_contacts c on c.id=l.contact_id and c.workspace=l.workspace
     left join sales_companies co on co.id=l.company_id and co.workspace=l.workspace
     where l.workspace='default' and l.id=$1
     limit 1`,
    [thread.lead_id],
  );
  const [latest]=await query<{subject:string;body_text:string}>(
    `select subject,body_text
     from outbound_conversation_messages
     where thread_id=$1 and direction='outbound'
     order by coalesce(sent_at,created_at) desc
     limit 1`,
    [thread.id],
  );
  return {
    leadId:thread.lead_id,
    contactName:crm?.contact_name||null,
    companyName:crm?.company_name||null,
    city:crm?.city||null,
    latestOutboundSubject:latest?.subject||null,
    latestOutboundBody:latest?.body_text||null,
  };
}

async function ensureThread(leadId:string,mailboxId:string|null,workspace="default"){
  const [lead]=await query<{contact_id:string|null;company_id:string|null}>(
    `select contact_id,company_id from sales_leads where workspace=$1 and id=$2 limit 1`,
    [workspace,leadId],
  );
  const [thread]=await query<ThreadRow>(
    `insert into outbound_conversation_threads(
       workspace,lead_id,contact_id,company_id,channel,mailbox_id,status,last_message_at
     )
     values($1,$2,$3,$4,'email',$5,'open',now())
     on conflict(workspace,channel,lead_id) do update
       set contact_id=coalesce(outbound_conversation_threads.contact_id,excluded.contact_id),
           company_id=coalesce(outbound_conversation_threads.company_id,excluded.company_id),
           mailbox_id=coalesce(excluded.mailbox_id,outbound_conversation_threads.mailbox_id),
           last_message_at=now()
     returning id,lead_id,contact_id,company_id,mailbox_id,status`,
    [workspace,leadId,lead?.contact_id??null,lead?.company_id??null,mailboxId],
  );
  if(!thread)throw new Error("Conversation thread could not be created.");
  return thread;
}

export async function recordOutboundConversationMessage(input:{
  leadId:string;
  mailboxId:string;
  providerMessageId:string|null;
  subject:string;
  bodyText:string;
  sentAt?:Date;
  metadata?:Record<string,unknown>;
  workspace?:string;
}){
  const workspace=input.workspace??"default";
  const thread=await ensureThread(input.leadId,input.mailboxId,workspace);
  const body=cleanText(input.bodyText);
  const [message]=await query<{id:string}>(
    `insert into outbound_conversation_messages(
       workspace,thread_id,direction,provider_message_id,mailbox_id,subject,body_text,body_hash,
       processing_status,sent_at,metadata
     )
     values($1,$2,'outbound',$3,$4,$5,$6,$7,'ignored',$8,$9::jsonb)
     on conflict(workspace,direction,provider_message_id) where provider_message_id is not null
     do update set metadata=outbound_conversation_messages.metadata||excluded.metadata
     returning id`,
    [
      workspace,thread.id,input.providerMessageId,input.mailboxId,cleanText(input.subject,500),
      body,bodyHash(body),input.sentAt??new Date(),JSON.stringify(input.metadata??{}),
    ],
  );
  await query(
    `update outbound_conversation_threads
     set last_outbound_at=$2,last_message_at=$2,status=case when status='closed' then status else 'waiting' end
     where id=$1`,
    [thread.id,input.sentAt??new Date()],
  );
  return {threadId:thread.id,messageId:message?.id??null};
}

async function persistClassification(input:{
  thread:ThreadRow;
  message:MessageRow;
  classification:Classification;
  classifier:string;
  model:string|null;
  raw?:Record<string,unknown>;
  actorId?:string;
  humanReviewed?:boolean;
  trustedOptOut?:boolean;
}){
  const runtime=await resolveOutboundRuntimeConfig();
  const safe=safetyPolicy(input.classification,Boolean(input.trustedOptOut));
  const actorId=input.actorId??"conversation-intelligence";
  const autonomy=evaluateAutonomy(runtime.autonomyLevel,"classify_reply",input.humanReviewed??false);

  await query(
    `update outbound_reply_classifications
     set is_current=false,
         review_status=case when review_status='proposed' then 'rejected' else review_status end,
         reviewed_by=coalesce(reviewed_by,$3),
         reviewed_at=coalesce(reviewed_at,now())
     where workspace=$1 and message_id=$2 and is_current=true`,
    ["default",input.message.id,input.humanReviewed?actorId:null],
  );

  const [classification]=await query<{id:string}>(
    `insert into outbound_reply_classifications(
       workspace,thread_id,message_id,reply_class,confidence,classifier,model,rationale,
       recommended_action,priority,requires_human,draft_reply,policy_version,prompt_version,
       is_current,review_status,reviewed_by,reviewed_at,raw
     )
     values(
       'default',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true,$14,$15,$16,$17::jsonb
     )
     returning id`,
    [
      input.thread.id,input.message.id,safe.replyClass,safe.confidence,input.classifier,input.model,
      safe.rationale,safe.recommendedAction,safe.priority,safe.requiresHuman,safe.draftReply,
      CONVERSATION_POLICY_VERSION,CONVERSATION_PROMPT_VERSION,
      input.humanReviewed?"accepted":"proposed",
      input.humanReviewed?actorId:null,
      input.humanReviewed?new Date():null,
      JSON.stringify({...input.raw,autonomy}),
    ],
  );
  if(!classification)throw new Error("Reply classification could not be persisted.");

  const assist=runtime.conversationMode==="assist"||Boolean(input.humanReviewed);
  const threadStatus=input.trustedOptOut&&safe.replyClass==="unsubscribe"
    ?"suppressed"
    :assist
      ? safe.replyClass==="out_of_office"
        ?"waiting"
        :safe.requiresHuman
          ?"needs_human"
          :"open"
      :"open";

  await query(
    `update outbound_conversation_threads
     set status=$2,last_reply_class=$3,requires_human=$4,priority=$5,
         next_action=$6,next_action_at=$7,last_inbound_at=coalesce(last_inbound_at,now()),last_message_at=now()
     where id=$1`,
    [
      input.thread.id,threadStatus,safe.replyClass,assist&&safe.requiresHuman,safe.priority,
      assist&&safe.requiresHuman
        ? safe.replyClass==="meeting_intent"||safe.replyClass==="positive"
          ? "Interessenten-Antwort jetzt prüfen"
          : safe.replyClass==="legal_complaint"
            ? "Rechtliche/Datenschutz-Antwort prüfen"
            : "Antwort prüfen und nächsten Schritt festlegen"
        : assist&&safe.replyClass==="out_of_office"
          ? "Nach Abwesenheit erneut prüfen"
          : null,
      assist&&safe.requiresHuman?new Date():null,
    ],
  );

  if(assist&&safe.requiresHuman){
    const [existing]=await query<{id:string}>(
      `select id from outbound_conversation_escalations
       where workspace='default' and message_id=$1 and status in ('open','in_progress')
       limit 1`,
      [input.message.id],
    );
    if(existing){
      await query(
        `update outbound_conversation_escalations
         set classification_id=$2,reason=$3,priority=$4,recommended_action=$5,draft_reply=$6
         where id=$1`,
        [
          existing.id,classification.id,safe.rationale,safe.priority,safe.recommendedAction,safe.draftReply,
        ],
      );
    }else{
      await query(
        `insert into outbound_conversation_escalations(
           workspace,thread_id,message_id,classification_id,reason,priority,recommended_action,
           draft_reply,status,due_at
         )
         values('default',$1,$2,$3,$4,$5,$6,$7,'open',
           case when $5='urgent' then now() else now()+interval '4 hours' end
         )`,
        [
          input.thread.id,input.message.id,classification.id,safe.rationale,safe.priority,
          safe.recommendedAction,safe.draftReply,
        ],
      );
      await recordOutboundEventByMode({
        workspace:"default",
        type:"conversation_escalated",
        actorType:"agent",
        actorId,
        leadId:input.thread.lead_id,
        contactId:input.thread.contact_id,
        companyId:input.thread.company_id,
        idempotencyKey:`conversation-escalated:${classification.id}`,
        payload:{
          threadId:input.thread.id,messageId:input.message.id,classificationId:classification.id,
          replyClass:safe.replyClass,priority:safe.priority,recommendedAction:safe.recommendedAction,
        },
      });
    }
  }

  if(assist){
    await query(
      `update sales_leads
       set last_outcome=$3,
           next_action=case when $4 then
             case when $3 in ('positive','meeting_intent') then 'Antwort prüfen / Termin sichern'
                  when $3='legal_complaint' then 'Rechtliche/Datenschutz-Antwort prüfen'
                  else 'Inbound-Antwort prüfen' end
             else next_action end,
           next_action_at=case when $4 then now() else next_action_at end,
           updated_at=now()
       where workspace=$1 and id=$2`,
      ["default",input.thread.lead_id,safe.replyClass,safe.requiresHuman],
    );
  }

  await recordOutboundEventByMode({
    workspace:"default",
    type:"reply_classified",
    actorType:input.humanReviewed?"human":"agent",
    actorId,
    leadId:input.thread.lead_id,
    contactId:input.thread.contact_id,
    companyId:input.thread.company_id,
    messageId:input.message.provider_message_id,
    idempotencyKey:`reply-classified:${classification.id}`,
    payload:{
      threadId:input.thread.id,
      conversationMessageId:input.message.id,
      classificationId:classification.id,
      replyClass:safe.replyClass,
      confidence:safe.confidence,
      classifier:input.classifier,
      model:input.model,
      recommendedAction:safe.recommendedAction,
      priority:safe.priority,
      requiresHuman:safe.requiresHuman,
      autonomy,
      policyVersion:CONVERSATION_POLICY_VERSION,
      promptVersion:CONVERSATION_PROMPT_VERSION,
    },
  });

  if(assist&&safe.draftReply){
    await query(
      `insert into outbound_agent_decisions(
         workspace,agent_key,action_class,autonomy_level,subject_type,subject_id,recommendation,
         evidence,confidence,policy_version,requires_approval,status
       )
       values(
         'default','conversation-intelligence','draft',$1,'conversation_message',$2,$3::jsonb,
         $4::jsonb,$5,$6,true,'proposed'
       )`,
      [
        runtime.autonomyLevel,input.message.id,
        JSON.stringify({draftReply:safe.draftReply,replyClass:safe.replyClass}),
        JSON.stringify([{key:"classification",value:safe.replyClass,source:"conversation-intelligence",observedAt:new Date().toISOString(),confidence:safe.confidence}]),
        safe.confidence,CONVERSATION_POLICY_VERSION,
      ],
    );
    await recordOutboundEventByMode({
      workspace:"default",
      type:"reply_draft_created",
      actorType:"agent",
      actorId,
      leadId:input.thread.lead_id,
      idempotencyKey:`reply-draft-created:${classification.id}`,
      payload:{threadId:input.thread.id,messageId:input.message.id,classificationId:classification.id},
    });
  }

  return {classificationId:classification.id,...safe};
}

export async function ingestInboundConversationMessage(input:{
  leadId:string;
  mailboxId:string;
  providerMessageId:string;
  subject:string;
  bodyText:string;
  receivedAt?:Date;
  metadata?:Record<string,unknown>;
  forcedClass?:ReplyClass|null;
  workspace?:string;
}){
  const workspace=input.workspace??"default";
  const thread=await ensureThread(input.leadId,input.mailboxId,workspace);
  const body=cleanText(input.bodyText);
  const processing=input.forcedClass?"classified":"pending";

  const [message]=await query<{id:string;processing_status:string}>(
    `insert into outbound_conversation_messages(
       workspace,thread_id,direction,provider_message_id,mailbox_id,subject,body_text,body_hash,
       processing_status,received_at,metadata
     )
     values($1,$2,'inbound',$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
     on conflict(workspace,direction,provider_message_id) where provider_message_id is not null
     do update set metadata=outbound_conversation_messages.metadata||excluded.metadata
     returning id,processing_status`,
    [
      workspace,thread.id,input.providerMessageId,input.mailboxId,cleanText(input.subject,500),
      body,bodyHash(body),processing,input.receivedAt??new Date(),JSON.stringify(input.metadata??{}),
    ],
  );
  if(!message)throw new Error("Inbound conversation message could not be persisted.");

  await query(
    `update outbound_conversation_threads
     set last_inbound_at=$2,last_message_at=$2,status=case when status='suppressed' then status else 'open' end
     where id=$1`,
    [thread.id,input.receivedAt??new Date()],
  );

  await recordOutboundEventByMode({
    workspace,
    type:"conversation_message_ingested",
    actorType:"provider",
    leadId:thread.lead_id,
    contactId:thread.contact_id,
    companyId:thread.company_id,
    messageId:input.providerMessageId,
    idempotencyKey:`conversation-inbound:${message.id}`,
    payload:{threadId:thread.id,conversationMessageId:message.id,mailboxId:input.mailboxId,subject:cleanText(input.subject,200)},
  });

  if(input.forcedClass){
    const forced=safetyPolicy({
      replyClass:input.forcedClass,
      confidence:1,
      rationale:input.forcedClass==="unsubscribe"?"Explicit deterministic opt-out matched before AI classification.":"Deterministic forced classification.",
      recommendedAction:input.forcedClass==="unsubscribe"?"suppress":"human_review",
      priority:input.forcedClass==="unsubscribe"?"normal":"high",
      requiresHuman:input.forcedClass!=="unsubscribe",
      draftReply:null,
    },true);
    await persistClassification({
      thread,
      message:{...message,thread_id:thread.id,direction:"inbound",provider_message_id:input.providerMessageId,mailbox_id:input.mailboxId,subject:input.subject,body_text:body,attempt:0,max_attempts:5},
      classification:forced,
      classifier:"deterministic-safety",
      model:null,
      raw:{forced:true},
      trustedOptOut:input.forcedClass==="unsubscribe",
    });
  }

  return {threadId:thread.id,messageId:message.id,queuedForClassification:!input.forcedClass};
}

async function claimPendingMessages(workerId:string,limit:number){
  return query<MessageRow>(
    `with claim as (
       select id
       from outbound_conversation_messages
       where workspace='default'
         and direction='inbound'
         and processing_status in ('pending','processing')
         and attempt<max_attempts
         and (processing_status='pending' or lease_expires_at is null or lease_expires_at<now())
       order by created_at asc
       for update skip locked
       limit $1
     )
     update outbound_conversation_messages m
     set processing_status='processing',
         attempt=m.attempt+1,
         lease_owner=$2,
         lease_expires_at=now()+interval '90 seconds',
         last_error=null
     from claim
     where m.id=claim.id
     returning m.id,m.thread_id,m.direction,m.provider_message_id,m.mailbox_id,m.subject,m.body_text,m.attempt,m.max_attempts`,
    [limit,workerId],
  );
}

async function markClassificationFailure(message:MessageRow,error:unknown){
  const messageText=error instanceof Error?error.message:"Conversation classification failed";
  const terminal=message.attempt>=message.max_attempts;
  await query(
    `update outbound_conversation_messages
     set processing_status=$2,lease_owner=null,lease_expires_at=null,last_error=$3
     where id=$1`,
    [message.id,terminal?"failed":"pending",messageText],
  );
  if(terminal){
    const [thread]=await query<ThreadRow>(
      `select id,lead_id,contact_id,company_id,mailbox_id,status
       from outbound_conversation_threads where id=$1 limit 1`,
      [message.thread_id],
    );
    if(thread){
      const fallback=safetyPolicy({
        replyClass:"unknown",
        confidence:0,
        rationale:"Automatische Klassifizierung ist nach mehreren Versuchen fehlgeschlagen.",
        recommendedAction:"human_review",
        priority:"urgent",
        requiresHuman:true,
        draftReply:null,
      });
      await persistClassification({
        thread,message,classification:fallback,classifier:"classification-failure",model:null,
        raw:{error:messageText,attempts:message.attempt},
      });
      await query(
        `update outbound_conversation_messages
         set processing_status='classified',lease_owner=null,lease_expires_at=null
         where id=$1`,
        [message.id],
      );
    }
  }
}

export async function processPendingConversationMessages(limit=8){
  const runtime=await resolveOutboundRuntimeConfig();
  if(runtime.conversationMode==="off")return {enabled:false,mode:"off",claimed:0,classified:0,failed:0};
  const workerId=`conversation-${randomUUID()}`;
  const claimed=await claimPendingMessages(workerId,Math.max(1,Math.min(20,limit)));
  let classified=0,failed=0;

  for(const message of claimed){
    try{
      const [thread]=await query<ThreadRow>(
        `select id,lead_id,contact_id,company_id,mailbox_id,status
         from outbound_conversation_threads
         where id=$1 limit 1`,
        [message.thread_id],
      );
      if(!thread)throw new Error("Conversation thread missing.");
      const context=await loadContext(thread);
      const result=await classifyWithModel({subject:message.subject,body:message.body_text,context});
      await persistClassification({
        thread,message,classification:result.classification,classifier:result.classifier,model:result.model,raw:result.raw,
      });
      await query(
        `update outbound_conversation_messages
         set processing_status='classified',lease_owner=null,lease_expires_at=null,last_error=null
         where id=$1`,
        [message.id],
      );
      classified++;
    }catch(error){
      await markClassificationFailure(message,error);
      failed++;
    }
  }
  return {enabled:true,mode:runtime.conversationMode,workerId,claimed:claimed.length,classified,failed};
}

export async function humanReclassify(input:{
  messageId:string;
  replyClass:ReplyClass;
  reason:string;
  actorId?:string;
}){
  const actorId=input.actorId??"admin-session";
  const [message]=await query<MessageRow>(
    `select id,thread_id,direction,provider_message_id,mailbox_id,subject,body_text,attempt,max_attempts
     from outbound_conversation_messages where workspace='default' and id=$1 limit 1`,
    [input.messageId],
  );
  if(!message)throw new Error("Conversation message not found.");
  const [thread]=await query<ThreadRow>(
    `select id,lead_id,contact_id,company_id,mailbox_id,status
     from outbound_conversation_threads where id=$1 limit 1`,
    [message.thread_id],
  );
  if(!thread)throw new Error("Conversation thread not found.");

  const manual=safetyPolicy({
    replyClass:input.replyClass,
    confidence:1,
    rationale:input.reason,
    recommendedAction:"human_review",
    priority:"normal",
    requiresHuman:input.replyClass!=="out_of_office"&&input.replyClass!=="unsubscribe",
    draftReply:null,
  },input.replyClass==="unsubscribe");
  const result=await persistClassification({
    thread,message,classification:manual,classifier:"human",model:null,
    raw:{reason:input.reason},actorId,humanReviewed:true,
    trustedOptOut:input.replyClass==="unsubscribe",
  });

  if(input.replyClass==="unsubscribe"){
    const [contact]=await query<{email:string|null}>(
      `select c.email
       from sales_leads l
       left join sales_contacts c on c.id=l.contact_id and c.workspace=l.workspace
       where l.workspace='default' and l.id=$1
       limit 1`,
      [thread.lead_id],
    );
    if(contact?.email){
      await createComplianceSuppression({
        email:contact.email,
        reason:"unsubscribe",
        source:"human-reclassification",
        evidenceSummary:input.reason,
        leadId:thread.lead_id,
        actorId,
        workspace:"default",
      });
    }
  }
  return result;
}

export async function resolveConversationEscalation(input:{
  escalationId:string;
  resolution:string;
  actorId?:string;
}){
  const actorId=input.actorId??"admin-session";
  const [row]=await query<{id:string;thread_id:string;message_id:string}>(
    `update outbound_conversation_escalations
     set status='resolved',resolution=$2,resolved_by=$3,resolved_at=now()
     where workspace='default' and id=$1 and status in ('open','in_progress')
     returning id,thread_id,message_id`,
    [input.escalationId,input.resolution,actorId],
  );
  if(!row)throw new Error("Escalation not found or already resolved.");

  const [open]=await query<{count:string}>(
    `select count(*)::text as count from outbound_conversation_escalations
     where thread_id=$1 and status in ('open','in_progress')`,
    [row.thread_id],
  );
  if(Number(open?.count||0)===0){
    await query(
      `update outbound_conversation_threads
       set requires_human=false,status=case when status='needs_human' then 'open' else status end
       where id=$1`,
      [row.thread_id],
    );
  }
  await recordOutboundEventByMode({
    workspace:"default",
    type:"conversation_escalation_resolved",
    actorType:"human",
    actorId,
    idempotencyKey:`conversation-escalation-resolved:${row.id}`,
    payload:{escalationId:row.id,threadId:row.thread_id,messageId:row.message_id,resolution:input.resolution},
  });
  return row;
}

export async function getConversationDashboard(){
  const runtime=await resolveOutboundRuntimeConfig();
  const [counts]=await query<{
    pending:string;open_escalations:string;classified24h:string;high_intent24h:string;failed:string
  }>(
    `select
      (select count(*) from outbound_conversation_messages where workspace='default' and direction='inbound' and processing_status in ('pending','processing'))::text as pending,
      (select count(*) from outbound_conversation_escalations where workspace='default' and status in ('open','in_progress'))::text as open_escalations,
      (select count(*) from outbound_reply_classifications where workspace='default' and is_current=true and created_at>=now()-interval '24 hours')::text as classified24h,
      (select count(*) from outbound_reply_classifications where workspace='default' and is_current=true and reply_class in ('positive','meeting_intent') and created_at>=now()-interval '24 hours')::text as high_intent24h,
      (select count(*) from outbound_conversation_messages where workspace='default' and direction='inbound' and processing_status='failed')::text as failed`
  );

  const escalations=await query<{
    id:string;thread_id:string;message_id:string;classification_id:string|null;reason:string;priority:string;
    recommended_action:string|null;draft_reply:string|null;status:string;due_at:Date|null;created_at:Date;
    reply_class:string|null;confidence:number|null;subject:string;body_text:string;lead_id:string;
    contact_name:string|null;email:string|null;company_name:string|null
  }>(
    `select e.id,e.thread_id,e.message_id,e.classification_id,e.reason,e.priority,e.recommended_action,
            e.draft_reply,e.status,e.due_at,e.created_at,c.reply_class,c.confidence,m.subject,m.body_text,
            t.lead_id,ct.name as contact_name,ct.email,co.name as company_name
     from outbound_conversation_escalations e
     join outbound_conversation_threads t on t.id=e.thread_id
     join outbound_conversation_messages m on m.id=e.message_id
     left join outbound_reply_classifications c on c.id=e.classification_id
     left join sales_contacts ct on ct.id=t.contact_id and ct.workspace=t.workspace
     left join sales_companies co on co.id=t.company_id and co.workspace=t.workspace
     where e.workspace='default' and e.status in ('open','in_progress')
     order by case e.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end,e.created_at asc
     limit 100`
  );

  const recent=await query<{
    thread_id:string;lead_id:string;status:string;last_reply_class:string|null;requires_human:boolean;
    priority:string;last_message_at:Date|null;contact_name:string|null;email:string|null;company_name:string|null;
    subject:string|null;body_text:string|null;confidence:number|null
  }>(
    `select t.id as thread_id,t.lead_id,t.status,t.last_reply_class,t.requires_human,t.priority,t.last_message_at,
            ct.name as contact_name,ct.email,co.name as company_name,m.subject,m.body_text,c.confidence
     from outbound_conversation_threads t
     left join sales_contacts ct on ct.id=t.contact_id and ct.workspace=t.workspace
     left join sales_companies co on co.id=t.company_id and co.workspace=t.workspace
     left join lateral (
       select id,subject,body_text from outbound_conversation_messages
       where thread_id=t.id and direction='inbound'
       order by coalesce(received_at,created_at) desc limit 1
     ) m on true
     left join outbound_reply_classifications c on c.message_id=m.id and c.is_current=true
     where t.workspace='default'
     order by t.last_message_at desc nulls last
     limit 100`
  );

  return {
    mode:runtime.conversationMode,
    autonomyLevel:runtime.autonomyLevel,
    aiConfigured:Boolean(process.env.OPENAI_API_KEY),
    model:process.env.OUTBOUND_REPLY_MODEL||"gpt-5.6-luna",
    policyVersion:CONVERSATION_POLICY_VERSION,
    promptVersion:CONVERSATION_PROMPT_VERSION,
    counts:{
      pending:Number(counts?.pending||0),
      openEscalations:Number(counts?.open_escalations||0),
      classified24h:Number(counts?.classified24h||0),
      highIntent24h:Number(counts?.high_intent24h||0),
      failed:Number(counts?.failed||0),
    },
    escalations:escalations.map(row=>({...row,body_text:excerpt(row.body_text,700)})),
    recent:recent.map(row=>({...row,body_text:excerpt(row.body_text||"",500)})),
  };
}

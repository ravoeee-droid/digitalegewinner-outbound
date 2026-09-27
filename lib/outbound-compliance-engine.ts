import { createHash } from "node:crypto";
import { z } from "zod";
import { query } from "@/lib/db";
import { recordOutboundEventByMode } from "@/lib/outbound-event-ledger";
import { COMPLIANCE_POLICY_VERSION, evaluateCompliance } from "@/lib/outbound-policy";
import { permissionRecordSchema, type PermissionBasis, type PermissionRecord } from "@/lib/outbound-contracts";
import { evaluateEmailSendCompliance } from "@/lib/outbound-compliance-runtime";
import { recordWorkflowSignal } from "@/lib/outbound-durable-workflows";
import { resolveOutboundRuntimeConfig } from "@/lib/outbound-runtime-config";

const channelSchema=z.enum(["email","phone","whatsapp","linkedin","sms","other"]);
const basisSchema=z.enum([
  "explicit_consent",
  "existing_customer_exception",
  "human_verified_business_expectation",
  "inbound_request",
  "contractual_necessity",
  "unknown",
  "denied",
]);

export const permissionReviewRequestSchema=z.object({
  contactId:z.string().min(1).optional().nullable(),
  companyId:z.string().min(1).optional().nullable(),
  channel:channelSchema.default("email"),
  jurisdiction:z.string().min(2).max(32).default("DE"),
  basis:basisSchema,
  source:z.string().min(2).max(500),
  evidenceSummary:z.string().min(10).max(4000),
}).superRefine((value,ctx)=>{
  if(!value.contactId&&!value.companyId){
    ctx.addIssue({code:"custom",path:["contactId"],message:"Contact oder Company ist erforderlich."});
  }
});

export const permissionReviewDecisionSchema=z.object({
  reviewId:z.string().uuid(),
  decision:z.enum(["approved","rejected"]),
  reason:z.string().min(5).max(2000),
});

export const suppressionRequestSchema=z.object({
  email:z.string().email(),
  reason:z.enum(["unsubscribe","bounce","complaint","legal","manual","do_not_contact","other"]).default("manual"),
  source:z.string().min(2).max(500).default("manual"),
  evidenceSummary:z.string().max(4000).optional().default(""),
  leadId:z.string().min(1).optional().nullable(),
});

function hashEvidence(input:unknown){
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function normalizeEmail(value:string){return value.trim().toLowerCase()}

function stripQuotedHistory(text:string){
  const normalized=text.replace(/\r\n/g,"\n").trim();
  const markers=[
    /\nOn .{0,180} wrote:\s*$/im,
    /\nAm .{0,180} schrieb .{0,180}:\s*$/im,
    /\nVon:\s*.{0,180}$/im,
    /\nFrom:\s*.{0,180}$/im,
    /\n-{2,}\s*Original Message\s*-{2,}/im,
  ];
  let cut=normalized.length;
  for(const marker of markers){
    const match=marker.exec(normalized);
    if(match&&match.index<cut)cut=match.index;
  }
  return normalized.slice(0,cut).slice(0,2500);
}

const explicitOptOutPatterns=[
  /\bbitte\s+(?:keine|keinen)\s+(?:weiteren?\s+)?(?:e-?mails?|nachrichten|werbung)\b/i,
  /\b(?:nicht|nie)\s+mehr\s+(?:kontaktieren|anschreiben|mailen)\b/i,
  /\b(?:löschen|entfernen)\s+sie\s+(?:mich|meine\s+daten)\b/i,
  /\bich\s+möchte\s+(?:keine|keinen)\s+(?:weiteren?\s+)?kontakt\b/i,
  /\bbitte\s+(?:aus|von)\s+(?:dem|ihrem)\s+verteiler\s+(?:nehmen|löschen|entfernen)\b/i,
  /\babmelden\b/i,
  /\bkeine\s+werbung\b/i,
  /\bunsubscribe\b/i,
  /\bstop\s+(?:emailing|emails?|contacting)\b/i,
  /\bdo\s+not\s+(?:email|contact)\s+me\b/i,
  /\bremove\s+me\s+from\s+(?:your|the)\s+(?:list|mailing\s+list)\b/i,
  /\bno\s+more\s+emails?\b/i,
];

export function detectExplicitOptOut(text:string){
  const current=stripQuotedHistory(text);
  for(const pattern of explicitOptOutPatterns){
    const match=pattern.exec(current);
    if(match){
      return {matched:true,phrase:match[0].slice(0,160),excerpt:current.slice(0,500)};
    }
  }
  return {matched:false,phrase:null,excerpt:current.slice(0,500)};
}

async function lookupLeadByEmail(email:string,workspace="default"){
  const [row]=await query<{
    lead_id:string;contact_id:string|null;company_id:string|null;contact_name:string|null;company_name:string|null
  }>(
    `select l.id as lead_id,l.contact_id,l.company_id,c.name as contact_name,co.name as company_name
     from sales_leads l
     join sales_contacts c on c.id=l.contact_id and c.workspace=l.workspace
     left join sales_companies co on co.id=l.company_id and co.workspace=l.workspace
     where l.workspace=$1 and lower(c.email)=lower($2)
     order by l.updated_at desc
     limit 1`,
    [workspace,email],
  );
  return row??null;
}

export async function createComplianceSuppression(input:z.infer<typeof suppressionRequestSchema>&{
  actorId?:string;
  evidence?:Record<string,unknown>;
  messageId?:string|null;
  mailboxId?:string|null;
  workspace?:string;
}){
  const workspace=input.workspace??"default";
  const actorId=input.actorId??"system";
  const email=normalizeEmail(input.email);
  const lead=input.leadId
    ? (await query<{lead_id:string;contact_id:string|null;company_id:string|null}>(
        `select id as lead_id,contact_id,company_id from sales_leads where workspace=$1 and id=$2 limit 1`,
        [workspace,input.leadId],
      ))[0]??null
    : await lookupLeadByEmail(email,workspace);

  const evidence={
    summary:input.evidenceSummary||"",
    ...(input.evidence||{}),
    messageId:input.messageId??null,
    mailboxId:input.mailboxId??null,
  };

  const [suppression]=await query<{id:string;inserted:boolean}>(
    `insert into outbound_compliance_suppressions(
       workspace,channel,identifier,contact_id,company_id,lead_id,reason,status,source,evidence,created_by
     )
     values($1,'email',$2,$3,$4,$5,$6,'active',$7,$8::jsonb,$9)
     on conflict(workspace,channel,lower(identifier)) where status='active'
     do update set
       contact_id=coalesce(outbound_compliance_suppressions.contact_id,excluded.contact_id),
       company_id=coalesce(outbound_compliance_suppressions.company_id,excluded.company_id),
       lead_id=coalesce(outbound_compliance_suppressions.lead_id,excluded.lead_id),
       reason=excluded.reason,
       source=excluded.source,
       evidence=outbound_compliance_suppressions.evidence||excluded.evidence
     returning id,(xmax=0) as inserted`,
    [
      workspace,email,lead?.contact_id??null,lead?.company_id??null,lead?.lead_id??null,
      input.reason,input.source,JSON.stringify(evidence),actorId,
    ],
  );

  await query(
    `insert into er_suppressions(workspace,email,reason)
     values($1,lower($2),$3)
     on conflict(workspace,email) do update set reason=excluded.reason`,
    [workspace,email,input.reason],
  );

  if(lead?.lead_id){
    await query(
      `update sales_leads
       set do_not_contact=true,
           last_outcome=$3,
           next_action=null,
           next_action_at=null,
           updated_at=now()
       where workspace=$1 and id=$2`,
      [workspace,lead.lead_id,input.reason],
    );
    await query(
      `update er_outbox
       set status='suppressed',error=$3
       where workspace=$1 and lead_id=$2 and status='queued'`,
      [workspace,lead.lead_id,`Compliance suppression: ${input.reason}`],
    );
  }

  if(lead?.contact_id||lead?.company_id){
    const revoked=await query<{id:string}>(
      `update outbound_contact_permissions
       set status='revoked',revoked_at=now(),decision_reason=$4
       where workspace=$1
         and channel='email'
         and status in ('verified','unverified')
         and (
           ($2::text is not null and contact_id=$2)
           or ($3::text is not null and company_id=$3)
         )
       returning id`,
      [workspace,lead?.contact_id??null,lead?.company_id??null,`Suppressed: ${input.reason}`],
    );
    for(const permission of revoked){
      await recordOutboundEventByMode({
        workspace,
        type:"permission_revoked",
        actorType:actorId==="system"?"system":"human",
        actorId,
        companyId:lead?.company_id??null,
        contactId:lead?.contact_id??null,
        leadId:lead?.lead_id??null,
        idempotencyKey:`permission-revoked:${permission.id}:${suppression?.id??email}`,
        payload:{permissionId:permission.id,suppressionId:suppression?.id??null,reason:input.reason},
      });
    }
  }

  await recordOutboundEventByMode({
    workspace,
    type:input.reason==="unsubscribe"?"unsubscribe":"suppression_created",
    actorType:actorId==="system"?"system":"human",
    actorId,
    companyId:lead?.company_id??null,
    contactId:lead?.contact_id??null,
    leadId:lead?.lead_id??null,
    messageId:input.messageId??null,
    idempotencyKey:`suppression:${workspace}:email:${email}:${suppression?.id??"active"}`,
    payload:{suppressionId:suppression?.id??null,email,reason:input.reason,source:input.source,evidence},
  });

  if(lead?.lead_id&&(await resolveOutboundRuntimeConfig(workspace)).durableWorkflowsMode!=="off"){
    await recordWorkflowSignal({
      workspace,
      type:"unsubscribe",
      subjectType:"lead",
      subjectId:lead.lead_id,
      idempotencyKey:`suppression:${suppression?.id??email}`,
      payload:{email,reason:input.reason,source:input.source,messageId:input.messageId??null},
    });
  }

  return {id:suppression?.id??null,email,leadId:lead?.lead_id??null};
}

export async function requestPermissionReview(
  raw:z.infer<typeof permissionReviewRequestSchema>,
  actorId="admin-session",
  workspace="default",
){
  const input=permissionReviewRequestSchema.parse(raw);
  const evidence={
    summary:input.evidenceSummary,
    source:input.source,
    requestedAt:new Date().toISOString(),
  };
  const [review]=await query<{id:string}>(
    `insert into outbound_permission_reviews(
       workspace,company_id,contact_id,channel,jurisdiction,requested_basis,status,
       source,evidence,requested_by
     )
     values($1,$2,$3,$4,$5,$6,'pending',$7,$8::jsonb,$9)
     returning id`,
    [
      workspace,input.companyId??null,input.contactId??null,input.channel,input.jurisdiction,
      input.basis,input.source,JSON.stringify(evidence),actorId,
    ],
  );
  if(!review)throw new Error("Permission Review konnte nicht erstellt werden.");

  await recordOutboundEventByMode({
    workspace,
    type:"permission_review_requested",
    actorType:"human",
    actorId,
    companyId:input.companyId??null,
    contactId:input.contactId??null,
    idempotencyKey:`permission-review-requested:${review.id}`,
    payload:{reviewId:review.id,channel:input.channel,jurisdiction:input.jurisdiction,basis:input.basis,source:input.source},
  });
  return review;
}

type ReviewRow={
  id:string;company_id:string|null;contact_id:string|null;channel:string;jurisdiction:string;
  requested_basis:PermissionBasis;status:string;source:string|null;evidence:Record<string,unknown>;
  requested_by:string;
};

export async function decidePermissionReview(
  raw:z.infer<typeof permissionReviewDecisionSchema>,
  actorId="admin-session",
  workspace="default",
){
  const input=permissionReviewDecisionSchema.parse(raw);
  const [review]=await query<ReviewRow>(
    `select id,company_id,contact_id,channel,jurisdiction,requested_basis,status,source,evidence,requested_by
     from outbound_permission_reviews
     where workspace=$1 and id=$2
     for update`,
    [workspace,input.reviewId],
  );
  if(!review)throw new Error("Permission Review nicht gefunden.");
  if(review.status!=="pending")throw new Error("Permission Review wurde bereits entschieden.");

  if(input.decision==="rejected"){
    await query(
      `update outbound_permission_reviews
       set status='rejected',reviewed_by=$3,reviewed_at=now(),decision_reason=$4
       where workspace=$1 and id=$2`,
      [workspace,review.id,actorId,input.reason],
    );
    await recordOutboundEventByMode({
      workspace,
      type:"permission_review_rejected",
      actorType:"human",
      actorId,
      companyId:review.company_id,
      contactId:review.contact_id,
      idempotencyKey:`permission-review-rejected:${review.id}`,
      payload:{reviewId:review.id,reason:input.reason},
    });
    return {reviewId:review.id,status:"rejected" as const,permissionId:null};
  }

  const provisional=permissionRecordSchema.parse({
    workspace,
    companyId:review.company_id,
    contactId:review.contact_id,
    channel:review.channel,
    jurisdiction:review.jurisdiction,
    basis:review.requested_basis,
    status:"verified",
    policyVersion:COMPLIANCE_POLICY_VERSION,
    source:review.source||"review",
    evidence:review.evidence||{},
    verifiedBy:actorId,
    verifiedAt:new Date(),
    validFrom:new Date(),
  });
  const policyDecision=evaluateCompliance({
    jurisdiction:review.jurisdiction,
    channel:provisional.channel,
    permission:provisional,
  });
  if(!policyDecision.allowed){
    throw new Error(`Diese Basis ist unter der aktuellen Produkt-Policy für ${review.channel}/${review.jurisdiction} nicht freigabefähig: ${policyDecision.reason}`);
  }

  const evidenceHash=hashEvidence(review.evidence||{});
  const [previous]=await query<{id:string}>(
    `select id from outbound_contact_permissions
     where workspace=$1
       and channel=$2
       and (
         ($3::text is not null and contact_id=$3)
         or ($4::text is not null and company_id=$4)
       )
       and status in ('verified','unverified')
     order by updated_at desc
     limit 1`,
    [workspace,review.channel,review.contact_id,review.company_id],
  );

  const [permission]=await query<{id:string}>(
    `insert into outbound_contact_permissions(
       workspace,company_id,contact_id,channel,jurisdiction,basis,status,policy_version,
       source,evidence,verified_by,verified_at,valid_from,verification_level,evidence_hash,
       decision_reason,supersedes_id
     )
     values($1,$2,$3,$4,$5,$6,'verified',$7,$8,$9::jsonb,$10,now(),now(),'human',$11,$12,$13)
     returning id`,
    [
      workspace,review.company_id,review.contact_id,review.channel,review.jurisdiction,
      review.requested_basis,COMPLIANCE_POLICY_VERSION,review.source,JSON.stringify(review.evidence||{}),
      actorId,evidenceHash,input.reason,previous?.id??null,
    ],
  );
  if(!permission)throw new Error("Permission konnte nicht angelegt werden.");

  if(previous?.id){
    await query(
      `update outbound_contact_permissions
       set status='revoked',revoked_at=now(),decision_reason='Superseded by newer verified permission'
       where workspace=$1 and id=$2`,
      [workspace,previous.id],
    );
  }

  await query(
    `update outbound_permission_reviews
     set status='approved',reviewed_by=$3,reviewed_at=now(),decision_reason=$4,permission_id=$5
     where workspace=$1 and id=$2`,
    [workspace,review.id,actorId,input.reason,permission.id],
  );

  await recordOutboundEventByMode({
    workspace,
    type:"permission_review_approved",
    actorType:"human",
    actorId,
    companyId:review.company_id,
    contactId:review.contact_id,
    idempotencyKey:`permission-review-approved:${review.id}`,
    payload:{reviewId:review.id,permissionId:permission.id,basis:review.requested_basis,reason:input.reason},
  });
  await recordOutboundEventByMode({
    workspace,
    type:"permission_verified",
    actorType:"human",
    actorId,
    companyId:review.company_id,
    contactId:review.contact_id,
    idempotencyKey:`permission-verified:${permission.id}`,
    payload:{permissionId:permission.id,reviewId:review.id,basis:review.requested_basis,policyVersion:COMPLIANCE_POLICY_VERSION},
  });

  return {reviewId:review.id,status:"approved" as const,permissionId:permission.id};
}

export async function getComplianceEnforcementReadiness(workspace="default"){
  const queued=await query<{lead_id:string;recipient:string}>(
    `select distinct lead_id,recipient
     from er_outbox
     where workspace=$1 and status in ('queued','sending')
     limit 2500`,
    [workspace],
  );
  const reasons:Record<string,number>={};
  let allowed=0,blocked=0;
  for(const row of queued){
    const result=await evaluateEmailSendCompliance(row.lead_id,row.recipient,workspace);
    if(result.decision.allowed)allowed++;
    else{
      blocked++;
      reasons[result.decision.reason]=(reasons[result.decision.reason]||0)+1;
    }
  }
  const [pending]=await query<{count:string}>(
    `select count(*)::text as count
     from outbound_permission_reviews
     where workspace=$1 and status='pending'`,
    [workspace],
  );
  return {
    queued:queued.length,
    allowed,
    blocked,
    reasons,
    pendingReviews:Number(pending?.count||0),
    ready:blocked===0,
  };
}

export async function getComplianceDashboard(workspace="default"){
  const [counts]=await query<{
    email_contacts:string;verified_permissions:string;active_suppressions:string;pending_reviews:string
  }>(
    `select
       (select count(distinct c.id)
        from sales_contacts c
        join sales_leads l on l.contact_id=c.id and l.workspace=c.workspace
        where c.workspace=$1 and c.email is not null and btrim(c.email)<>'')::text as email_contacts,
       (select count(*)
        from outbound_contact_permissions p
        where p.workspace=$1 and p.channel='email' and p.status='verified')::text as verified_permissions,
       (select count(*)
        from outbound_compliance_suppressions s
        where s.workspace=$1 and s.status='active')::text as active_suppressions,
       (select count(*)
        from outbound_permission_reviews r
        where r.workspace=$1 and r.status='pending')::text as pending_reviews`,
    [workspace],
  );

  const reviews=await query<{
    id:string;company_id:string|null;contact_id:string|null;channel:string;jurisdiction:string;
    requested_basis:string;status:string;source:string|null;evidence:Record<string,unknown>;
    requested_by:string;reviewed_by:string|null;reviewed_at:Date|null;decision_reason:string|null;created_at:Date;
    contact_name:string|null;email:string|null;company_name:string|null
  }>(
    `select r.id,r.company_id,r.contact_id,r.channel,r.jurisdiction,r.requested_basis,r.status,
            r.source,r.evidence,r.requested_by,r.reviewed_by,r.reviewed_at,r.decision_reason,r.created_at,
            c.name as contact_name,c.email,co.name as company_name
     from outbound_permission_reviews r
     left join sales_contacts c on c.id=r.contact_id and c.workspace=r.workspace
     left join sales_companies co on co.id=coalesce(r.company_id,c.company_id) and co.workspace=r.workspace
     where r.workspace=$1
     order by case when r.status='pending' then 0 else 1 end,r.created_at desc
     limit 80`,
    [workspace],
  );

  const permissions=await query<{
    id:string;company_id:string|null;contact_id:string|null;channel:string;jurisdiction:string;
    basis:string;status:string;source:string|null;verified_by:string|null;verified_at:Date|null;
    valid_until:Date|null;decision_reason:string|null;updated_at:Date;
    contact_name:string|null;email:string|null;company_name:string|null
  }>(
    `select p.id,p.company_id,p.contact_id,p.channel,p.jurisdiction,p.basis,p.status,p.source,
            p.verified_by,p.verified_at,p.valid_until,p.decision_reason,p.updated_at,
            c.name as contact_name,c.email,co.name as company_name
     from outbound_contact_permissions p
     left join sales_contacts c on c.id=p.contact_id and c.workspace=p.workspace
     left join sales_companies co on co.id=coalesce(p.company_id,c.company_id) and co.workspace=p.workspace
     where p.workspace=$1
     order by p.updated_at desc
     limit 80`,
    [workspace],
  );

  const suppressions=await query<{
    id:string;identifier:string;reason:string;status:string;source:string|null;created_by:string;created_at:Date;
    contact_id:string|null;company_id:string|null;lead_id:string|null
  }>(
    `select id,identifier,reason,status,source,created_by,created_at,contact_id,company_id,lead_id
     from outbound_compliance_suppressions
     where workspace=$1
     order by created_at desc
     limit 80`,
    [workspace],
  );

  const candidates=await query<{
    lead_id:string;contact_id:string;company_id:string|null;contact_name:string|null;email:string;company_name:string|null;city:string|null
  }>(
    `select l.id as lead_id,c.id as contact_id,l.company_id,c.name as contact_name,c.email,
            co.name as company_name,co.city
     from sales_leads l
     join sales_contacts c on c.id=l.contact_id and c.workspace=l.workspace
     left join sales_companies co on co.id=l.company_id and co.workspace=l.workspace
     where l.workspace=$1
       and c.email is not null and btrim(c.email)<>''
       and coalesce(l.do_not_contact,false)=false
       and not exists (
         select 1 from outbound_contact_permissions p
         where p.workspace=l.workspace
           and p.channel='email'
           and p.status='verified'
           and (p.contact_id=c.id or (p.contact_id is null and p.company_id=l.company_id))
       )
       and not exists (
         select 1 from outbound_compliance_suppressions s
         where s.workspace=l.workspace and s.channel='email'
           and lower(s.identifier)=lower(c.email) and s.status='active'
       )
     order by l.priority_score desc nulls last,l.updated_at desc
     limit 100`,
    [workspace],
  );

  return {
    counts:{
      emailContacts:Number(counts?.email_contacts||0),
      verifiedPermissions:Number(counts?.verified_permissions||0),
      activeSuppressions:Number(counts?.active_suppressions||0),
      pendingReviews:Number(counts?.pending_reviews||0),
    },
    readiness:await getComplianceEnforcementReadiness(workspace),
    reviews,
    permissions,
    suppressions,
    candidates,
    policyVersion:COMPLIANCE_POLICY_VERSION,
  };
}

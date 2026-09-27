import { query } from "@/lib/db";
import { permissionRecordSchema, type PermissionRecord } from "@/lib/outbound-contracts";
import { evaluateCompliance, type ComplianceDecision } from "@/lib/outbound-policy";

type LeadContextRow={
  lead_id:string;
  company_id:string|null;
  contact_id:string|null;
  do_not_contact:boolean;
  company_metadata:Record<string,unknown>|null;
};

type PermissionRow={
  id:string;
  workspace:string;
  company_id:string|null;
  contact_id:string|null;
  channel:"email";
  jurisdiction:string;
  basis:string;
  status:string;
  policy_version:string;
  source:string|null;
  evidence:Record<string,unknown>|null;
  verified_by:string|null;
  verified_at:Date|null;
  valid_from:Date|null;
  valid_until:Date|null;
  revoked_at:Date|null;
};

export type SendComplianceEvaluation={
  decision:ComplianceDecision;
  leadId:string;
  companyId:string|null;
  contactId:string|null;
  jurisdiction:string;
  permission:PermissionRecord|null;
  suppressed:boolean;
  doNotContact:boolean;
};

function metadataJurisdiction(metadata:Record<string,unknown>|null){
  if(!metadata)return "UNSPECIFIED";
  for(const key of ["countryCode","country_code","jurisdiction","country"]){
    const value=metadata[key];
    if(typeof value==="string"&&value.trim())return value.trim();
  }
  return "UNSPECIFIED";
}

function toPermission(row:PermissionRow):PermissionRecord{
  return permissionRecordSchema.parse({
    id:row.id,
    workspace:row.workspace,
    companyId:row.company_id,
    contactId:row.contact_id,
    channel:row.channel,
    jurisdiction:row.jurisdiction,
    basis:row.basis,
    status:row.status,
    policyVersion:row.policy_version,
    source:row.source,
    evidence:row.evidence||{},
    verifiedBy:row.verified_by,
    verifiedAt:row.verified_at,
    validFrom:row.valid_from,
    validUntil:row.valid_until,
    revokedAt:row.revoked_at,
  });
}

export async function evaluateEmailSendCompliance(
  leadId:string,
  recipient:string,
  workspace="default",
):Promise<SendComplianceEvaluation>{
  const [lead]=await query<LeadContextRow>(
    `select
       l.id as lead_id,
       l.company_id,
       l.contact_id,
       coalesce(l.do_not_contact,false) as do_not_contact,
       co.metadata as company_metadata
     from sales_leads l
     left join sales_companies co
       on co.id=l.company_id and co.workspace=l.workspace
     where l.workspace=$1 and l.id=$2
     limit 1`,
    [workspace,leadId],
  );

  const [suppression]=await query<{exists:boolean}>(
    `select exists(
       select 1 from er_suppressions
       where workspace=$1 and lower(email)=lower($2)
     ) as exists`,
    [workspace,recipient],
  );

  let permission:PermissionRecord|null=null;
  if(lead?.contact_id||lead?.company_id){
    const rows=await query<PermissionRow>(
      `select
         id,workspace,company_id,contact_id,channel,jurisdiction,basis,status,
         policy_version,source,evidence,verified_by,verified_at,valid_from,valid_until,revoked_at
       from outbound_contact_permissions
       where workspace=$1
         and channel='email'
         and (
           ($2::text is not null and contact_id=$2)
           or ($3::text is not null and company_id=$3)
         )
       order by
         case when $2::text is not null and contact_id=$2 then 0 else 1 end,
         updated_at desc
       limit 1`,
      [workspace,lead.contact_id,lead.company_id],
    );
    if(rows[0])permission=toPermission(rows[0]);
  }

  const jurisdiction=permission?.jurisdiction||metadataJurisdiction(lead?.company_metadata||null);
  const suppressed=Boolean(suppression?.exists);
  const doNotContact=Boolean(lead?.do_not_contact);
  const decision=evaluateCompliance({
    jurisdiction,
    channel:"email",
    permission,
    suppressed,
    doNotContact,
  });

  return {
    decision,
    leadId,
    companyId:lead?.company_id||null,
    contactId:lead?.contact_id||null,
    jurisdiction,
    permission,
    suppressed,
    doNotContact,
  };
}

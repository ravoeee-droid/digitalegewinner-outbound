import { query } from "./db";
import { buildDailyOutboundPlan } from "./outbound-engine";
import { ensureSalesOsSchema } from "./sales-os";

type OpenOutreachLead = {
  lead_id?: string;
  id?: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  company?: string;
  title?: string;
  website?: string;
  linkedin_url?: string;
  email?: string;
  reason?: string;
  city?: string;
};

function workerHeaders() {
  return {
    "content-type": "application/json",
    ...(process.env.OPENOUTREACH_WORKER_SECRET ? { authorization: `Bearer ${process.env.OPENOUTREACH_WORKER_SECRET}` } : {}),
  };
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeWebsite(value = "") {
  if (!value) return "";
  try { return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).toString(); } catch { return value; }
}

function domainFromWebsite(value = "") {
  try { return new URL(normalizeWebsite(value)).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

export async function syncOpenOutreachLeads(count = 50, workspace = "default") {
  await ensureSalesOsSchema();
  const base = (process.env.OPENOUTREACH_WORKER_URL || "").replace(/\/$/, "");
  if (!base) return { ok: false, configured: false, imported: 0, error: "OPENOUTREACH_WORKER_URL fehlt." };

  const safeCount = Math.max(1, Math.min(100, Math.round(count)));
  const response = await fetch(`${base}/v1/find`, {
    method: "POST",
    headers: workerHeaders(),
    body: JSON.stringify({
      count: safeCount,
      emails: false,
      productDescription: "Digitale Gewinner baut conversion-starke Website-, Recruiting- und Bewerber-Systeme für ambulante Pflegedienste in Deutschland.",
      campaignObjective: "Finde Geschäftsführer, Inhaber und Pflegedienstleitungen ambulanter Pflegedienste in Deutschland. Pflegeheime, Kliniken, Tagespflege und irrelevante Pflegeanbieter ausschließen. Bevorzuge Unternehmen mit Recruiting-Druck, offenen Pflege-Stellen oder schwachem digitalem Auftritt.",
      output: "json",
    }),
  });

  if (!response.ok) {
    const responseBody = await response.text().catch(() => "");
    throw new Error(`OpenOutreach Worker ${response.status}: ${responseBody.slice(0, 300)}`);
  }

  const responseBody = await response.json() as OpenOutreachLead[] | { leads?: OpenOutreachLead[] };
  const leads = Array.isArray(responseBody) ? responseBody : Array.isArray(responseBody.leads) ? responseBody.leads : [];
  let imported = 0;

  for (const lead of leads) {
    const company = clean(lead.company);
    const linkedin = clean(lead.linkedin_url);
    if (!company || !linkedin) continue;

    const fullName = clean(lead.name) || [clean(lead.first_name), clean(lead.last_name)].filter(Boolean).join(" ");
    const sourceId = clean(lead.lead_id || lead.id) || linkedin;
    const reason = clean(lead.reason);
    const title = clean(lead.title);
    const email = clean(lead.email);
    const city = clean(lead.city);
    const website = normalizeWebsite(clean(lead.website));
    const domain = domainFromWebsite(website);
    const sourceKey = `openoutreach:${sourceId}`;
    const openOutreachMeta = {
      leadId: sourceId,
      reason,
      title,
      linkedin,
      syncedAt: new Date().toISOString(),
    };

    const existingCompanies = await query<{ id: string }>(
      `select id from sales_companies
       where workspace=$1 and (
         source_id=$2
         or ($3<>'' and domain=$3)
         or (lower(name)=lower($4) and ($5='' or city='' or lower(city)=lower($5)))
       )
       order by case when source_id=$2 then 0 when $3<>'' and domain=$3 then 1 else 2 end, updated_at desc
       limit 1`,
      [workspace, sourceKey, domain, company, city],
    );

    const companyId = existingCompanies[0]?.id || crypto.randomUUID();
    if (existingCompanies.length) {
      await query(
        `update sales_companies set
           website=case when website='' and $3<>'' then $3 else website end,
           domain=case when domain='' and $4<>'' then $4 else domain end,
           city=case when city='' and $5<>'' then $5 else city end,
           industry=case when industry='' then 'Ambulanter Pflegedienst' else industry end,
           metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object('openoutreach',$6::jsonb),
           updated_at=now()
         where id=$2 and workspace=$1`,
        [workspace, companyId, website, domain, city, JSON.stringify(openOutreachMeta)],
      );
    } else {
      await query(
        `insert into sales_companies(id,workspace,name,domain,website,city,industry,source,source_id,research_status,latest_score,metadata)
         values($1,$2,$3,$4,$5,$6,'Ambulanter Pflegedienst','openoutreach',$7,'pending',55,$8::jsonb)`,
        [companyId, workspace, company, domain, website, city, sourceKey, JSON.stringify({ openoutreach: openOutreachMeta, pflege_icp_verified: true })],
      );
    }

    const existingContacts = await query<{ id: string }>(
      `select id from sales_contacts
       where workspace=$1 and company_id=$2 and (
         ($3<>'' and linkedin=$3) or ($4<>'' and email=$4) or is_primary=true
       )
       order by case when $3<>'' and linkedin=$3 then 0 when $4<>'' and email=$4 then 1 else 2 end, updated_at desc
       limit 1`,
      [workspace, companyId, linkedin, email],
    );
    const contactId = existingContacts[0]?.id || crypto.randomUUID();
    const contactMeta = JSON.stringify({ openoutreachTitle: title, openoutreachReason: reason, openoutreachLeadId: sourceId });
    if (existingContacts.length) {
      await query(
        `update sales_contacts set
           name=case when $3<>'' then $3 else name end,
           email=case when $4<>'' then $4 else email end,
           linkedin=case when $5<>'' then $5 else linkedin end,
           is_primary=true,
           metadata=coalesce(metadata,'{}'::jsonb) || $6::jsonb,
           updated_at=now()
         where id=$2 and workspace=$1`,
        [workspace, contactId, fullName, email, linkedin, contactMeta],
      );
    } else {
      await query(
        `insert into sales_contacts(id,workspace,company_id,name,email,linkedin,is_primary,source,metadata)
         values($1,$2,$3,$4,$5,$6,true,'openoutreach',$7::jsonb)`,
        [contactId, workspace, companyId, fullName, email, linkedin, contactMeta],
      );
    }

    const activeLeads = await query<{ id: string }>(
      `select id from sales_leads where workspace=$1 and company_id=$2 and status='active' order by updated_at desc limit 1`,
      [workspace, companyId],
    );
    const leadId = activeLeads[0]?.id || crypto.randomUUID();
    if (activeLeads.length) {
      await query(
        `update sales_leads set contact_id=$3,
           notes=case when notes='' then $4 else notes end,
           updated_at=now()
         where id=$2 and workspace=$1`,
        [workspace, leadId, contactId, `OpenOutreach · ${reason || "ICP passt"}`],
      );
    } else {
      await query(
        `insert into sales_leads(id,workspace,company_id,contact_id,stage,status,fit_score,opportunity_score,priority_score,notes)
         values($1,$2,$3,$4,'Research','active',65,55,55,$5)`,
        [leadId, workspace, companyId, contactId, `OpenOutreach · ${reason || "ICP passt"}`],
      );
    }

    await query(
      `insert into sales_activities(workspace,lead_id,company_id,type,summary,meta)
       values($1,$2,$3,'openoutreach.imported',$4,$5::jsonb)`,
      [workspace, leadId, companyId, `OpenOutreach · ${company}${reason ? ` · ${reason}` : ""}`, JSON.stringify({ sourceId, linkedin, title, reason })],
    );
    imported++;
  }

  const snapshot = await buildDailyOutboundPlan(workspace);
  return { ok: true, configured: true, requested: safeCount, received: leads.length, imported, snapshot };
}

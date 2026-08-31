import { query } from "./db";
import { buildDailyOutboundPlan } from "./outbound-engine";
import { persistRadarLead } from "./sales-os";

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

export async function syncOpenOutreachLeads(count = 50, workspace = "default") {
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
    const body = await response.text().catch(() => "");
    throw new Error(`OpenOutreach Worker ${response.status}: ${body.slice(0, 300)}`);
  }

  const body = await response.json() as OpenOutreachLead[] | { leads?: OpenOutreachLead[] };
  const leads = Array.isArray(body) ? body : Array.isArray(body.leads) ? body.leads : [];
  let imported = 0;

  for (const lead of leads) {
    const company = clean(lead.company);
    const linkedin = clean(lead.linkedin_url);
    if (!company || !linkedin) continue;
    const fullName = clean(lead.name) || [clean(lead.first_name), clean(lead.last_name)].filter(Boolean).join(" ");
    const sourceId = clean(lead.lead_id || lead.id) || linkedin;
    const reason = clean(lead.reason);

    const persisted = await persistRadarLead({
      id: `openoutreach:${sourceId}`,
      company,
      contact: fullName,
      email: clean(lead.email),
      website: clean(lead.website),
      city: clean(lead.city),
      industry: "Ambulanter Pflegedienst",
      source: "openoutreach",
    }, {
      email: clean(lead.email),
      linkedin,
    }, undefined, workspace);

    await query(
      `update sales_contacts set name=case when $3<>'' then $3 else name end,linkedin=$4,
         metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object('openoutreachTitle',$5,'openoutreachReason',$6),updated_at=now()
       where id=$1 and workspace=$2`,
      [persisted.contactId, workspace, fullName, linkedin, clean(lead.title), reason],
    );
    await query(
      `update sales_companies set metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
        'openoutreach',jsonb_build_object('leadId',$3,'reason',$4,'title',$5,'syncedAt',now()::text)
      ),updated_at=now() where id=$1 and workspace=$2`,
      [persisted.companyId, workspace, sourceId, reason, clean(lead.title)],
    );
    await query(
      `insert into sales_activities(workspace,lead_id,company_id,type,summary,meta)
       values($1,$2,$3,'openoutreach.imported',$4,$5::jsonb)`,
      [workspace, persisted.leadId, persisted.companyId, `OpenOutreach · ${company}${reason ? ` · ${reason}` : ""}`, JSON.stringify({ sourceId, linkedin, title: clean(lead.title), reason })],
    );
    imported++;
  }

  const snapshot = await buildDailyOutboundPlan(workspace);
  return { ok: true, configured: true, requested: safeCount, received: leads.length, imported, snapshot };
}

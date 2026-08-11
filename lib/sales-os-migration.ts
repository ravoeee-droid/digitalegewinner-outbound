import { readState, query } from "./db";
import { ensureSalesOsSchema } from "./sales-os";

type LegacyState = { leads?: Array<Record<string, unknown>> };
type ExistingLead = {
  id: string;
  company_id: string;
  fit_score: number;
  opportunity_score: number;
  email: string;
  phone: string;
  linkedin: string;
  instagram: string;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function number(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function domain(value: string) {
  if (!value) return "";
  try {
    return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function contactability(email: string, phone: string, linkedin: string, instagram: string) {
  return clamp((email ? 45 : 0) + (phone ? 30 : 0) + (linkedin ? 15 : 0) + (instagram ? 10 : 0));
}

function priority(opportunityScore: number, fitScore: number, contactScore: number, intentScore: number) {
  return clamp(opportunityScore * 0.42 + fitScore * 0.28 + contactScore * 0.2 + intentScore * 0.1);
}

export async function syncLegacyLeads(workspace = "default") {
  await ensureSalesOsSchema();
  const row = await readState(workspace);
  const state = (row?.payload || {}) as LegacyState;
  const leads = Array.isArray(state.leads) ? state.leads : [];
  let imported = 0;
  let updated = 0;
  let skipped = 0;

  for (const legacy of leads) {
    const legacyId = text(legacy.id);
    const companyName = text(legacy.company);
    if (!legacyId || !companyName) { skipped += 1; continue; }

    try {
      const existing = await query<ExistingLead>(
        `select l.id,l.company_id,l.fit_score,l.opportunity_score,
                coalesce(ct.email,'') as email,coalesce(ct.phone,'') as phone,
                coalesce(ct.linkedin,'') as linkedin,coalesce(ct.instagram,'') as instagram
         from sales_leads l left join sales_contacts ct on ct.id=l.contact_id
         where l.workspace=$1 and l.id=$2 limit 1`,
        [workspace, legacyId],
      );

      const intentScore = clamp(number(legacy.intentScore));
      const stage = text(legacy.stage) || "Neu";
      const dealValue = Math.max(0, number(legacy.dealValue));
      const notes = text(legacy.notes);

      if (existing[0]) {
        const row = existing[0];
        const contactScore = contactability(row.email, row.phone, row.linkedin, row.instagram);
        const priorityScore = priority(number(row.opportunity_score), number(row.fit_score), contactScore, intentScore);
        await query(
          `update sales_leads set stage=$3,deal_value=$4,intent_score=$5,priority_score=$6,notes=$7,updated_at=now()
           where workspace=$1 and id=$2`,
          [workspace, legacyId, stage, dealValue, intentScore, priorityScore, notes],
        );
        await query("update sales_companies set latest_score=$3,updated_at=now() where workspace=$1 and id=$2", [workspace, row.company_id, priorityScore]);
        updated += 1;
        continue;
      }

      const website = text(legacy.website);
      const websiteDomain = domain(website);
      const email = text(legacy.email);
      const phone = text(legacy.phone);
      const linkedin = text(legacy.linkedin);
      const instagram = text(legacy.instagram);
      const fitScore = clamp(number(legacy.fitScore, text(legacy.industry) ? 70 : 50));
      const websiteScore = clamp(number(legacy.websiteScore));
      const opportunityScore = clamp(number(legacy.opportunityScore, website ? 100 - websiteScore : 85));
      const contactScore = contactability(email, phone, linkedin, instagram);
      const priorityScore = clamp(number(legacy.priorityScore, priority(opportunityScore, fitScore, contactScore, intentScore)));

      const matchingCompany = await query<{ id: string }>(
        `select id from sales_companies
         where workspace=$1 and ((source='legacy-state' and source_id=$2) or ($3<>'' and domain=$3))
         order by updated_at desc limit 1`,
        [workspace, legacyId, websiteDomain],
      );
      const companyId = matchingCompany[0]?.id || `legacy-company:${legacyId}`;
      const existingCompanyLead = await query<{ id: string }>(
        "select id from sales_leads where workspace=$1 and company_id=$2 and status='active' limit 1",
        [workspace, companyId],
      );
      if (existingCompanyLead.length) { skipped += 1; continue; }

      const contactId = `legacy-contact:${legacyId}`;
      await query(
        `insert into sales_companies(id,workspace,name,domain,website,city,industry,phone,source,source_id,research_status,latest_score,metadata)
         values($1,$2,$3,$4,$5,$6,$7,$8,'legacy-state',$9,'imported',$10,$11::jsonb)
         on conflict(id) do update set name=excluded.name,website=excluded.website,city=excluded.city,industry=excluded.industry,phone=excluded.phone,latest_score=excluded.latest_score,updated_at=now()`,
        [companyId, workspace, companyName, websiteDomain, website, text(legacy.city), text(legacy.industry), phone, legacyId, priorityScore, JSON.stringify({ migratedFrom: "er_state" })],
      );
      await query(
        `insert into sales_contacts(id,workspace,company_id,name,email,phone,linkedin,instagram,is_primary,source)
         values($1,$2,$3,$4,$5,$6,$7,$8,true,'legacy-state')
         on conflict(id) do update set name=excluded.name,email=excluded.email,phone=excluded.phone,linkedin=excluded.linkedin,instagram=excluded.instagram,updated_at=now()`,
        [contactId, workspace, companyId, text(legacy.contact), email, phone, linkedin, instagram],
      );
      await query(
        `insert into sales_leads(id,workspace,company_id,contact_id,stage,status,deal_value,intent_score,fit_score,opportunity_score,priority_score,notes)
         values($1,$2,$3,$4,$5,'active',$6,$7,$8,$9,$10,$11)`,
        [legacyId, workspace, companyId, contactId, stage, dealValue, intentScore, fitScore, opportunityScore, priorityScore, notes],
      );
      await query(
        `insert into sales_activities(workspace,lead_id,company_id,type,summary,meta)
         values($1,$2,$3,'migration.imported','Bestehenden Lead ins Sales OS übernommen',$4::jsonb)`,
        [workspace, legacyId, companyId, JSON.stringify({ priorityScore })],
      );
      imported += 1;
    } catch {
      skipped += 1;
    }
  }

  return { scanned: leads.length, imported, updated, skipped };
}

import { readState, query } from "./db";
import { ensureSalesOsSchema } from "./sales-os";

type LegacyState = { leads?: Array<Record<string, unknown>> };

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

export async function syncLegacyLeads(workspace = "default") {
  await ensureSalesOsSchema();
  const row = await readState(workspace);
  const state = (row?.payload || {}) as LegacyState;
  const leads = Array.isArray(state.leads) ? state.leads : [];
  let imported = 0;

  for (const legacy of leads) {
    const legacyId = text(legacy.id);
    const companyName = text(legacy.company);
    if (!legacyId || !companyName) continue;

    const existingLead = await query<{ id: string }>("select id from sales_leads where workspace=$1 and id=$2 limit 1", [workspace, legacyId]);
    if (existingLead.length) continue;

    const companyId = `legacy-company:${legacyId}`;
    const contactId = `legacy-contact:${legacyId}`;
    const website = text(legacy.website);
    const email = text(legacy.email);
    const phone = text(legacy.phone);
    const linkedin = text(legacy.linkedin);
    const instagram = text(legacy.instagram);
    const intentScore = clamp(number(legacy.intentScore));
    const fitScore = clamp(number(legacy.fitScore, text(legacy.industry) ? 70 : 50));
    const websiteScore = clamp(number(legacy.websiteScore));
    const opportunityScore = clamp(number(legacy.opportunityScore, website ? 100 - websiteScore : 85));
    const contactScore = clamp((email ? 45 : 0) + (phone ? 30 : 0) + (linkedin ? 15 : 0) + (instagram ? 10 : 0));
    const priorityScore = clamp(number(legacy.priorityScore, opportunityScore * 0.42 + fitScore * 0.28 + contactScore * 0.2 + intentScore * 0.1));

    await query(
      `insert into sales_companies(id,workspace,name,domain,website,city,industry,phone,source,source_id,research_status,latest_score,metadata)
       values($1,$2,$3,$4,$5,$6,$7,$8,'legacy-state',$9,'imported',$10,$11::jsonb)
       on conflict(id) do nothing`,
      [companyId, workspace, companyName, domain(website), website, text(legacy.city), text(legacy.industry), phone, legacyId, priorityScore, JSON.stringify({ migratedFrom: "er_state" })],
    );
    await query(
      `insert into sales_contacts(id,workspace,company_id,name,email,phone,linkedin,instagram,is_primary,source)
       values($1,$2,$3,$4,$5,$6,$7,$8,true,'legacy-state')
       on conflict(id) do nothing`,
      [contactId, workspace, companyId, text(legacy.contact), email, phone, linkedin, instagram],
    );
    await query(
      `insert into sales_leads(id,workspace,company_id,contact_id,stage,status,deal_value,intent_score,fit_score,opportunity_score,priority_score,notes)
       values($1,$2,$3,$4,$5,'active',$6,$7,$8,$9,$10,$11)
       on conflict(id) do nothing`,
      [legacyId, workspace, companyId, contactId, text(legacy.stage) || "Neu", number(legacy.dealValue), intentScore, fitScore, opportunityScore, priorityScore, text(legacy.notes)],
    );
    await query(
      `insert into sales_activities(workspace,lead_id,company_id,type,summary,meta)
       values($1,$2,$3,'migration.imported','Bestehenden Lead ins Sales OS übernommen',$4::jsonb)`,
      [workspace, legacyId, companyId, JSON.stringify({ priorityScore })],
    );
    imported += 1;
  }

  return { scanned: leads.length, imported };
}

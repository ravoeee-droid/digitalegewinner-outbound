import { z } from "zod";
import { query } from "@/lib/db";
import { ensureRevenueOpportunitySchema } from "@/lib/revenue-opportunities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// No new tables: use canonical sales_contacts so the same contact is available to
// CRM, lead research and the call workflow.
const contactSchema = z.object({
  opportunityId: z.string().min(3),
  contactId: z.string().min(3).optional(),
  name: z.string().trim().max(180),
  role: z.string().trim().max(160),
  phone: z.string().trim().max(80),
  email: z.union([z.literal(""), z.string().trim().email().max(320)]),
  isPrimary: z.boolean(),
}).refine((v) => Boolean(v.name || v.email || v.phone), {
  message: "Mindestens Name, Telefon oder E-Mail wird benötigt.",
});

function workspaceOf(request: Request) {
  return new URL(request.url).searchParams.get("workspace") || "default";
}

export async function POST(request: Request) {
  try {
    const workspace = workspaceOf(request);
    const data = contactSchema.parse(await request.json());
    await ensureRevenueOpportunitySchema();
    const [opportunity] = await query<{ company_id: string; lead_id: string }>(
      "select company_id,lead_id from sales_opportunities where workspace=$1 and id=$2 limit 1",
      [workspace, data.opportunityId],
    );
    if (!opportunity) return Response.json({ error: "Verkaufschance nicht gefunden." }, { status: 404 });

    // Never allow editing a contact through a foreign opportunity/company.
    if (data.contactId) {
      const [existing] = await query<{ id: string }>(
        "select id from sales_contacts where id=$1 and company_id=$2 and workspace=$3 limit 1",
        [data.contactId, opportunity.company_id, workspace],
      );
      if (!existing) return Response.json({ error: "Kontakt gehört nicht zu diesem Unternehmen." }, { status: 404 });
    }

    if (data.isPrimary) {
      await query("update sales_contacts set is_primary=false,updated_at=now() where workspace=$1 and company_id=$2 and is_primary=true",
        [workspace, opportunity.company_id]);
    }

    const contactId = data.contactId || crypto.randomUUID();
    const saved = data.contactId
      ? await query<{ id: string }>(`
          update sales_contacts set
            name=$4,email=$5,phone=$6,is_primary=$7,
            metadata=jsonb_set(coalesce(metadata,'{}'::jsonb),'{role}',to_jsonb($8::text),true),
            updated_at=now()
          where id=$1 and workspace=$2 and company_id=$3 returning id
        `, [contactId, workspace, opportunity.company_id, data.name, data.email, data.phone, data.isPrimary, data.role])
      : await query<{ id: string }>(`
          insert into sales_contacts(id,workspace,company_id,name,email,phone,is_primary,source,metadata)
          values($1,$2,$3,$4,$5,$6,$7,'crm-manual',jsonb_build_object('role',$8::text))
          returning id
        `, [contactId, workspace, opportunity.company_id, data.name, data.email, data.phone, data.isPrimary, data.role]);

    if (saved.length !== 1) return Response.json({ error: "Kontakt konnte nicht gespeichert werden." }, { status: 500 });

    if (data.isPrimary) {
      await query("update sales_leads set contact_id=$3,updated_at=now() where id=$1 and workspace=$2",
        [opportunity.lead_id, workspace, contactId]);
    }
    await query(`
      insert into sales_activities(workspace,lead_id,company_id,type,summary,meta)
      values($1,$2,$3,'revenue.contact',$4,$5::jsonb)
    `, [workspace, opportunity.lead_id, opportunity.company_id,
      data.contactId ? "Ansprechpartner aktualisiert" : "Ansprechpartner hinzugefügt",
      JSON.stringify({ opportunityId: data.opportunityId, contactId, primary: data.isPrimary })]);

    return Response.json({ ok: true, contactId }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: error.issues[0]?.message || "Ungültige Kontaktdaten." }, { status: 400 });
    }
    return Response.json({ error: error instanceof Error ? error.message : "Kontakt konnte nicht gespeichert werden." }, { status: 500 });
  }
}

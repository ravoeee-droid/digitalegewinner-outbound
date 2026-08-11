import { z } from "zod";
import { enrichPublicContact, type ContactEnrichment } from "@/lib/contact-enrichment";
import { runWebsiteAudit, type WebsiteAuditResult } from "@/lib/website-audit";
import { persistRadarLead } from "@/lib/sales-os";

export const runtime = "nodejs";
export const maxDuration = 30;

const schema = z.object({
  id: z.string().min(1).max(300),
  company: z.string().min(1).max(250),
  contact: z.string().max(200).optional().default(""),
  email: z.string().max(320).optional().default(""),
  phone: z.string().max(100).optional().default(""),
  website: z.string().max(500).optional().default(""),
  city: z.string().max(500).optional().default(""),
  industry: z.string().max(250).optional().default(""),
  lat: z.number().optional(),
  lng: z.number().optional(),
  source: z.string().max(100).optional().default("google-places"),
  workspace: z.string().min(1).max(100).optional().default("default"),
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    let contact: Partial<ContactEnrichment> = {};
    let audit: WebsiteAuditResult | undefined;
    const warnings: string[] = [];

    if (input.website) {
      const [contactResult, auditResult] = await Promise.allSettled([
        enrichPublicContact(input.website),
        runWebsiteAudit(input.website, input.company),
      ]);
      if (contactResult.status === "fulfilled") contact = contactResult.value;
      else warnings.push("Kontakt-Enrichment nicht vollständig");
      if (auditResult.status === "fulfilled") audit = auditResult.value;
      else warnings.push("Website-Audit nicht vollständig");
    }

    const persisted = await persistRadarLead(input, contact, audit, input.workspace);
    const email = contact.email || input.email || "";
    const phone = contact.phone || input.phone || "";
    const legacyLead = {
      id: persisted.leadId,
      company: input.company,
      contact: input.contact,
      email,
      phone,
      website: persisted.website || input.website,
      city: input.city,
      industry: input.industry,
      stage: "Neu",
      dealValue: 0,
      notes: [
        persisted.summary,
        ...persisted.signals,
        email ? `Öffentliche Kontakt-E-Mail: ${email}` : "Keine öffentliche E-Mail erkannt",
        contact.linkedin ? `LinkedIn: ${contact.linkedin}` : "",
      ].filter(Boolean).join(" · "),
      intentScore: persisted.scores.intentScore,
      websiteScore: persisted.scores.websiteScore,
      fitScore: persisted.scores.fitScore,
      opportunityScore: persisted.scores.opportunityScore,
      priorityScore: persisted.scores.priorityScore,
      websiteAudit: audit,
      websiteAuditAt: audit?.auditedAt || null,
      linkedin: contact.linkedin || "",
      instagram: contact.instagram || "",
      publicEmails: contact.emails || [],
      contactPage: contact.contactPage || "",
      researchSignals: persisted.signals,
      researchId: persisted.researchId,
    };

    return Response.json({ ok: true, ...persisted, contact, audit, legacyLead, warnings });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Radar-Import fehlgeschlagen." },
      { status: 400 },
    );
  }
}

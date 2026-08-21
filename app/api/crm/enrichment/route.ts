import OpenAI from "openai";
import { z } from "zod";
import { enrichPublicContact, type ContactEnrichment } from "@/lib/contact-enrichment";
import { getSecret } from "@/lib/secrets";
import { query } from "@/lib/db";
import { scoreResearch, type RadarCandidate } from "@/lib/sales-os";
import { runWebsiteAudit, type WebsiteAuditResult } from "@/lib/website-audit";

export const runtime = "nodejs";
export const maxDuration = 60;

const postSchema = z.object({
  leadIds: z.array(z.string().min(1).max(220)).min(1).max(5),
  ai: z.boolean().optional().default(true),
});

const aiSchema = z.object({
  summary: z.string().max(1200),
  callOpening: z.string().max(800),
  emailHook: z.string().max(900),
  personalizationPoints: z.array(z.string().max(400)).max(6),
  likelyDecisionMaker: z.string().max(300),
  nextResearchStep: z.string().max(500),
});

type DbLead = {
  id: string;
  company_id: string;
  contact_id: string | null;
  stage: string;
  company: string;
  city: string;
  industry: string;
  website: string;
  company_phone: string;
  source_id: string;
  company_metadata: Record<string, unknown>;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  contact_metadata: Record<string, unknown>;
};

type Place = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  websiteUri?: string;
  nationalPhoneNumber?: string;
  primaryTypeDisplayName?: { text?: string };
  location?: { latitude?: number; longitude?: number };
};

type AiBrief = z.infer<typeof aiSchema>;

function normalizeWebsite(value: string) {
  const raw = value.trim();
  if (!raw) return "";
  try { return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).toString(); } catch { return raw; }
}
function domainFromWebsite(value: string) {
  try { return new URL(normalizeWebsite(value)).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}
function clamp(value: number) { return Math.max(0, Math.min(100, Math.round(value))); }
function socialCount(contact: Partial<ContactEnrichment>) {
  return [contact.linkedin, contact.instagram, contact.facebook, contact.tiktok, contact.youtube, contact.xing].filter(Boolean).length;
}

async function loadLead(leadId: string) {
  const rows = await query<DbLead>(
    `select l.id,l.company_id,l.contact_id,l.stage,c.name company,c.city,c.industry,c.website,c.phone company_phone,c.source_id,
            coalesce(c.metadata,'{}'::jsonb) company_metadata,
            coalesce(ct.name,'') contact_name,coalesce(ct.email,'') contact_email,coalesce(ct.phone,'') contact_phone,
            coalesce(ct.metadata,'{}'::jsonb) contact_metadata
       from sales_leads l
       join sales_companies c on c.id=l.company_id
       left join sales_contacts ct on ct.id=l.contact_id
      where l.id=$1 and l.workspace='default' and l.status='active'
      limit 1`,
    [leadId],
  );
  return rows[0] || null;
}

async function discoverPlace(company: string, city: string): Promise<Place | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY || await getSecret("google_maps_api_key");
  if (!key) return null;
  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.websiteUri,places.nationalPhoneNumber,places.primaryTypeDisplayName,places.location",
    },
    body: JSON.stringify({ textQuery: [company, city].filter(Boolean).join(" "), pageSize: 1, languageCode: "de" }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) return null;
  const json = await response.json() as { places?: Place[] };
  return json.places?.[0] || null;
}

function buildSignals(contact: Partial<ContactEnrichment>, audit?: WebsiteAuditResult, websiteDiscovered = false) {
  const signals: string[] = [];
  if (websiteDiscovered) signals.push("Website via Google Places gefunden");
  if (contact.email) signals.push("Öffentliche E-Mail gefunden");
  if (contact.phone) signals.push("Telefonnummer auf Website bestätigt");
  if (contact.linkedin) signals.push("LinkedIn erkannt");
  if (contact.instagram) signals.push("Instagram erkannt");
  if (contact.facebook) signals.push("Facebook erkannt");
  if (contact.tiktok) signals.push("TikTok erkannt");
  if (contact.careersPage) signals.push("Karrierebereich erkannt");
  else if (audit) signals.push("Kein klarer Karrierebereich erkannt");
  if (contact.jobsPage) signals.push("Stellen-/Bewerbungsseite erkannt");
  else if (audit) signals.push("Keine direkte Stellen-/Bewerbungsseite erkannt");
  if (contact.atsProviders?.length) signals.push(`ATS: ${contact.atsProviders.join(", ")}`);
  else if (audit) signals.push("Kein ATS auf der Website erkannt");
  if (contact.trackingTools?.length) signals.push(`Tracking: ${contact.trackingTools.join(", ")}`);
  for (const signal of contact.recruitingSignals || []) signals.push(signal);
  for (const finding of audit?.findings?.filter((item) => item.severity === "critical" || item.severity === "warning").slice(0, 4) || []) {
    signals.push(`${finding.category}: ${finding.title}`);
  }
  return [...new Set(signals)].slice(0, 18);
}

function researchQuality(input: { website: string; contact: Partial<ContactEnrichment>; audit?: WebsiteAuditResult; place?: Place | null }) {
  let value = 0;
  if (input.website) value += 18;
  if (input.contact.email) value += 18;
  if (input.contact.phone || input.place?.nationalPhoneNumber) value += 14;
  if (socialCount(input.contact) > 0) value += 10;
  if (input.contact.careersPage || input.contact.jobsPage) value += 12;
  if (input.contact.teamPage || input.contact.contactPage) value += 8;
  if (input.audit) value += 20;
  return clamp(value);
}

function fallbackBrief(company: string, contact: Partial<ContactEnrichment>, audit: WebsiteAuditResult | undefined, signals: string[]): AiBrief {
  const opportunity = audit?.sales?.opportunitySummary || signals.slice(0, 3).join(" · ") || "Öffentliche Recruiting- und Kontaktdaten wurden geprüft.";
  return {
    summary: opportunity,
    callOpening: audit?.sales?.opener || `Guten Tag, Raphael Hermann hier. Ich habe mir ${company} und Ihren aktuellen Recruiting-Auftritt kurz angesehen. Darf ich Ihnen in zwei Minuten sagen, welcher Hebel mir dabei aufgefallen ist?`,
    emailHook: audit?.sales?.emailHook || `Ich habe mir den Recruiting-Auftritt von ${company} angesehen und dabei einen konkreten Hebel für einen einfacheren Bewerberweg gefunden.`,
    personalizationPoints: signals.slice(0, 5),
    likelyDecisionMaker: "Pflegedienstleitung, Einrichtungsleitung, Geschäftsführung oder Personalverantwortliche",
    nextResearchStep: contact.teamPage ? "Ansprechpartner auf Team-/Über-uns-Seite prüfen." : "PDL / Einrichtungsleitung / Geschäftsführung als konkreten Ansprechpartner ergänzen.",
  };
}

async function buildAiBrief(company: string, city: string, contact: Partial<ContactEnrichment>, audit: WebsiteAuditResult | undefined, signals: string[]) {
  const fallback = fallbackBrief(company, contact, audit, signals);
  const apiKey = process.env.OPENAI_API_KEY || await getSecret("openai_api_key");
  if (!apiKey) return fallback;
  try {
    const client = new OpenAI({ apiKey });
    const facts = {
      company,
      city,
      email: contact.email || "",
      phone: contact.phone || "",
      social: {
        linkedin: contact.linkedin || "",
        instagram: contact.instagram || "",
        facebook: contact.facebook || "",
        tiktok: contact.tiktok || "",
      },
      careersPage: contact.careersPage || "",
      jobsPage: contact.jobsPage || "",
      ats: contact.atsProviders || [],
      tracking: contact.trackingTools || [],
      websiteScores: audit?.scores || null,
      topFindings: audit?.findings?.slice(0, 6).map((item) => ({ category: item.category, title: item.title, detail: item.detail })) || [],
      signals,
    };
    const prompt = `Du erstellst einen faktentreuen B2B-Research-Brief für die Akquise von Social-Recruiting- und Karrierewebsite-Leistungen an Pflegeunternehmen. Verwende AUSSCHLIESSLICH die gelieferten Fakten. Keine erfundenen Ansprechpartner, offenen Stellen, Mitarbeiterzahlen, Budgets oder Ergebnisse. Formuliere präzise, kurz und natürlich auf Deutsch. Der Call-Opener darf maximal 2 Sätze haben und soll mit einer konkreten Beobachtung beginnen. likelyDecisionMaker ist eine Rollenempfehlung, kein erfundener Name. Gib ausschließlich valides JSON zurück: {"summary":"...","callOpening":"...","emailHook":"...","personalizationPoints":["..."],"likelyDecisionMaker":"...","nextResearchStep":"..."}. Fakten: ${JSON.stringify(facts)}`;
    const response = await client.responses.create({ model: process.env.OPENAI_MODEL || "gpt-5", input: prompt });
    const raw = response.output_text.trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    return aiSchema.parse(JSON.parse(raw));
  } catch {
    return fallback;
  }
}

async function enrichLead(leadId: string, useAi: boolean) {
  const lead = await loadLead(leadId);
  if (!lead) throw new Error("Lead nicht gefunden.");

  const warnings: string[] = [];
  let place: Place | null = null;
  let website = normalizeWebsite(lead.website || "");
  let companyPhone = lead.company_phone || lead.contact_phone || "";
  let city = lead.city || "";
  let websiteDiscovered = false;

  if (!website || !companyPhone) {
    try {
      place = await discoverPlace(lead.company, lead.city);
      if (place) {
        if (!website && place.websiteUri) { website = normalizeWebsite(place.websiteUri); websiteDiscovered = true; }
        if (!companyPhone && place.nationalPhoneNumber) companyPhone = place.nationalPhoneNumber;
        if (!city && place.formattedAddress) city = place.formattedAddress;
      }
    } catch { warnings.push("Google-Places-Abgleich nicht vollständig"); }
  }

  let contact: Partial<ContactEnrichment> = {};
  let audit: WebsiteAuditResult | undefined;
  if (website) {
    const [contactResult, auditResult] = await Promise.allSettled([
      enrichPublicContact(website),
      runWebsiteAudit(website, lead.company),
    ]);
    if (contactResult.status === "fulfilled") contact = contactResult.value;
    else warnings.push("Kontakt-/Social-Enrichment nicht vollständig");
    if (auditResult.status === "fulfilled") audit = auditResult.value;
    else warnings.push("Website-Audit nicht vollständig");
  } else {
    warnings.push("Keine Website gefunden");
  }

  const candidate: RadarCandidate = {
    id: place?.id || lead.source_id || lead.company_id,
    company: lead.company,
    contact: lead.contact_name,
    email: contact.email || lead.contact_email,
    phone: contact.phone || companyPhone,
    website,
    city,
    industry: lead.industry || "Pflege",
    lat: place?.location?.latitude,
    lng: place?.location?.longitude,
    source: place?.id ? "google-places" : "crm-enrichment",
  };
  const base = scoreResearch(candidate, contact, audit);
  const recruitingGap = (audit && !contact.careersPage ? 8 : 0) + (audit && !contact.jobsPage ? 7 : 0) + (audit && !(contact.atsProviders?.length) ? 5 : 0) + (audit && socialCount(contact) === 0 ? 5 : 0);
  const scores = {
    ...base.scores,
    opportunityScore: clamp(base.scores.opportunityScore + recruitingGap),
    priorityScore: clamp(base.scores.priorityScore + Math.round(recruitingGap * 0.35)),
  };
  const signals = [...new Set([...base.signals, ...buildSignals(contact, audit, websiteDiscovered)])];
  const quality = researchQuality({ website, contact, audit, place });
  const brief = useAi ? await buildAiBrief(lead.company, city, contact, audit, signals) : fallbackBrief(lead.company, contact, audit, signals);
  const enrichedAt = new Date().toISOString();

  const contactId = lead.contact_id || crypto.randomUUID();
  const contactMeta = {
    ...(lead.contact_metadata || {}),
    enrichment: {
      source: "public-research",
      enrichedAt,
      publicEmails: contact.emails || [],
      publicPhones: contact.phones || [],
      linkedin: contact.linkedin || "",
      instagram: contact.instagram || "",
      facebook: contact.facebook || "",
      tiktok: contact.tiktok || "",
      youtube: contact.youtube || "",
      xing: contact.xing || "",
      contactPage: contact.contactPage || "",
      careersPage: contact.careersPage || "",
      jobsPage: contact.jobsPage || "",
      teamPage: contact.teamPage || "",
    },
  };
  await query(
    `insert into sales_contacts(id,workspace,company_id,name,email,phone,linkedin,instagram,is_primary,source,metadata)
     values($1,'default',$2,$3,$4,$5,$6,$7,true,'public-research',$8::jsonb)
     on conflict(id) do update set
       name=case when excluded.name<>'' then excluded.name else sales_contacts.name end,
       email=case when excluded.email<>'' then excluded.email else sales_contacts.email end,
       phone=case when excluded.phone<>'' then excluded.phone else sales_contacts.phone end,
       linkedin=case when excluded.linkedin<>'' then excluded.linkedin else sales_contacts.linkedin end,
       instagram=case when excluded.instagram<>'' then excluded.instagram else sales_contacts.instagram end,
       is_primary=true,source='public-research',metadata=excluded.metadata,updated_at=now()`,
    [contactId, lead.company_id, lead.contact_name, contact.email || lead.contact_email, contact.phone || lead.contact_phone || companyPhone, contact.linkedin || "", contact.instagram || "", JSON.stringify(contactMeta)],
  );

  const enrichment = {
    version: 2,
    enrichedAt,
    quality,
    website,
    domain: domainFromWebsite(website),
    googlePlaceId: place?.id || "",
    googleAddress: place?.formattedAddress || "",
    email: contact.email || lead.contact_email || "",
    phone: contact.phone || companyPhone || "",
    publicEmails: contact.emails || [],
    publicPhones: contact.phones || [],
    linkedin: contact.linkedin || "",
    instagram: contact.instagram || "",
    facebook: contact.facebook || "",
    tiktok: contact.tiktok || "",
    youtube: contact.youtube || "",
    xing: contact.xing || "",
    contactPage: contact.contactPage || "",
    careersPage: contact.careersPage || "",
    jobsPage: contact.jobsPage || "",
    teamPage: contact.teamPage || "",
    atsProviders: contact.atsProviders || [],
    trackingTools: contact.trackingTools || [],
    pagesScanned: contact.pagesScanned || 0,
    signals,
    warnings,
    brief,
  };

  await query(
    `update sales_companies set
       domain=$2,website=$3,city=case when city='' then $4 else city end,
       phone=case when $5<>'' then $5 else phone end,
       source_id=case when source_id='' and $6<>'' then $6 else source_id end,
       lat=coalesce(lat,$7),lng=coalesce(lng,$8),research_status='complete',latest_score=$9,
       metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object('enrichment',$10::jsonb),updated_at=now()
     where id=$1`,
    [lead.company_id, domainFromWebsite(website), website, city, contact.phone || companyPhone, place?.id || "", place?.location?.latitude ?? null, place?.location?.longitude ?? null, scores.priorityScore, JSON.stringify(enrichment)],
  );

  const nextStage = ["Neu", "Research"].includes(lead.stage) ? "Bereit" : lead.stage;
  await query(
    `update sales_leads set contact_id=$2,stage=$3,fit_score=$4,opportunity_score=$5,priority_score=$6,
       next_action=case when next_action='' and $7<>'' then $7 else next_action end,updated_at=now()
     where id=$1 and workspace='default'`,
    [lead.id, contactId, nextStage, scores.fitScore, scores.opportunityScore, scores.priorityScore, contact.phone || companyPhone ? "Anrufen" : contact.email || lead.contact_email ? "Persönliche E-Mail vorbereiten" : "Ansprechpartner ergänzen"],
  );

  const researchId = crypto.randomUUID();
  await query(
    `insert into sales_research_runs(id,workspace,company_id,status,website_score,contact_score,fit_score,opportunity_score,priority_score,signals,audit,contact,summary)
     values($1,'default',$2,'complete',$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11)`,
    [researchId, lead.company_id, scores.websiteScore, scores.contactScore, scores.fitScore, scores.opportunityScore, scores.priorityScore, JSON.stringify(signals), JSON.stringify(audit || {}), JSON.stringify({ ...contact, place, quality, brief, warnings }), brief.summary],
  );
  await query(
    `insert into sales_activities(workspace,lead_id,company_id,type,summary,meta)
     values('default',$1,$2,'enrichment.completed',$3,$4::jsonb)`,
    [lead.id, lead.company_id, `Research aktualisiert · ${quality}% Datenabdeckung · Priority ${scores.priorityScore}`, JSON.stringify({ researchId, quality, scores, warnings, signals })],
  );

  return { leadId: lead.id, company: lead.company, researchId, quality, scores, website, contact, audit, signals, brief, warnings };
}

export async function POST(request: Request) {
  try {
    const input = postSchema.parse(await request.json());
    const results = [];
    for (const leadId of input.leadIds) {
      try { results.push({ ok: true, ...(await enrichLead(leadId, input.ai)) }); }
      catch (error) { results.push({ ok: false, leadId, error: error instanceof Error ? error.message : "Enrichment fehlgeschlagen." }); }
    }
    return Response.json({ ok: results.some((item) => item.ok), results });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Enrichment konnte nicht gestartet werden." }, { status: 400 });
  }
}

export async function GET(request: Request) {
  try {
    const leadId = new URL(request.url).searchParams.get("leadId") || "";
    if (!leadId) return Response.json({ error: "leadId fehlt." }, { status: 400 });
    const lead = await loadLead(leadId);
    if (!lead) return Response.json({ error: "Lead nicht gefunden." }, { status: 404 });
    const research = await query<{
      id: string; status: string; website_score: number; contact_score: number; fit_score: number; opportunity_score: number; priority_score: number;
      signals: unknown; audit: unknown; contact: unknown; summary: string; created_at: string;
    }>(
      `select id,status,website_score,contact_score,fit_score,opportunity_score,priority_score,signals,audit,contact,summary,created_at
       from sales_research_runs where workspace='default' and company_id=$1 order by created_at desc limit 1`,
      [lead.company_id],
    );
    const activities = await query<{ id: number; type: string; summary: string; meta: unknown; created_at: string }>(
      `select id,type,summary,meta,created_at from sales_activities where workspace='default' and lead_id=$1 order by created_at desc limit 40`,
      [leadId],
    );
    const calls = await query<{ id: number; direction: string; status: string; external_number: string; started_at: string | null; answered_at: string | null; ended_at: string | null; duration_seconds: number }>(
      `select id,direction,status,external_number,started_at,answered_at,ended_at,duration_seconds from sales_calls where workspace='default' and lead_ref=$1 order by coalesce(started_at,created_at) desc limit 20`,
      [leadId],
    );
    return Response.json({
      lead: {
        id: lead.id,
        companyId: lead.company_id,
        company: lead.company,
        city: lead.city,
        industry: lead.industry,
        website: lead.website,
        companyPhone: lead.company_phone,
        metadata: lead.company_metadata,
      },
      contact: {
        id: lead.contact_id,
        name: lead.contact_name,
        email: lead.contact_email,
        phone: lead.contact_phone,
        metadata: lead.contact_metadata,
      },
      research: research[0] || null,
      activities,
      calls,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Research-Detail konnte nicht geladen werden." }, { status: 500 });
  }
}

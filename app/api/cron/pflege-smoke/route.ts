import { discoverBusinesses } from "@/lib/business-discovery";
import { enrichPublicContact } from "@/lib/contact-enrichment";
import { inspectAdIntelligence } from "@/lib/ad-intelligence";
import { runWebsiteAudit } from "@/lib/website-audit";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  if (process.env.VERCEL_ENV !== "preview") return Response.json({ error: "Not found" }, { status: 404 });
  const started = Date.now();
  try {
    const discoveryStart = Date.now();
    const discovery = await discoverBusinesses({
      query: "ambulanter Pflegedienst Stuttgart Baden-Württemberg",
      locationHint: "Stuttgart, Baden-Württemberg",
      pageSize: 8,
    });
    const discoveryMs = Date.now() - discoveryStart;
    const candidate = discovery.leads.find((lead) => Boolean(lead.website)) || discovery.leads[0] || null;

    let enrichment: Record<string, unknown> | null = null;
    if (candidate?.website) {
      const enrichStart = Date.now();
      const [contact, audit] = await Promise.all([
        enrichPublicContact(candidate.website),
        runWebsiteAudit(candidate.website, candidate.company),
      ]);
      const ads = await inspectAdIntelligence(candidate.company, candidate.website, contact.trackingTools);
      enrichment = {
        ms: Date.now() - enrichStart,
        website: candidate.website,
        contact: {
          pagesScanned: contact.pagesScanned,
          emailFound: Boolean(contact.email),
          phoneFound: Boolean(contact.phone),
          atsProviders: contact.atsProviders,
          trackingTools: contact.trackingTools,
          recruitingSignals: contact.recruitingSignals.slice(0, 6),
        },
        websiteAudit: {
          overall: audit.scores.overall,
          seo: audit.scores.seo,
          conversion: audit.scores.conversion,
          trust: audit.scores.trust,
          technical: audit.scores.technical,
          responseMs: audit.responseMs,
          topFindings: audit.findings.slice(0, 4).map((item) => item.title),
        },
        ads: {
          meta: ads.meta.status,
          google: ads.google.status,
          signals: ads.signals,
        },
      };
    }

    const dbStart = Date.now();
    const db = await query<{ companies: number; leads: number; scans: number }>(
      `select
        (select count(*)::int from sales_companies where workspace='default') companies,
        (select count(*)::int from sales_leads where workspace='default') leads,
        (select count(*)::int from sales_territory_scans where workspace='default') scans`,
    );
    const dbMs = Date.now() - dbStart;

    return Response.json({
      ok: discovery.leads.length > 0,
      totalMs: Date.now() - started,
      discovery: {
        source: discovery.source,
        warning: discovery.warning || "",
        ms: discoveryMs,
        count: discovery.leads.length,
        sample: candidate ? {
          company: candidate.company,
          city: candidate.city,
          phone: Boolean(candidate.phone),
          website: Boolean(candidate.website),
          source: candidate.source,
        } : null,
      },
      enrichment,
      database: { ok: true, ms: dbMs, counts: db[0] || null },
    });
  } catch (error) {
    return Response.json({ ok: false, totalMs: Date.now() - started, error: error instanceof Error ? error.message : "Smoke test failed" }, { status: 500 });
  }
}

import { query } from "@/lib/db";
import { ensureSalesOsSchema } from "@/lib/sales-os";

// PV-WhatsApp-Sprint: public WhatsApp links create drafts, NEVER permission to advertise.
// Sending is opt-in only via approved WhatsApp Business Platform templates.
type Prospect = {
  lead_id: string; company_id: string; contact_id: string | null;
  company: string; website: string; priority_score: number;
  company_metadata: Record<string, unknown> | null;
  contact_metadata: Record<string, unknown> | null;
};
export type WhatsAppDraft = {
  id: string; company: string; website: string; phone: string; source_url: string;
  draft_text: string; status: string; planned_day: string; slot: number;
  sent_at: string | null; error: string; consent_ready: boolean;
};
const DAILY_LIMIT = 30;

function digits(value: string) {
  return value.replace(/\D/g, "");
}
function phoneFromWhatsApp(value: string): string {
  const match = value.match(/(?:wa\.me\/|(?:api|web)\.whatsapp\.com\/send\?phone=|whatsapp:\/\/send\?phone=)(?:%2b|\+)?([0-9+(). -]{9,24})/i);
  const raw = match ? match[1] : value;
  const normalized = digits(raw);
  return normalized.length >= 9 && normalized.length <= 15 ? normalized : "";
}
function knownWhatsApp(row: Prospect) {
  for (const metadata of [row.contact_metadata, row.company_metadata]) {
    if (!metadata || typeof metadata !== "object") continue;
    for (const key of ["whatsapp_url", "whatsappUrl", "whatsapp_link", "whatsappPhone", "whatsapp_phone", "whatsapp"]) {
      const value = metadata[key];
      if (typeof value === "string" && value.trim()) {
        const phone = phoneFromWhatsApp(value);
        if (phone) return { phone, source: "CRM-Metadaten: " + key };
      }
    }
  }
  return null;
}
function safeWebsite(website: string): URL | null {
  try {
    const url = new URL(/^https?:\/\//i.test(website) ? website : "https://" + website);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
        !host.includes(".") || /(?:^|\.)localhost$|(?:^|\.)local$|(?:^|\.)internal$|(?:^|\.)test$/.test(host) ||
        /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":")) return null;
    return url;
  } catch { return null; }
}
async function findPublicWhatsApp(website: string): Promise<{ phone: string; source: string } | null> {
  const url = safeWebsite(website);
  if (!url) return null;
  try {
    const response = await fetch(url.toString(), {
      redirect: "manual",
      signal: AbortSignal.timeout(4500),
      headers: { "user-agent": "DG-Outbound-Research/1.0" },
      cache: "no-store",
    });
    if (!response.ok || Number(response.headers.get("content-length") || 0) > 1_500_000 ||
        !(response.headers.get("content-type") || "").includes("text/html")) return null;
    const html = (await response.text()).slice(0, 1_500_000).replace(/&amp;/g, "&");
    const link = html.match(/(?:https?:\/\/)?(?:wa\.me\/|(?:api|web)\.whatsapp\.com\/send\?phone=|whatsapp:\/\/send\?phone=)(?:%2b|\+)?[0-9+(). -]{9,24}/i);
    if (!link) return null;
    const phone = phoneFromWhatsApp(link[0]);
    return phone ? { phone, source: url.toString() } : null;
  } catch { return null; }
}
function greeting(company: string) {
  // Draft only. Actual outbound text must match the approved Meta template.
  return "Guten Morgen! Bin ich da bei " + company + " richtig? Raphael von Digitale Gewinner hier 👋";
}
export async function ensurePVWhatsAppSchema() {
  await ensureSalesOsSchema();
  await query(
    "create table if not exists pv_whatsapp_candidates (" +
    "id text primary key, workspace text not null default 'default'," +
    "lead_id text not null references sales_leads(id) on delete cascade," +
    "company_id text not null references sales_companies(id) on delete cascade," +
    "contact_id text, company text not null, website text not null," +
    "phone text not null, source_url text not null, draft_text text not null," +
    "planned_day date not null, slot integer not null check (slot between 1 and 30)," +
    "status text not null default 'draft', provider_message_id text," +
    "sent_at timestamptz, error text not null default '', created_at timestamptz not null default now()," +
    "unique(workspace,company_id), unique(workspace,phone), unique(workspace,planned_day,slot));" +
    "create index if not exists pv_whatsapp_candidates_day_idx on pv_whatsapp_candidates(workspace,planned_day,slot);"
  );
}
export async function preparePVWhatsAppDaily(workspace = "default") {
  await ensurePVWhatsAppSchema();
  const [{ n }] = await query<{ n: number }>(
    "select count(*)::int n from pv_whatsapp_candidates where workspace=$1 and planned_day=(now() at time zone 'Europe/Berlin')::date",
    [workspace],
  );
  const remaining = Math.max(0, DAILY_LIMIT - n);
  if (!remaining) return { created: 0, total: n, inspected: 0 };
  const prospects = await query<Prospect>(
    "select * from (" +
    "select distinct on (l.company_id) l.id lead_id,c.id company_id,ct.id contact_id,c.name company," +
    "c.website,coalesce(l.priority_score,0) priority_score,c.metadata company_metadata," +
    "ct.metadata contact_metadata " +
    "from sales_leads l join sales_companies c on c.id=l.company_id and c.workspace=l.workspace " +
    "left join lateral (select sc.id,sc.metadata from sales_contacts sc " +
    "where sc.workspace=c.workspace and sc.company_id=c.id order by sc.is_primary desc,sc.updated_at desc limit 1) ct on true " +
    "where l.workspace=$1 and l.status='active' and coalesce(l.do_not_contact,false)=false " +
    "and c.website<>'' and (c.source='ba-pv' or lower(c.industry) like '%solar%' " +
    "or lower(c.industry) like '%photovoltaik%' or lower(c.source) like 'pv-%' " +
    "or lower(c.source) like 'solar-%') " +
    "and not exists (select 1 from pv_whatsapp_candidates w where w.workspace=$1 and w.company_id=c.id) " +
    "order by l.company_id,l.priority_score desc) prospects " +
    "order by priority_score desc limit 120",
    [workspace],
  );
  let created = 0;
  let inspected = 0;
  const seenPhones = new Set<string>();
  for (let i = 0; i < prospects.length && created < remaining; i += 8) {
    const batch = prospects.slice(i, i + 8);
    const findings = await Promise.all(batch.map(async (p) => knownWhatsApp(p) || await findPublicWhatsApp(p.website)));
    for (let j = 0; j < batch.length && created < remaining; j++) {
      inspected++;
      const p = batch[j], found = findings[j];
      if (!found || seenPhones.has(found.phone)) continue;
      seenPhones.add(found.phone);
      const rows = await query<{ id: string }>(
        "insert into pv_whatsapp_candidates(id,workspace,lead_id,company_id,contact_id,company,website,phone,source_url,draft_text,planned_day,slot) " +
        "select $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,(now() at time zone 'Europe/Berlin')::date," +
        "coalesce((select max(slot) from pv_whatsapp_candidates where workspace=$2 and planned_day=(now() at time zone 'Europe/Berlin')::date),0)+1 " +
        "where (select count(*) from pv_whatsapp_candidates where workspace=$2 and planned_day=(now() at time zone 'Europe/Berlin')::date)<30 " +
        "on conflict do nothing returning id",
        [crypto.randomUUID(), workspace, p.lead_id, p.company_id, p.contact_id, p.company, p.website,
         found.phone, found.source, greeting(p.company)],
      );
      if (rows.length) created++;
    }
  }
  return { created, total: n + created, inspected };
}
type ConsentRow = {
  status: string; basis: string; valid_until: Date | null; valid_from: Date | null;
  evidence: Record<string, unknown> | null; contact_phone: string;
};
async function hasDocumentedConsent(row: { contact_id: string | null; phone: string; workspace: string; lead_id: string; company_id: string }) {
  if (!row.contact_id) return false;
  try {
  const permissions = await query<ConsentRow>(
    "select p.status,p.basis,p.valid_until,p.valid_from,p.evidence,sc.phone contact_phone " +
    "from outbound_contact_permissions p join sales_contacts sc on sc.id=p.contact_id and sc.workspace=p.workspace " +
    "where p.workspace=$1 and p.contact_id=$2 and p.channel='whatsapp' order by p.updated_at desc limit 1",
    [row.workspace, row.contact_id],
  );
  const p = permissions[0];
  if (!p || p.status !== "verified" || p.basis !== "explicit_consent" ||
      (p.valid_from && new Date(p.valid_from) > new Date()) ||
      (p.valid_until && new Date(p.valid_until) < new Date())) return false;
  const evidencePhone = typeof p.evidence?.phone === "string" ? p.evidence.phone : "";
  if (digits(p.contact_phone) !== row.phone && digits(evidencePhone) !== row.phone) return false;
  const suppressions = await query<{ blocked: boolean }>(
    "select (exists(select 1 from outbound_compliance_suppressions s " +
    "where s.workspace=$1 and s.status='active' and " +
    "((s.channel='whatsapp' and regexp_replace(s.identifier,'[^0-9]','','g')=$2) " +
    "or s.contact_id=$3 or s.company_id=$4 or s.lead_id=$5)) " +
    "or exists(select 1 from sales_leads l where l.workspace=$1 and l.id=$5 and (l.do_not_contact or l.status<>'active'))) blocked",
    [row.workspace, row.phone, row.contact_id, row.company_id, row.lead_id],
  );
  return !suppressions[0]?.blocked;
  } catch { return false; /* Missing compliance tables or DB errors must fail closed. */ }
}
export async function pvWhatsAppDashboard(workspace = "default") {
  await ensurePVWhatsAppSchema();
  const rows = await query<WhatsAppDraft & { workspace: string; contact_id: string | null; lead_id: string; company_id: string }>(
    "select *,planned_day::text planned_day from pv_whatsapp_candidates " +
    "where workspace=$1 and planned_day=(now() at time zone 'Europe/Berlin')::date order by slot",
    [workspace],
  );
  const enriched = await Promise.all(rows.map(async (r) => ({
    id: r.id, company: r.company, website: r.website, phone: r.phone,
    source_url: r.source_url, draft_text: r.draft_text, status: r.status,
    planned_day: r.planned_day, slot: r.slot, sent_at: r.sent_at,
    error: r.error, consent_ready: await hasDocumentedConsent(r),
  })));
  return {
    limit: DAILY_LIMIT, prepared: enriched.length,
    ready: enriched.filter(r => r.consent_ready && r.status === "draft").length,
    sent: enriched.filter(r => r.status === "sent").length,
    providerConfigured: Boolean(process.env.WHATSAPP_BUSINESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_TEMPLATE_NAME),
    autoSendEnabled: process.env.WHATSAPP_AUTO_SEND_ENABLED === "1",
    rows: enriched,
  };
}
export async function sendConsentedPVWhatsApp(workspace = "default") {
  await ensurePVWhatsAppSchema();
  if (process.env.WHATSAPP_AUTO_SEND_ENABLED !== "1") return { sent: 0, blocked: "auto_send_disabled" };
  const token = process.env.WHATSAPP_BUSINESS_TOKEN;
  const sender = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const template = process.env.WHATSAPP_TEMPLATE_NAME;
  if (!token || !sender || !template) return { sent: 0, blocked: "provider_unconfigured" };
  const available = await query<{ id: string; workspace: string; phone: string; contact_id: string | null; company_id: string; lead_id: string; company: string }>(
    "select id,workspace,phone,contact_id,company_id,lead_id,company from pv_whatsapp_candidates " +
    "where workspace=$1 and status='draft' and planned_day<=(now() at time zone 'Europe/Berlin')::date " +
    "order by planned_day,slot limit 60", [workspace],
  );
  let sent = 0, skipped = 0, failed = 0;
  for (const row of available) {
    const [counter] = await query<{ count: number }>(
      "select count(*)::int count from pv_whatsapp_candidates where workspace=$1 and status='sent' " +
      "and (sent_at at time zone 'Europe/Berlin')::date=(now() at time zone 'Europe/Berlin')::date",
      [workspace],
    );
    if (counter.count >= DAILY_LIMIT) break;
    if (!await hasDocumentedConsent(row)) { skipped++; continue; }
    const claimed = await query<{ id: string }>(
      "update pv_whatsapp_candidates set status='sending' where workspace=$1 and id=$2 and status='draft' returning id",
      [workspace, row.id],
    );
    if (!claimed.length) continue;
    try {
      const version = /^v\d+\.\d+$/.test(process.env.WHATSAPP_GRAPH_VERSION || "") ? process.env.WHATSAPP_GRAPH_VERSION : "v24.0";
      const response = await fetch("https://graph.facebook.com/" + version + "/" + encodeURIComponent(sender) + "/messages", {
        method: "POST", headers: { authorization: "Bearer " + token, "content-type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", to: row.phone, type: "template",
          template: { name: template, language: { code: process.env.WHATSAPP_TEMPLATE_LANGUAGE || "de" },
            components: [{ type: "body", parameters: [{ type: "text", text: row.company }] }] } }),
        signal: AbortSignal.timeout(12000),
      });
      const result = await response.json() as { messages?: Array<{ id: string }>; error?: { message?: string } };
      if (!response.ok || !result.messages?.[0]?.id) throw new Error(result.error?.message || "provider_rejected");
      await query(
        "update pv_whatsapp_candidates set status='sent',sent_at=now(),provider_message_id=$2,error='' where id=$1",
        [row.id, result.messages[0].id],
      );
      await query(
        "insert into sales_activities(workspace,lead_id,company_id,type,summary,meta) " +
        "values($1,$2,$3,'whatsapp.sent','WhatsApp-Erstnachricht über genehmigte Vorlage versendet',$4::jsonb)",
        [workspace, row.lead_id, row.company_id, JSON.stringify({ recipient: row.phone, providerMessageId: result.messages[0].id })],
      );
      sent++;
    } catch (error) {
      failed++;
      await query("update pv_whatsapp_candidates set status='failed',error=$2 where id=$1",
        [row.id, error instanceof Error ? error.message.slice(0,500) : "provider_error"]);
    }
  }
  return { sent, skipped, failed };
}

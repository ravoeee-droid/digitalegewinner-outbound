import { buildDailyOutboundPlan } from "@/lib/outbound-engine";
import { query } from "@/lib/db";
import { toE164, isValidPhone, type CloudTalkContact } from "@/lib/cloudtalk-api";

const text = (p: Record<string, unknown>, k: string) => { const v = p?.[k]; return typeof v === "string" || typeof v === "number" ? String(v) : ""; };

// Heute offene Call-Tasks des Nutzers als kontaktfertige Zeilen (nur mit Telefonnummer).
export async function openCallContacts(owner: string, tag: string): Promise<{ contacts: Array<CloudTalkContact & { leadId: string }>; openTasks: number; withoutPhone: number }> {
  const snapshot = await buildDailyOutboundPlan();
  const open = snapshot.tasks
    .filter((t) => t.channel === "call" && String(t.payload?.owner || "") === owner && !["done", "sent", "completed", "skipped"].includes(t.status))
    .sort((a, b) => a.rank - b.rank);
  // Die Tagesplanung enthält den Ansprechpartner nicht; aus den Kontakten des Leads ergänzen (wie im Cockpit).
  const people = new Map((await query<{ lead_id: string; name: string; email: string }>(
    `select l.id lead_id, coalesce(ct.name,'') name, coalesce(ct.email,'') email from sales_leads l left join sales_contacts ct on ct.id=l.contact_id where l.id=any($1::text[])`,
    [open.map((t) => t.lead_id)])).map((r) => [r.lead_id, r]));
  const contacts = open
    .flatMap((t) => {
      const p = t.payload || {};
      const phone = toE164(text(p, "contactPhone") || text(p, "phone"));
      if (!phone || !isValidPhone(phone)) return [];
      const person = (people.get(t.lead_id)?.name || text(p, "contactName") || text(p, "contact")).trim();
      return [{ leadId: t.lead_id, name: person || text(p, "company"), person: Boolean(person), company: text(p, "company"), phone, email: text(p, "contactEmail") || text(p, "email") || people.get(t.lead_id)?.email || "", city: text(p, "city"), website: text(p, "website"), tag }];
    });
  return { contacts, openTasks: open.length, withoutPhone: open.length - contacts.length };
}

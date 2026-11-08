import { buildDailyOutboundPlan } from "@/lib/outbound-engine";
import { toE164, type CloudTalkContact } from "@/lib/cloudtalk-api";

const text = (p: Record<string, unknown>, k: string) => { const v = p?.[k]; return typeof v === "string" || typeof v === "number" ? String(v) : ""; };

// Heute offene Call-Tasks des Nutzers als kontaktfertige Zeilen (nur mit Telefonnummer).
export async function openCallContacts(owner: string, tag: string): Promise<{ contacts: Array<CloudTalkContact & { leadId: string }>; openTasks: number; withoutPhone: number }> {
  const snapshot = await buildDailyOutboundPlan();
  const open = snapshot.tasks
    .filter((t) => t.channel === "call" && String(t.payload?.owner || "") === owner && !["done", "sent", "completed", "skipped"].includes(t.status))
    .sort((a, b) => a.rank - b.rank);
  const contacts = open
    .flatMap((t) => {
      const p = t.payload || {};
      const phone = toE164(text(p, "contactPhone") || text(p, "phone"));
      if (!phone) return [];
      return [{ leadId: t.lead_id, name: text(p, "contactName") || text(p, "contact") || text(p, "company"), company: text(p, "company"), phone, email: text(p, "contactEmail"), city: text(p, "city"), website: text(p, "website"), tag }];
    });
  return { contacts, openTasks: open.length, withoutPhone: open.length - contacts.length };
}

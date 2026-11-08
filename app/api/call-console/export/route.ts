import { cookies } from "next/headers";
import { adminCookieName, sessionRole } from "@/lib/admin-auth";
import { buildDailyOutboundPlan } from "@/lib/outbound-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Deutsche Nummern ins internationale Format: 0521 123 -> +49521123
export function toE164(raw: string) {
  const d = raw.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) return d;
  if (d.startsWith("00")) return `+${d.slice(2)}`;
  if (d.startsWith("0")) return `+49${d.slice(1)}`;
  return d;
}
const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const text = (p: Record<string, unknown>, k: string) => { const v = p?.[k]; return typeof v === "string" || typeof v === "number" ? String(v) : ""; };

// CSV der heute offenen Calls des angemeldeten Nutzers zum Import in eine CloudTalk-Kampagne (Tag pflege-heute).
export async function GET(request: Request) {
  const store = await cookies();
  const owner = sessionRole(store.get(adminCookieName())?.value) === "sales" ? "Mattias" : "Raphael";
  const tag = new URL(request.url).searchParams.get("tag") || "pflege-heute";
  const snapshot = await buildDailyOutboundPlan();
  const rows = snapshot.tasks
    .filter((t) => t.channel === "call" && String(t.payload?.owner || "") === owner && !["done", "sent", "completed", "skipped"].includes(t.status))
    .sort((a, b) => a.rank - b.rank)
    .map((t) => {
      const p = t.payload || {};
      const phone = toE164(text(p, "contactPhone") || text(p, "phone"));
      return phone ? [text(p, "contactName") || text(p, "contact") || text(p, "company"), text(p, "company"), phone, text(p, "contactEmail"), text(p, "city"), text(p, "website"), tag] : null;
    })
    .filter((r): r is string[] => r !== null);
  const csv = "﻿" + [["Name", "Firma", "Telefon", "E-Mail", "Stadt", "Website", "Tags"], ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="cloudtalk-${tag}.csv"` } });
}

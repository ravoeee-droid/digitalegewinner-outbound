import { cookies } from "next/headers";
import { adminCookieName, sessionRole } from "@/lib/admin-auth";
import { openCallContacts } from "@/lib/call-queue-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

// CSV der heute offenen Calls des angemeldeten Nutzers zum Import in eine CloudTalk-Kampagne (Tag pflege-heute).
export async function GET(request: Request) {
  const store = await cookies();
  const owner = sessionRole(store.get(adminCookieName())?.value) === "sales" ? "Mattias" : "Raphael";
  const tag = new URL(request.url).searchParams.get("tag") || "pflege-heute";
  const rows = (await openCallContacts(owner, tag)).contacts.map((c) => [c.name, c.company, c.phone, c.email, c.city, c.website, c.tag]);
  const csv = "﻿" + [["Name", "Firma", "Telefon", "E-Mail", "Stadt", "Website", "Tags"], ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="cloudtalk-${tag}.csv"` } });
}

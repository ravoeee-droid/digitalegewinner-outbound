import { cookies } from "next/headers";
import { z } from "zod";
import { adminCookieName, sessionRole } from "@/lib/admin-auth";
import {
  addSourcedCompany, addTerritoryEvidence, importTerritoryCandidate, listTerritory, scanCounty,
} from "@/lib/territory-intelligence";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

const states = [
  "Baden-Württemberg", "Bayern", "Berlin", "Brandenburg", "Bremen", "Hamburg",
  "Hessen", "Mecklenburg-Vorpommern", "Niedersachsen", "Nordrhein-Westfalen",
  "Rheinland-Pfalz", "Saarland", "Sachsen", "Sachsen-Anhalt",
  "Schleswig-Holstein", "Thüringen",
] as const;

const sourcedCompany = z.object({
  county: z.string().trim().min(3).max(100), state: z.enum(states),
  name: z.string().trim().min(3).max(240), city: z.string().trim().max(150).default(""),
  website: z.string().trim().max(600).default(""), phone: z.string().trim().max(120).default(""),
  sourceUrl: z.url().max(1200).refine(value => /^https?:\/\//i.test(value), "Nur HTTP(S)-Quellen."),
});

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("bulk_import"), companies: z.array(sourcedCompany).min(1).max(10) }),
  z.object({
    action: z.literal("scan"),
    county: z.string().trim().min(3).max(100),
    state: z.enum(states),
  }),
  z.object({
    action: z.literal("add"),
    county: z.string().trim().min(3).max(100),
    state: z.enum(states),
    name: z.string().trim().min(3).max(240),
    city: z.string().trim().max(150).default(""),
    website: z.string().trim().max(600).default(""),
    phone: z.string().trim().max(120).default(""),
    sourceUrl: z.url().max(1200).refine(value => /^https?:\/\//i.test(value), "Nur HTTP(S)-Quellen."),
  }),
  z.object({
    action: z.literal("evidence"),
    id: z.string().uuid(),
    kind: z.enum(["portal", "portal_listing", "ads", "hiring", "funnel", "references", "other"]),
    url: z.url().max(1200).refine(value => /^https?:\/\//i.test(value), "Nur HTTP(S)-Links erlaubt."),
    note: z.string().trim().min(4).max(800),
  }),
  z.object({ action: z.literal("import"), id: z.string().uuid() }),
]);

async function userRole() {
  const jar = await cookies();
  return sessionRole(jar.get(adminCookieName())?.value);
}
function errorJson(error: unknown) {
  const message = error instanceof Error ? error.message : "Aktion nicht möglich.";
  return Response.json({ error: message }, { status: 422 });
}

export async function GET(request: Request) {
  if (!(await userRole())) return Response.json({ error: "Nicht angemeldet." }, { status: 401 });
  try {
    const url = new URL(request.url);
    const county = (url.searchParams.get("county") || "").trim().slice(0, 100);
    const state = (url.searchParams.get("state") || "").trim().slice(0, 100);
    return Response.json(await listTerritory(county, state));
  } catch (error) { return errorJson(error); }
}

export async function POST(request: Request) {
  if ((await userRole()) !== "admin") return Response.json({ error: "Nur Administratoren dürfen Scans und Importe auslösen." }, { status: 403 });
  let raw: unknown;
  try { raw = await request.json(); }
  catch { return Response.json({ error: "Ungültige Anfrage." }, { status: 400 }); }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message || "Ungültige Eingabe." }, { status: 400 });
  try {
    const body = parsed.data;
    if (body.action === "bulk_import") {
      const results: Array<{ name: string; ok: boolean; leadId?: string; alreadyImported?: boolean; error?: string }> = [];
      for (const company of body.companies) {
        try {
          const added = await addSourcedCompany(company);
          if (!added.candidateId) throw new Error("Firma konnte nicht gespeichert werden.");
          const result = await importTerritoryCandidate(added.candidateId);
          results.push({ name: company.name, ok: true, ...result });
        } catch (error) {
          results.push({ name: company.name, ok: false, error: error instanceof Error ? error.message : "Import fehlgeschlagen." });
        }
      }
      return Response.json({ ok: true, results });
    }
    if (body.action === "scan") return Response.json({ ok: true, ...(await scanCounty(body.county, body.state)) });
    if (body.action === "add") return Response.json({ ok: true, ...(await addSourcedCompany(body)) });
    if (body.action === "evidence") return Response.json({ ok: true, ...(await addTerritoryEvidence(body.id, body.kind, body.url, body.note)) });
    return Response.json({ ok: true, ...(await importTerritoryCandidate(body.id)) });
  } catch (error) { return errorJson(error); }
}

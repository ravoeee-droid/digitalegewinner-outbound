import { NextResponse } from "next/server";

export const runtime = "nodejs";

function cleanKeyword(value: unknown) {
  const keyword = String(value || "").trim().replace(/\s+/g, " ");
  if (keyword.length < 2) throw new Error("Bitte ein vollständiges Keyword eingeben.");
  if (keyword.length > 200) throw new Error("Keyword ist zu lang.");
  return keyword;
}

function cleanLocation(value: unknown) {
  const location = String(value || "Germany").trim();
  return location.length > 80 ? "Germany" : location;
}

function cleanLanguage(value: unknown) {
  const language = String(value || "de").trim().toLowerCase();
  return /^[a-z]{2}$/.test(language) ? language : "de";
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { keyword?: unknown; location?: unknown; language?: unknown };
    const keyword = cleanKeyword(body.keyword);
    const location = cleanLocation(body.location);
    const language = cleanLanguage(body.language);
    const login = process.env.DATAFORSEO_LOGIN;
    const password = process.env.DATAFORSEO_PASSWORD;

    if (!login || !password) {
      return NextResponse.json({ connected: false, error: "DataForSEO ist noch nicht mit Zugangsdaten verbunden.", keyword, setup: ["DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD"] }, { status: 503 });
    }

    const auth = Buffer.from(`${login}:${password}`).toString("base64");
    const response = await fetch("https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Basic ${auth}` },
      body: JSON.stringify([{ keywords: [keyword], location_name: location, language_code: language, include_adult_keywords: false }]),
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    const data = await response.json() as { status_code?: number; status_message?: string; tasks?: Array<{ status_code?: number; status_message?: string; result?: Array<Record<string, unknown>> }> };
    const task = data.tasks?.[0];
    if (!response.ok || Number(data.status_code || 0) >= 40000 || Number(task?.status_code || 0) >= 40000) {
      throw new Error(task?.status_message || data.status_message || "DataForSEO Anfrage fehlgeschlagen.");
    }
    const item = task?.result?.[0] || null;
    return NextResponse.json({ connected: true, item });
  } catch (error) {
    const message = error instanceof Error && error.name === "TimeoutError" ? "DataForSEO hat zu lange gebraucht." : error instanceof Error ? error.message : "Keyword-Abfrage fehlgeschlagen.";
    return NextResponse.json({ connected: Boolean(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD), error: message }, { status: 502 });
  }
}

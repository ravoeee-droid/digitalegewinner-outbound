import { cookies } from "next/headers";
import { adminCookieName, sessionRole } from "@/lib/admin-auth";
import { cloudtalkConfigured } from "@/lib/cloudtalk-api";
import { syncCallQueue } from "@/lib/cloudtalk-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Schickt die heute offenen Calls als Kontakte (Tag pflege-heute) an CloudTalk. Jeder Lead höchstens einmal; ?dry=1 sendet nichts.
export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const dry = url.searchParams.get("dry") === "1";
    if (!dry && !cloudtalkConfigured()) return Response.json({ error: "CLOUDTALK_API_ID / CLOUDTALK_API_SECRET sind in Vercel nicht gesetzt." }, { status: 503 });
    const store = await cookies();
    const owner = sessionRole(store.get(adminCookieName())?.value) === "sales" ? "Mattias" : "Raphael";
    const result = await syncCallQueue({ owner, tag: url.searchParams.get("tag") || "pflege-heute", limit: Number(url.searchParams.get("limit")) || 20, dry });
    return Response.json({ ok: !result.fehler.length, ...result });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Sync fehlgeschlagen." }, { status: 500 });
  }
}

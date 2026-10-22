import { copyDatabase } from "@/lib/db-copy";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET;
  return Boolean(expected && (request.headers.get("authorization") || "") === `Bearer ${expected}`);
}

// Spiegelt die Datenbank auf NEW_DATABASE_URL, solange DB_MIGRATE=1 gesetzt ist. Nach der Umstellung (DB_CUTOVER=1) ist der Lauf gesperrt.
async function run(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (process.env.DB_MIGRATE !== "1") return Response.json({ ok: true, skipped: "DB_MIGRATE nicht aktiv" });
  try {
    const result = await copyDatabase();
    console.log("[db-migrate]", JSON.stringify(result));
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Kopieren fehlgeschlagen.";
    console.error("[db-migrate-error]", message);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(request: Request) { return run(request); }
export async function POST(request: Request) { return run(request); }

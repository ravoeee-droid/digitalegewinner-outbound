import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { adminCookieName, sessionRole } from "@/lib/admin-auth";
import { ensureLinkedinSchema, linkedinConnection, linkedinOAuthSettings, type LinkedinPost } from "@/lib/linkedin-content";
import { query } from "@/lib/db";
import { z } from "zod";

export const runtime = "nodejs";
const postSchema = z.object({
  text: z.string().trim().min(1).max(3000),
  scheduledAt: z.string().datetime({ offset: true }).optional().nullable()
});
const editSchema = postSchema.partial().extend({
  id: z.string().uuid(),
  action: z.enum(["save", "cancel", "reschedule"]).default("save")
});

async function isAdmin() {
  const jar = await cookies();
  return sessionRole(jar.get(adminCookieName())?.value) === "admin";
}

function trustedOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; }
  catch { return false; }
}
function safeTime(input?: string | null) {
  if (!input) return null;
  const date = new Date(input);
  if (!Number.isFinite(date.getTime()) || date.getTime() < Date.now() - 60000) {
    throw new Error("Bitte einen zukünftigen Zeitpunkt mit Zeitzonen-Offset angeben.");
  }
  return date.toISOString();
}
function errorResponse(error: unknown) {
  return Response.json(
    { error: error instanceof Error ? error.message : "Ungültige Eingabe." },
    { status: 400 }
  );
}

export async function GET() {
  if (!(await isAdmin())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await ensureLinkedinSchema();
    const posts = await query<LinkedinPost>(
      "select id,text,scheduled_at,status,attempts,post_urn,published_at,error,created_at " +
      "from dg_linkedin_posts order by coalesce(scheduled_at,created_at) desc limit 200"
    );
    const connection = await linkedinConnection();
    return Response.json({
      posts,
      connected: connection.connected,
      authorUrn: connection.authorUrn,
      tokenExpiresAt: connection.expiresAt,
      oauthConfigured: linkedinOAuthSettings().configured
    });
  } catch (error) { return Response.json({ error: String(error) }, { status: 503 }); }
}

export async function POST(request: Request) {
  if (!(await isAdmin())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!trustedOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  try {
    const data = postSchema.parse(await request.json());
    const scheduledAt = safeTime(data.scheduledAt);
    await ensureLinkedinSchema();
    const rows = await query<{id:string}>(
      "insert into dg_linkedin_posts(id,text,scheduled_at,status) values($1,$2,$3,$4) returning id",
      [randomUUID(),data.text,scheduledAt,scheduledAt ? "scheduled" : "draft"]
    );
    return Response.json({ ok: true, id: rows[0]?.id, status: scheduledAt ? "scheduled" : "draft" }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  if (!(await isAdmin())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!trustedOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  try {
    const data = editSchema.parse(await request.json());
    await ensureLinkedinSchema();
    if (data.action === "cancel") {
      const rows = await query<{id:string}>(
        "update dg_linkedin_posts set status='cancelled',updated_at=now() " +
        "where id=$1 and status in ('draft','scheduled','failed') returning id", [data.id]
      );
      return rows.length ? Response.json({ ok:true }) : Response.json({ error:"Beitrag nicht stornierbar." },{ status:409 });
    }
    if (!data.text || !data.scheduledAt) throw new Error("Zum Bearbeiten Text und neuen Termin angeben.");
    const scheduledAt = safeTime(data.scheduledAt);
    const rows = await query<{id:string}>(
      "update dg_linkedin_posts set text=$2,scheduled_at=$3,status='scheduled',error=null,updated_at=now() " +
      "where id=$1 and status in ('draft','scheduled','failed','cancelled') returning id",
      [data.id,data.text,scheduledAt]
    );
    return rows.length ? Response.json({ok:true}) : Response.json({error:"Beitrag kann nicht mehr verändert werden."},{status:409});
  } catch (error) { return errorResponse(error); }
}

import { cookies } from "next/headers";
import { z } from "zod";
import { query } from "@/lib/db";
import { adminCookieName, sessionRole } from "@/lib/admin-auth";
import { leadSegmentSql } from "@/lib/lead-segment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inputSchema = z.object({ segment: z.enum(["pflege", "pv", "other"]) });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const cookie = (await cookies()).get(adminCookieName())?.value;
  if (sessionRole(cookie) !== "admin") return Response.json({ error: "Nur Administratoren dürfen Geschäftsfelder korrigieren." }, { status: 403 });
  const { id } = await params;
  if (!id || id.length > 180) return Response.json({ error: "Ungültiger Lead." }, { status: 400 });
  let input: z.infer<typeof inputSchema>;
  try { input = inputSchema.parse(await request.json()); }
  catch { return Response.json({ error: "Ungültiges Geschäftsfeld." }, { status: 400 }); }

  try {
    const [lead] = await query<{ id: string; company_id: string; old_segment: string }>(
      "select l.id::text id,c.id company_id," + leadSegmentSql("c") + " old_segment " +
      "from sales_leads l join sales_companies c on c.id=l.company_id and c.workspace=l.workspace " +
      "where l.workspace='default' and l.id::text=$1 and l.status='active' limit 1", [id],
    );
    if (!lead) return Response.json({ error: "Lead nicht gefunden." }, { status: 404 });
    await query(
      "update sales_companies set metadata=coalesce(metadata,'{}'::jsonb) || " +
      "jsonb_build_object('business_segment',$2::text,'business_segment_verified_at',now()::text), " +
      "updated_at=now() where id=$1 and workspace='default'",
      [lead.company_id, input.segment],
    );
    await query(
      "insert into sales_activities(workspace,lead_id,company_id,type,summary,meta) " +
      "values('default',$1,$2,'lead.segment_corrected',$3,$4::jsonb)",
      [id, lead.company_id, "Geschäftsfeld manuell zu " + input.segment + " geändert",
        JSON.stringify({ from: lead.old_segment, to: input.segment, actor: "admin" })],
    ).catch(() => null);
    return Response.json({ ok: true, segment: input.segment }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("[lead-segment-update]", error);
    return Response.json({ error: "Geschäftsfeld konnte nicht gespeichert werden." }, { status: 500 });
  }
}

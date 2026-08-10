import { query } from "@/lib/db";
import { z } from "zod";

export const runtime = "nodejs";
const schema = z.object({
  leadId: z.string().optional(),
  email: z.string().email().optional(),
  type: z.enum(["reply","positive_reply","bounce","unsubscribe","appointment","microsite_view","video_view"]),
  meta: z.record(z.string(), z.unknown()).optional().default({}),
});

export async function POST(request: Request) {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) return Response.json({ error:"WEBHOOK_SECRET fehlt." }, { status:503 });
  if (request.headers.get("x-energy-radar-secret") !== secret) return Response.json({ error:"Unauthorized" }, { status:401 });
  try {
    const input = schema.parse(await request.json());
    await query("insert into er_events(workspace,lead_id,type,meta) values('default',$1,$2,$3::jsonb)", [input.leadId || null,input.type,JSON.stringify({ ...input.meta, email:input.email })]);
    if ((input.type === "bounce" || input.type === "unsubscribe") && input.email) {
      await query(
        `insert into er_suppressions(workspace,email,reason) values('default',lower($1),$2)
         on conflict(workspace,email) do update set reason=excluded.reason`,
        [input.email,input.type],
      );
      await query("update er_outbox set status='suppressed' where workspace='default' and lower(recipient)=lower($1) and status='queued'", [input.email]);
    }
    if (input.leadId && ["reply","positive_reply","appointment"].includes(input.type)) {
      await query("update er_outbox set status='stopped' where workspace='default' and lead_id=$1 and status='queued'", [input.leadId]);
    }
    return Response.json({ ok:true });
  } catch (error) {
    return Response.json({ error:error instanceof Error ? error.message : "Event ungültig." }, { status:400 });
  }
}

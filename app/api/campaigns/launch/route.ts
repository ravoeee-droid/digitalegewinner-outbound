import { query } from "@/lib/db";
import { z } from "zod";

export const runtime = "nodejs";

const schema = z.object({
  campaign: z.object({ id: z.string(), steps: z.array(z.object({ waitDays: z.number().int().min(0).max(60), subject: z.string().min(1), body: z.string().min(1) })).min(1) }),
  leads: z.array(z.object({ id: z.string(), email: z.string().email(), company: z.string(), contact: z.string().optional().default(""), city: z.string().optional().default("") })).min(1).max(5000),
  mailboxes: z.array(z.object({ id: z.string(), enabled: z.boolean(), dailyLimit: z.number().int().min(1).max(100) })).min(1),
  senderName: z.string().default("Walkenhorst Energie"),
  appUrl: z.string().url().optional(),
});

function render(template: string, lead: { id:string; company:string; contact:string; city:string }, senderName:string, appUrl:string) {
  const first = lead.contact.trim().split(/\s+/)[0] || "Guten Tag";
  return template
    .replaceAll("{{first_name}}", first)
    .replaceAll("{{company}}", lead.company)
    .replaceAll("{{city}}", lead.city)
    .replaceAll("{{sender_name}}", senderName)
    .replaceAll("{{analysis_link}}", `${appUrl}/a/${encodeURIComponent(lead.id)}`);
}

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const active = input.mailboxes.filter((m) => m.enabled && m.dailyLimit > 0);
    if (!active.length) return Response.json({ error: "Keine aktive Mailbox." }, { status: 409 });
    const suppressedRows = await query<{email:string}>("select email from er_suppressions where workspace='default'");
    const suppressed = new Set(suppressedRows.map((r) => r.email.toLowerCase()));
    const appUrl = input.appUrl || process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
    let queued = 0, skipped = 0, index = 0;
    for (const lead of input.leads) {
      if (suppressed.has(lead.email.toLowerCase())) { skipped++; continue; }
      const mailbox = active[index++ % active.length];
      for (const step of input.campaign.steps) {
        const id = crypto.randomUUID();
        const scheduled = new Date(Date.now() + step.waitDays * 86400000);
        await query(
          `insert into er_outbox(id,workspace,campaign_id,lead_id,mailbox_id,recipient,subject,body,scheduled_at)
           values($1,'default',$2,$3,$4,$5,$6,$7,$8)`,
          [id,input.campaign.id,lead.id,mailbox.id,lead.email,render(step.subject,lead,input.senderName,appUrl),render(step.body,lead,input.senderName,appUrl),scheduled],
        );
        queued++;
      }
    }
    return Response.json({ ok:true, queued, skipped, leads: input.leads.length });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Kampagne konnte nicht gestartet werden." }, { status:400 });
  }
}

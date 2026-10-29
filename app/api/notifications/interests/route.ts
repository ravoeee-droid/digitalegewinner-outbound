import { query } from "@/lib/db";
import { classifyLeadSegment } from "@/lib/lead-segment";
import { isAutomaticAcknowledgement } from "@/lib/reply-insight";
import { classifyInboxMessage } from "@/lib/inbox-classifier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Interest = {
  id: string;
  lead_id: string;
  company: string;
  industry: string;
  source: string;
  metadata: Record<string, unknown>;
  reply_class: string;
  created_at: string;
  subject: string;
  body_text: string;
};

// Authentifizierung erfolgt für /api/* über proxy.ts. Keine Mailinhalte an
// die allgemeine Benachrichtigungsansicht ausgeben.
export async function GET() {
  try {
    const items = await query<Interest>(`
      select 'legacy:' || e.id::text id,e.lead_id,c.name company,
             coalesce(c.industry,'') industry,coalesce(c.source,'') source,c.metadata,
             e.meta->>'replyClass' reply_class,e.created_at,
             coalesce(m.subject,e.meta->>'subject','') subject,
             coalesce(m.body_text,'') body_text
      from er_events e
      left join lateral (
        select subject,body_text
        from outbound_conversation_messages
        where workspace='default'
          and direction='inbound'
          and provider_message_id=e.meta->>'messageId'
        order by created_at desc limit 1
      ) m on true
      join sales_leads l on l.id=e.lead_id and l.workspace=e.workspace
      join sales_companies c on c.id=l.company_id and c.workspace=l.workspace
      where e.workspace='default' and e.type='reply_classified'
        and e.meta->>'replyClass' in ('positive','meeting_intent','needs_information')
        and e.created_at >= now()-interval '14 days'
        and not coalesce(l.do_not_contact,false)
      union all
      select 'v3:' || r.id::text id,t.lead_id,c.name company,
             coalesce(c.industry,'') industry,coalesce(c.source,'') source,c.metadata,
             r.reply_class,r.created_at,m.subject,m.body_text
      from outbound_reply_classifications r
      join outbound_conversation_messages m on m.id=r.message_id
      join outbound_conversation_threads t on t.id=m.thread_id
      join sales_leads l on l.id=t.lead_id and l.workspace='default'
      join sales_companies c on c.id=l.company_id and c.workspace='default'
      where r.workspace='default' and r.reply_class in ('positive','meeting_intent','needs_information')
        and r.created_at >= now()-interval '14 days'
        and not coalesce(l.do_not_contact,false)
      order by created_at desc limit 40
    `);
    return Response.json({
      items: items.filter(item => {
        // Historische Falschklassifikationen dürfen keine Interessentenalarme auslösen.
        if (isAutomaticAcknowledgement(item.subject || "", item.body_text || "")) return false;
        const insight = classifyInboxMessage({ from: "", subject: item.subject || "", bodyText: item.body_text || "" });
        return !insight.automatic && insight.category !== "absage" && insight.category !== "kontaktstopp";
      }).map(item => ({
        id: item.id,
        leadId: item.lead_id,
        company: item.company,
        category: item.reply_class,
        at: item.created_at,
        segment: classifyLeadSegment({
          company: item.company,
          industry: item.industry,
          source: item.source,
          metadata: item.metadata,
        }),
      })),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[interest-notifications] query failed", error instanceof Error ? error.message : "unknown");
    return Response.json({ error: "Interessenten konnten nicht geladen werden." }, { status: 503 });
  }
}

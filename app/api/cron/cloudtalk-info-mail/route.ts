import { cloudtalkConfigured, cloudTalkContactIdsByTag } from "@/lib/cloudtalk-api";
import { processDgDialerBatch } from "@/lib/cloudtalk-dialer";
import { query } from "@/lib/db";
import { ensureRevenueOpportunitySchema } from "@/lib/revenue-opportunities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const infoMailTagId = "130825450";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!cloudtalkConfigured()) {
    return Response.json({ error: "CloudTalk-Zugang fehlt." }, { status: 503 });
  }

  let contacts = 0;
  let imported = 0;
  let unmatched = 0;
  try {
    await ensureRevenueOpportunitySchema();
    const dialer = process.env.CLOUDTALK_DIALER_WEBHOOK_SECRET
      ? await processDgDialerBatch()
      : null;
    for await (const contactId of cloudTalkContactIdsByTag(infoMailTagId)) {
      contacts++;
      const [result] = await query<{ matched: number; imported: number }>(`
        with matches as (
          select distinct l.id, l.workspace, l.company_id
          from sales_activities a
          join sales_leads l on l.id=a.lead_id and l.workspace=a.workspace
          where a.workspace='default' and a.type='cloudtalk.sync'
            and a.meta->>'tag'='pflege-heute' and a.meta->>'cloudtalkContactId'=$1
            and l.status='active' and not coalesce(l.do_not_contact,false)
        ), opportunity as (
          insert into sales_opportunities
            (id,workspace,lead_id,company_id,product_key,stage,status,source,probability,next_action,next_action_at)
          select $2,workspace,id,company_id,'pflege_recruiting','Info angefragt','open','manual',25,'Gewünschte Info-Mail senden',now()
          from matches where (select count(*) from matches)=1
          on conflict(workspace,lead_id,product_key) do update set
            stage=excluded.stage,source=excluded.source,
            probability=greatest(sales_opportunities.probability,excluded.probability),
            next_action=excluded.next_action,next_action_at=excluded.next_action_at,updated_at=now()
          where sales_opportunities.status='open'
            and sales_opportunities.stage in ('Neu','Geprüft','Call bereit','Kontaktiert','Nachfassen','Interesse')
            and not exists (
              select 1 from sales_activities a
              where a.workspace=sales_opportunities.workspace and a.lead_id=sales_opportunities.lead_id
                and a.type='cloudtalk.info_mail' and a.meta->>'cloudtalkContactId'=$1
            )
          returning id,workspace,lead_id,company_id
        ), lead_update as (
          update sales_leads l
          set last_outcome='info_mail',next_action='Info-Mail senden',next_action_at=now(),updated_at=now()
          from opportunity o where l.id=o.lead_id and l.workspace=o.workspace
        ), logged as (
          insert into sales_activities(workspace,lead_id,company_id,type,summary,meta)
          select workspace,lead_id,company_id,'cloudtalk.info_mail','Info-Mail in CloudTalk angefragt',
                 jsonb_build_object('cloudtalkContactId',$1::text,'opportunityId',id)
          from opportunity
          returning id
        )
        select (select count(*)::int from matches) matched, (select count(*)::int from logged) imported
      `, [contactId, crypto.randomUUID()]);
      imported += result.imported;
      if (result.matched !== 1) unmatched++;
    }
    return Response.json({ ok: true, contacts, imported, unmatched, dialer });
  } catch (error) {
    console.error("CloudTalk Info-Mail-Import fehlgeschlagen", error);
    return Response.json({ error: "Info-Mail-Import fehlgeschlagen.", contacts, imported, unmatched }, { status: 500 });
  }
}

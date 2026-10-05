import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { ensureSalesOsSchema } from "@/lib/sales-os";
import { buildDailyOutboundPlan } from "@/lib/outbound-engine";
import seedRows from "@/data/call-leads-2026-10-05.json";

export const dynamic = "force-dynamic";
// Runs in the project's configured data region.
// fra1 rebuild marker


async function seedInitialCallLeads() {
  const payload = JSON.stringify(seedRows);
  await query(`
    with x as (
      select * from jsonb_to_recordset($1::jsonb) as r(
        c text,o text,p text,e text,w text,d text,r text,s int,q text,j text,a int,u int,t text,g text,n int
      )
    )
    insert into sales_companies(id,workspace,name,domain,website,city,industry,phone,source,source_id,research_status,latest_score,metadata)
    select
      'seed-' || md5(lower(c) || '|' || lower(o)),
      'default',c,'',coalesce(w,''),coalesce(o,''),'Pflege',coalesce(p,''),'lead-master','',
      'complete',coalesce(s,0),
      jsonb_build_object(
        'daily_qualification',jsonb_build_object(
          'tier',case when q='P1' then 'A+' else 'A' end,
          'reasons',jsonb_build_array(coalesce(g,'')),
          'jobGrowth',jsonb_build_object('relevantOpenJobs',1)
        ),
        'jobUrl',coalesce(j,''),'jobAgeDays',a,'updateDays',u,'priority',q,'callOrder',n,'owner',r
      )
    from x
    on conflict(id) do update set
      name=excluded.name,website=excluded.website,city=excluded.city,industry=excluded.industry,
      phone=excluded.phone,research_status='complete',latest_score=excluded.latest_score,
      metadata=excluded.metadata,updated_at=now()
  `, [payload]);

  await query(`
    with x as (
      select * from jsonb_to_recordset($1::jsonb) as r(
        c text,o text,p text,e text,w text,d text,r text,s int,q text,j text,a int,u int,t text,g text,n int
      )
    )
    insert into sales_contacts(id,workspace,company_id,name,email,phone,linkedin,instagram,is_primary,source,metadata)
    select
      'contact-' || md5(lower(c) || '|' || lower(o)),
      'default','seed-' || md5(lower(c) || '|' || lower(o)),
      coalesce(d,''),coalesce(e,''),coalesce(p,''),'','',true,'lead-master','{}'::jsonb
    from x
    on conflict(id) do update set
      name=excluded.name,email=excluded.email,phone=excluded.phone,is_primary=true,updated_at=now()
  `, [payload]);

  await query(`
    with x as (
      select * from jsonb_to_recordset($1::jsonb) as r(
        c text,o text,p text,e text,w text,d text,r text,s int,q text,j text,a int,u int,t text,g text,n int
      )
    )
    insert into sales_leads(
      id,workspace,company_id,contact_id,stage,status,intent_score,fit_score,opportunity_score,priority_score,owner,notes
    )
    select
      'lead-' || md5(lower(c) || '|' || lower(o)),
      'default','seed-' || md5(lower(c) || '|' || lower(o)),
      'contact-' || md5(lower(c) || '|' || lower(o)),
      'Bereit','active',95,95,95,coalesce(s,0),r,
      concat_ws(E'\\n',coalesce(g,''),case when coalesce(t,'')<>'' then 'Offene Rollen: '||t else '' end,'Quelle: '||coalesce(j,''))
    from x
    on conflict(id) do update set
      contact_id=excluded.contact_id,stage='Bereit',status='active',priority_score=excluded.priority_score,
      owner=excluded.owner,notes=excluded.notes,updated_at=now()
  `, [payload]);
}

export async function GET() {
  const started = Date.now();
  try {
    await ensureSalesOsSchema();
    const before = await query<{ n: number }>("select count(*)::int as n from sales_leads where workspace='default' and status='active'");
    if (Number(before[0]?.n || 0) === 0) await seedInitialCallLeads();
    await buildDailyOutboundPlan();
    const rows = await query<{ ok: number; sales_leads: string | null }>(
      "select 1 as ok, to_regclass('public.sales_leads')::text as sales_leads",
    );
    return NextResponse.json({
      ok: rows[0]?.ok === 1,
      latencyMs: Date.now() - started,
      salesSchema: Boolean(rows[0]?.sales_leads),
      leads: (await query<{ n: number }>("select count(*)::int as n from sales_leads where workspace='default' and status='active'"))[0]?.n || 0,
      owners: await query<{ owner: string; n: number }>("select owner,count(*)::int as n from sales_leads where workspace='default' and status='active' group by owner order by owner"),
      callTasks: await query<{ owner: string; n: number }>("select coalesce(payload->>'owner','') owner,count(*)::int as n from sales_outbound_tasks where workspace='default' and task_date=(now() at time zone 'Europe/Berlin')::date and channel='call' group by 1 order by 1"),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Database connection failed";
    return NextResponse.json(
      { ok: false, latencyMs: Date.now() - started, error: message.slice(0, 180) },
      { status: 503 },
    );
  }
}

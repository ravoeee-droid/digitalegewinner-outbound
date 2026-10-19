import { query } from "@/lib/db";
import seedRows from "@/data/call-leads-2026-10-05.json";

// Mitgelieferte Anruf-Leads, wenn die Datenbank (fast) leer ist.
export async function seedInitialCallLeads() {
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

export async function countActiveLeads() {
  const rows = await query<{ n: number }>("select count(*)::int as n from sales_leads where workspace='default' and status='active'");
  return Number(rows[0]?.n || 0);
}

export async function seedCallLeadsIfEmpty() {
  const before = await countActiveLeads();
  if (before >= 10) return { seeded: false, leads: before };
  await seedInitialCallLeads();
  return { seeded: true, leads: await countActiveLeads() };
}

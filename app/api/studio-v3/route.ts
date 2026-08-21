import { z } from "zod";
import { query } from "@/lib/db";
import { defaultStudioProject, type StudioProject } from "@/lib/studio-v3-pflege";

export const runtime = "nodejs";

const saveSchema = z.object({
  leadId: z.string().max(220).optional().default("global"),
  project: z.record(z.string(), z.unknown()),
  note: z.string().max(500).optional().default(""),
  publish: z.boolean().optional().default(false),
});

let ready = false;
async function ensureStudioSchema() {
  if (ready) return;
  await query(`
    create table if not exists sales_studio_projects (
      workspace text not null default 'default',
      scope text not null default 'global',
      project jsonb not null default '{}'::jsonb,
      published_project jsonb,
      revision integer not null default 1,
      published_revision integer not null default 0,
      updated_at timestamptz not null default now(),
      primary key(workspace,scope)
    );
    create table if not exists sales_studio_versions (
      id bigserial primary key,
      workspace text not null default 'default',
      scope text not null default 'global',
      revision integer not null,
      snapshot jsonb not null,
      note text not null default '',
      created_at timestamptz not null default now()
    );
    create index if not exists sales_studio_versions_scope_idx on sales_studio_versions(workspace,scope,revision desc);
  `);
  ready = true;
}

async function loadLeads() {
  return query<{
    id: string; company: string; contact: string; city: string; industry: string; website: string; email: string; phone: string;
    notes: string; priority_score: number; opportunity_score: number; website_score: number;
  }>(`
    select l.id,c.name as company,coalesce(ct.name,'') as contact,c.city,c.industry,c.website,
           coalesce(ct.email,'') as email,coalesce(ct.phone,c.phone,'') as phone,l.notes,
           l.priority_score,l.opportunity_score,coalesce(rr.website_score,0)::int as website_score
    from sales_leads l
    join sales_companies c on c.id=l.company_id
    left join sales_contacts ct on ct.id=l.contact_id
    left join lateral (
      select website_score from sales_research_runs r where r.company_id=l.company_id order by r.created_at desc limit 1
    ) rr on true
    where l.workspace='default' and l.status='active'
      and (lower(coalesce(c.industry,'')) like '%pflege%' or lower(c.name) like '%pflege%' or c.source like 'pflege%' or coalesce(c.metadata->>'campaign','') like 'pflege%')
    order by l.priority_score desc,l.updated_at desc
    limit 250
  `);
}

export async function GET(request: Request) {
  try {
    await ensureStudioSchema();
    const url = new URL(request.url);
    const scope = url.searchParams.get("leadId") || "global";
    const leads = await loadLeads();
    const rows = await query<{ project: StudioProject; published_project: StudioProject | null; revision: number; published_revision: number; updated_at: string }>(
      `select project,published_project,revision,published_revision,updated_at from sales_studio_projects where workspace='default' and scope=$1 limit 1`,
      [scope],
    );
    let project = rows[0]?.project || null;
    if (!project && scope !== "global") {
      const master = await query<{ project: StudioProject }>(
        `select project from sales_studio_projects where workspace='default' and scope='global' limit 1`,
      );
      project = master[0]?.project || null;
    }
    if (!project) project = defaultStudioProject();
    const versions = await query<{ id: number; revision: number; note: string; created_at: string }>(
      `select id,revision,note,created_at from sales_studio_versions where workspace='default' and scope=$1 order by revision desc limit 20`,
      [scope],
    );
    return Response.json({
      leads: leads.map((lead) => ({
        id: lead.id,
        company: lead.company,
        contact: lead.contact,
        city: lead.city,
        industry: lead.industry,
        website: lead.website,
        email: lead.email,
        phone: lead.phone,
        notes: lead.notes,
        priorityScore: Number(lead.priority_score || 0),
        opportunityScore: Number(lead.opportunity_score || 0),
        websiteScore: Number(lead.website_score || 0),
      })),
      project,
      revision: rows[0]?.revision || 0,
      publishedRevision: rows[0]?.published_revision || 0,
      versions,
      updatedAt: rows[0]?.updated_at || null,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Studio V3 konnte nicht geladen werden." }, { status: 503 });
  }
}

export async function PUT(request: Request) {
  try {
    await ensureStudioSchema();
    const input = saveSchema.parse(await request.json());
    const scope = input.leadId || "global";
    const project = { ...input.project, version: 3, updatedAt: new Date().toISOString() } as unknown as StudioProject;
    const rows = await query<{ revision: number; published_revision: number }>(
      `insert into sales_studio_projects(workspace,scope,project,published_project,revision,published_revision)
       values('default',$1,$2::jsonb,case when $3 then $2::jsonb else null end,1,case when $3 then 1 else 0 end)
       on conflict(workspace,scope) do update set
         project=excluded.project,
         revision=sales_studio_projects.revision+1,
         published_project=case when $3 then excluded.project else sales_studio_projects.published_project end,
         published_revision=case when $3 then sales_studio_projects.revision+1 else sales_studio_projects.published_revision end,
         updated_at=now()
       returning revision,published_revision`,
      [scope, JSON.stringify(project), input.publish],
    );
    const revision = rows[0]?.revision || 1;
    await query(
      `insert into sales_studio_versions(workspace,scope,revision,snapshot,note) values('default',$1,$2,$3::jsonb,$4)`,
      [scope, revision, JSON.stringify(project), input.note || (input.publish ? "Veröffentlicht" : "Gespeichert")],
    );
    await query(
      `insert into sales_activities(workspace,lead_id,company_id,type,summary,meta)
       select 'default',case when $1='global' then null else $1 end,l.company_id,$2,$3,$4::jsonb
       from sales_leads l where l.id=case when $1='global' then '' else $1 end
       union all
       select 'default',null,null,$2,$3,$4::jsonb where $1='global'`,
      [scope, input.publish ? "studio.published" : "studio.saved", input.publish ? `Studio V3 Revision ${revision} veröffentlicht` : `Studio V3 Revision ${revision} gespeichert`, JSON.stringify({ revision, scope })],
    ).catch(() => []);
    return Response.json({ ok: true, revision, publishedRevision: rows[0]?.published_revision || 0, project });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Studio V3 konnte nicht gespeichert werden." }, { status: 400 });
  }
}

import { query } from "./db";
import { ensureSalesOsSchema } from "./sales-os";

// Tagesziel: 50 Cold Calls im Cockpit, 200 E-Mails (10 Postfächer x 20).
export const MAILBOX_DAILY_TARGET = 20;
export const OUTBOUND_TARGETS = {
  call: 50,
  email: 200,
  video: 30,
  linkedin: 30,
} as const;

export type OutboundChannel = keyof typeof OUTBOUND_TARGETS;

type ChannelCountRow = { channel: OutboundChannel; ready: number; done: number; total: number };

type TaskRow = {
  id: string;
  channel: OutboundChannel;
  rank: number;
  status: string;
  score: number;
  lead_id: string;
  company_id: string;
  payload: Record<string, unknown>;
  updated_at: string;
};

let schemaReady = false;

export async function ensureOutboundEngineSchema() {
  if (schemaReady) return;
  await ensureSalesOsSchema();
  await query(`
    create table if not exists sales_outbound_tasks (
      id text primary key,
      workspace text not null,
      task_date date not null,
      lead_id text not null references sales_leads(id) on delete cascade,
      company_id text not null references sales_companies(id) on delete cascade,
      channel text not null,
      rank integer not null default 0,
      score integer not null default 0,
      status text not null default 'ready',
      payload jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create unique index if not exists sales_outbound_tasks_daily_idx
      on sales_outbound_tasks(workspace, task_date, lead_id, channel);
    create index if not exists sales_outbound_tasks_queue_idx
      on sales_outbound_tasks(workspace, task_date, channel, status, rank);
  `);
  schemaReady = true;
}

const baseCandidateSql = `
  select
    l.id lead_id,
    c.id company_id,
    c.name company,
    c.city,
    c.website,
    coalesce(ct.email,'') email,
    coalesce(ct.phone,c.phone,'') phone,
    coalesce(ct.linkedin,'') linkedin,
    coalesce(c.metadata->>'jobAdUrl','') job_ad_url,
    l.priority_score score,
    l.owner,
    coalesce(c.metadata->'daily_qualification'->>'tier','') tier,
    coalesce(c.metadata->'daily_qualification'->'reasons','[]'::jsonb) reasons,
    coalesce(c.metadata->'daily_qualification'->>'websiteWeak','false') website_weak,
    coalesce((c.metadata->'daily_qualification'->'jobGrowth'->>'relevantOpenJobs')::int,0) job_count
  from sales_leads l
  join sales_companies c on c.id=l.company_id and c.workspace=l.workspace
  left join sales_contacts ct on ct.id=l.contact_id
  where l.workspace=$1
    and l.status='active'
    and l.stage in ('Neu','Research','Bereit')
    and coalesce(l.do_not_contact,false)=false
`;

function insertChannelSql(channel: OutboundChannel, extraWhere: string, target: number) {
  return `
    with candidates as (
      ${baseCandidateSql}
      and ${extraWhere}
    ), ranked as (
      select *, row_number() over (
        order by
          case tier when 'A+' then 0 when 'A' then 1 when 'B' then 2 else 3 end,
          score desc,
          job_count desc,
          company asc
      )::int as rn
      from candidates
    )
    insert into sales_outbound_tasks(
      id,workspace,task_date,lead_id,company_id,channel,rank,score,status,payload
    )
    select
      lead_id || ':${channel}:' || ((now() at time zone 'Europe/Berlin')::date)::text,
      $1,
      (now() at time zone 'Europe/Berlin')::date,
      lead_id,
      company_id,
      '${channel}',
      rn,
      score,
      'ready',
      jsonb_build_object(
        'company',company,
        'city',city,
        'website',website,
        'email',email,
        'phone',phone,
        'linkedin',linkedin,
        'jobAdUrl',job_ad_url,
        'tier',tier,
        'reasons',reasons,
        'websiteWeak',website_weak,
        'jobCount',job_count,
        'owner',owner
      )
    from ranked
    where rn <= ${target}
    on conflict(workspace,task_date,lead_id,channel) do update set
      rank=excluded.rank,
      score=excluded.score,
      payload=excluded.payload,
      updated_at=now()
  `;
}

function insertCallChannelSql() {
  return `
    with candidates as (
      ${baseCandidateSql}
      and coalesce(ct.phone,c.phone,'')<>''
      and l.owner in ('Raphael','Mattias')
      and (
        lower(coalesce(c.metadata->>'jobRole',''))='pflegefachkraft'
        or lower(coalesce(c.metadata->>'jobAdUrl','')) like '%/pflegefachkraft/%'
        or lower(coalesce(c.metadata->>'jobTitle','')) like '%pflegefach%'
        or lower(coalesce(l.notes,'')) like '%pflegefach%'
        or lower(coalesce(l.notes,'')) like '%altenpfleger%'
        or lower(coalesce(l.notes,'')) like '%examiniert%'
      )
      and length(
        coalesce(
          nullif(c.metadata->>'jobPublishedAt',''),
          nullif(left(split_part(coalesce(l.notes,''),' · seit ',2),10),'')
        )
      )=10
      and substr(
        coalesce(
          nullif(c.metadata->>'jobPublishedAt',''),
          nullif(left(split_part(coalesce(l.notes,''),' · seit ',2),10),'')
        ),3,1
      )='.'
      and substr(
        coalesce(
          nullif(c.metadata->>'jobPublishedAt',''),
          nullif(left(split_part(coalesce(l.notes,''),' · seit ',2),10),'')
        ),6,1
      )='.'
      and to_date(
        coalesce(
          nullif(c.metadata->>'jobPublishedAt',''),
          nullif(left(split_part(coalesce(l.notes,''),' · seit ',2),10),'')
        ),
        'DD.MM.YYYY'
      ) <= ((now() at time zone 'Europe/Berlin')::date - 60)
      and lower(c.name) not like '%caritas%'
      and lower(c.name) not like '%arbeiterwohlfahrt%'
      and lower(c.name) not like '%johanniter%'
      and lower(c.name) not like '%diakonie%'
      and lower(c.name) not like '%deutsches rotes kreuz%'
      and lower(c.name) not like '%malteser%'
      and lower(c.name) not like '%lebenshilfe%'
      and lower(c.name) not like '%stiftung%'
      and lower(c.name) not like '%gmbh gemeinnützig%'
      and lower(c.name) not like '%ggmbh%'
      and lower(c.name) not like '% e.v.%'
      and lower(c.name) not like '% e.v'
      and lower(c.name) not like '%verein%'
      and lower(c.name) not like '%zeitarbeit%'
      and lower(c.name) not like '%personalvermittlung%'
      and lower(c.name) not like '%personaldienst%'
      and lower(c.name) not like '%staffing%'
      and (
        coalesce(c.metadata->>'jobWorkload','')=''
        or lower(c.metadata->>'jobWorkload') like '%vollzeit%'
      )
      and lower(coalesce(c.metadata->>'jobWorkload','')) not like '%nur teilzeit%'
      and lower(coalesce(c.metadata->>'jobWorkload','')) not like '%minijob%'
      and lower(coalesce(c.metadata->>'jobWorkload','')) not like '%geringfügig%'
    ), ranked as (
      select *, row_number() over (
        partition by owner
        order by
          case tier when 'A+' then 0 when 'A' then 1 when 'B' then 2 else 3 end,
          score desc,
          job_count desc,
          company asc
      )::int as rn
      from candidates
    )
    insert into sales_outbound_tasks(
      id,workspace,task_date,lead_id,company_id,channel,rank,score,status,payload
    )
    select
      lead_id || ':call:' || ((now() at time zone 'Europe/Berlin')::date)::text,
      $1,
      (now() at time zone 'Europe/Berlin')::date,
      lead_id,
      company_id,
      'call',
      rn,
      score,
      'ready',
      jsonb_build_object(
        'company',company,
        'city',city,
        'website',website,
        'email',email,
        'phone',phone,
        'linkedin',linkedin,
        'jobAdUrl',job_ad_url,
        'tier',tier,
        'reasons',reasons,
        'websiteWeak',website_weak,
        'jobCount',job_count,
        'owner',owner
      )
    from ranked
    where rn <= 50
    on conflict(workspace,task_date,lead_id,channel) do update set
      rank=excluded.rank,
      score=excluded.score,
      payload=excluded.payload,
      updated_at=now()
  `;
}

async function ensureEmergencyVerifiedCallLeads(workspace: string) {
  const seeds = [
    {
      companyId: "manual-sz-siegburg-company",
      contactId: "manual-sz-siegburg-contact",
      leadId: "manual-sz-siegburg-lead",
      company: "Seniorenzentrum Siegburg GmbH",
      website: "https://www.seniorenzentrum-siegburg.de",
      city: "Siegburg",
      phone: "02241 2504-0",
      email: "bewerbung@seniorenzentrum.siegburg.de",
      contact: "",
      sourceId: "seniorenzentrum-siegburg-pflegefachkraft",
      jobUrl: "https://www.seniorenzentrum-siegburg.de/aktuelle-stellenangebote/examinierte-pflegefachkraefte-m-w-d/",
      jobTitle: "Examinierte Pflegefachkraft (M/W/D)",
      workload: "Vollzeit oder Teilzeit",
      publishedAt: "06.07.2026",
      ageDays: 92,
      score: 97,
    },
    {
      companyId: "manual-vilana-company",
      contactId: "manual-vilana-contact",
      leadId: "manual-vilana-lead",
      company: "Vilana Pflegedienst ihres Vertrauens Nadine Plewniok",
      website: "https://www.vilana-pflege.de",
      city: "Oberhausen",
      phone: "0208 88483343",
      email: "info@vilana-pflege.de",
      contact: "Nadine Plewniok",
      sourceId: "vilana-pflegefachkraft",
      jobUrl: "https://www.easyworkclub.com/de/job/pflegefachkraft-m-w-d-ambulante-pflege-in-vollzeit-vilana-pflegedienst-ihres-ver--32b5fe9e-7285-45aa-8bb0-b85fbc216e85/",
      jobTitle: "Pflegefachkraft (m/w/d) – Ambulante Pflege in Vollzeit",
      workload: "Vollzeit",
      publishedAt: "06.08.2026",
      ageDays: 61,
      score: 96,
    },
  ];

  for (const s of seeds) {
    await query(
      `insert into sales_companies(id,workspace,name,domain,website,city,industry,phone,source,source_id,research_status,latest_score,metadata)
       values($1,$2,$3,$4,$5,$6,'Pflege',$7,'manual-verified',$8,'complete',$9,$10::jsonb)
       on conflict(id) do update set
         name=excluded.name,website=excluded.website,city=excluded.city,phone=excluded.phone,
         source=excluded.source,source_id=excluded.source_id,research_status='complete',
         latest_score=excluded.latest_score,metadata=excluded.metadata,updated_at=now()`,
      [
        s.companyId, workspace, s.company, new URL(s.website).hostname.replace(/^www\./,""), s.website,
        s.city, s.phone, s.sourceId, s.score,
        JSON.stringify({
          jobAdUrl: s.jobUrl,
          jobTitle: s.jobTitle,
          jobRole: "Pflegefachkraft",
          jobWorkload: s.workload,
          jobPublishedAt: s.publishedAt,
          jobPublishedAtApprox: true,
          jobAgeDays: s.ageDays,
          sourceVerifiedAt: "2026-10-06",
        }),
      ],
    );

    await query(
      `insert into sales_contacts(id,workspace,company_id,name,email,phone,is_primary,source,metadata)
       values($1,$2,$3,$4,$5,$6,true,'public-website','{}'::jsonb)
       on conflict(id) do update set
         name=excluded.name,email=excluded.email,phone=excluded.phone,is_primary=true,updated_at=now()`,
      [s.contactId, workspace, s.companyId, s.contact, s.email, s.phone],
    );

    await query(
      `insert into sales_leads(id,workspace,company_id,contact_id,stage,status,intent_score,fit_score,opportunity_score,priority_score,owner,notes)
       values($1,$2,$3,$4,'Neu','active',95,90,95,$5,'Raphael',$6)
       on conflict(id) do update set
         contact_id=excluded.contact_id,stage='Neu',status='active',priority_score=excluded.priority_score,
         owner='Raphael',notes=excluded.notes,updated_at=now()`,
      [
        s.leadId, workspace, s.companyId, s.contactId, s.score,
        `Pflegefachkraft · ${s.workload} · Anzeige seit ca. ${s.ageDays >= 90 ? "3 Monaten" : "2 Monaten"} live · Anzeige: ${s.jobUrl}`,
      ],
    );
  }
}

export async function buildDailyOutboundPlan(workspace = "default") {
  await ensureOutboundEngineSchema();
  await ensureEmergencyVerifiedCallLeads(workspace);

  await query(`
    update sales_leads l
       set status='active',
           updated_at=now()
      from sales_companies c
     where l.company_id=c.id
       and l.workspace=$1
       and l.status='archived'
       and l.stage in ('Neu','Research','Bereit','Kontaktiert')
       and coalesce(l.do_not_contact,false)=false
       and coalesce(c.source,'')='pflegedienstjobs24'
       and (
         lower(coalesce(c.metadata->>'jobRole',''))='pflegefachkraft'
         or lower(coalesce(c.metadata->>'jobAdUrl','')) like '%/pflegefachkraft/%'
         or lower(coalesce(c.metadata->>'jobTitle','')) like '%pflegefach%'
         or lower(coalesce(l.notes,'')) like '%pflegefach%'
         or lower(coalesce(l.notes,'')) like '%altenpfleger%'
         or lower(coalesce(l.notes,'')) like '%examiniert%'
       )
       and length(
         coalesce(
           nullif(c.metadata->>'jobPublishedAt',''),
           nullif(left(split_part(coalesce(l.notes,''),' · seit ',2),10),'')
         )
       )=10
       and substr(
         coalesce(
           nullif(c.metadata->>'jobPublishedAt',''),
           nullif(left(split_part(coalesce(l.notes,''),' · seit ',2),10),'')
         ),3,1
       )='.'
       and substr(
         coalesce(
           nullif(c.metadata->>'jobPublishedAt',''),
           nullif(left(split_part(coalesce(l.notes,''),' · seit ',2),10),'')
         ),6,1
       )='.'
       and to_date(
         coalesce(
           nullif(c.metadata->>'jobPublishedAt',''),
           nullif(left(split_part(coalesce(l.notes,''),' · seit ',2),10),'')
         ),
         'DD.MM.YYYY'
       ) <= ((now() at time zone 'Europe/Berlin')::date - 60)
       and lower(c.name) not like '%caritas%'
       and lower(c.name) not like '%arbeiterwohlfahrt%'
       and lower(c.name) not like '%johanniter%'
       and lower(c.name) not like '%diakonie%'
       and lower(c.name) not like '%deutsches rotes kreuz%'
       and lower(c.name) not like '%malteser%'
       and lower(c.name) not like '%lebenshilfe%'
       and lower(c.name) not like '%stiftung%'
       and lower(c.name) not like '%ggmbh%'
       and lower(c.name) not like '% e.v.%'
       and lower(c.name) not like '% e.v'
       and lower(c.name) not like '%verein%'
       and lower(c.name) not like '%zeitarbeit%'
       and lower(c.name) not like '%personalvermittlung%'
       and lower(c.name) not like '%personaldienst%'
       and lower(c.name) not like '%staffing%'
       and (
         coalesce(c.metadata->>'jobWorkload','')=''
         or lower(c.metadata->>'jobWorkload') like '%vollzeit%'
       )
       and lower(coalesce(c.metadata->>'jobWorkload','')) not like '%nur teilzeit%'
       and lower(coalesce(c.metadata->>'jobWorkload','')) not like '%minijob%'
       and lower(coalesce(c.metadata->>'jobWorkload','')) not like '%geringfügig%'
  `, [workspace]);

  await query(`
    delete from sales_outbound_tasks t
    using sales_leads l, sales_companies c
    where t.lead_id=l.id
      and l.company_id=c.id
      and t.workspace=$1
      and t.task_date=(now() at time zone 'Europe/Berlin')::date
      and t.channel='call'
      and t.status in ('ready','drafted','queued')
      and (
        (
          lower(coalesce(c.metadata->>'jobRole',''))<>'pflegefachkraft'
          and lower(coalesce(c.metadata->>'jobAdUrl','')) not like '%/pflegefachkraft/%'
          and lower(coalesce(c.metadata->>'jobTitle','')) not like '%pflegefach%'
          and lower(coalesce(l.notes,'')) not like '%pflegefach%'
          and lower(coalesce(l.notes,'')) not like '%altenpfleger%'
          and lower(coalesce(l.notes,'')) not like '%examiniert%'
        )
        or length(
          coalesce(
            nullif(c.metadata->>'jobPublishedAt',''),
            nullif(left(split_part(coalesce(l.notes,''),' · seit ',2),10),'')
          )
        )<>10
        or substr(
          coalesce(
            nullif(c.metadata->>'jobPublishedAt',''),
            nullif(left(split_part(coalesce(l.notes,''),' · seit ',2),10),'')
          ),3,1
        )<>'.'
        or substr(
          coalesce(
            nullif(c.metadata->>'jobPublishedAt',''),
            nullif(left(split_part(coalesce(l.notes,''),' · seit ',2),10),'')
          ),6,1
        )<>'.'
        or to_date(
          coalesce(
            nullif(c.metadata->>'jobPublishedAt',''),
            nullif(left(split_part(coalesce(l.notes,''),' · seit ',2),10),'')
          ),
          'DD.MM.YYYY'
        ) > ((now() at time zone 'Europe/Berlin')::date - 60)
        or lower(c.name) like '%caritas%'
        or lower(c.name) like '%arbeiterwohlfahrt%'
        or lower(c.name) like '%johanniter%'
        or lower(c.name) like '%diakonie%'
        or lower(c.name) like '%deutsches rotes kreuz%'
        or lower(c.name) like '%malteser%'
        or lower(c.name) like '%lebenshilfe%'
        or lower(c.name) like '%stiftung%'
        or lower(c.name) like '%ggmbh%'
        or lower(c.name) like '% e.v.%'
        or lower(c.name) like '% e.v'
        or lower(c.name) like '%verein%'
        or lower(c.name) like '%zeitarbeit%'
        or lower(c.name) like '%personalvermittlung%'
        or lower(c.name) like '%personaldienst%'
        or lower(c.name) like '%staffing%'
        or (
          coalesce(c.metadata->>'jobWorkload','')<>''
          and lower(c.metadata->>'jobWorkload') not like '%vollzeit%'
        )
        or lower(coalesce(c.metadata->>'jobWorkload','')) like '%nur teilzeit%'
        or lower(coalesce(c.metadata->>'jobWorkload','')) like '%minijob%'
        or lower(coalesce(c.metadata->>'jobWorkload','')) like '%geringfügig%'
      )
  `, [workspace]);

  await query(insertCallChannelSql(), [workspace]);
  await query(insertChannelSql("email", "coalesce(ct.email,'')<>''", OUTBOUND_TARGETS.email), [workspace]);
  await query(insertChannelSql("video", "coalesce(ct.email,'')<>'' and coalesce(c.website,'')<>''", OUTBOUND_TARGETS.video), [workspace]);
  await query(insertChannelSql("linkedin", "coalesce(ct.linkedin,'')<>''", OUTBOUND_TARGETS.linkedin), [workspace]);

  return getOutboundEngineSnapshot(workspace);
}

export async function getOutboundEngineSnapshot(workspace = "default") {
  await ensureOutboundEngineSchema();
  const counts = await query<ChannelCountRow>(`
    select t.channel,
      count(*) filter(where t.status in ('ready','drafted','queued'))::int ready,
      count(*) filter(where t.status in ('done','sent','completed'))::int done,
      count(*)::int total
    from sales_outbound_tasks t
    join sales_leads l on l.id=t.lead_id and l.workspace=t.workspace
    where t.workspace=$1 and t.task_date=(now() at time zone 'Europe/Berlin')::date
      and l.status='active'
    group by t.channel
  `, [workspace]);

  const tasks = await query<TaskRow>(`
    select t.id,t.channel,t.rank,t.status,t.score,t.lead_id,t.company_id,t.payload,t.updated_at
    from sales_outbound_tasks t
    join sales_leads l on l.id=t.lead_id and l.workspace=t.workspace
    where t.workspace=$1 and t.task_date=(now() at time zone 'Europe/Berlin')::date
      and l.status='active'
    order by case t.channel when 'call' then 0 when 'email' then 1 when 'video' then 2 else 3 end, t.rank asc
    limit 320
  `, [workspace]);

  const byChannel = Object.fromEntries((Object.keys(OUTBOUND_TARGETS) as OutboundChannel[]).map((channel) => {
    const row = counts.find((item) => item.channel === channel);
    return [channel, {
      target: OUTBOUND_TARGETS[channel],
      ready: Number(row?.ready || 0),
      done: Number(row?.done || 0),
      total: Number(row?.total || 0),
    }];
  })) as Record<OutboundChannel, { target: number; ready: number; done: number; total: number }>;

  return {
    date: new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date()),
    targets: OUTBOUND_TARGETS,
    channels: byChannel,
    tasks,
    workers: {
      openOutreach: {
        configured: Boolean(process.env.OPENOUTREACH_WORKER_URL),
        url: process.env.OPENOUTREACH_WORKER_URL ? "connected" : "missing",
        source: "eracle/OpenOutreach",
      },
      linkedin: {
        configured: Boolean(process.env.LINKEDIN_AGENT_WORKER_URL),
        autoSend: process.env.LINKEDIN_AGENT_AUTO_SEND === "true",
      },
      video: {
        configured: Boolean(process.env.VIDEO_RENDERER_URL),
      },
    },
  };
}

export async function updateOutboundTask(id: string, status: string, workspace = "default") {
  await ensureOutboundEngineSchema();
  const allowed = new Set(["ready", "drafted", "queued", "sent", "done", "completed", "skipped", "failed"]);
  if (!allowed.has(status)) throw new Error("Ungültiger Task-Status.");
  await query(
    `update sales_outbound_tasks set status=$3,updated_at=now() where id=$1 and workspace=$2`,
    [id, workspace, status],
  );
}

export async function prepareLinkedInDrafts(limit: number = OUTBOUND_TARGETS.linkedin, workspace = "default") {
  await ensureOutboundEngineSchema();
  const safeLimit = Math.max(1, Math.min(50, Math.round(limit)));
  const rows = await query<TaskRow>(`
    select id,channel,rank,status,score,lead_id,company_id,payload,updated_at
    from sales_outbound_tasks
    where workspace=$1
      and task_date=(now() at time zone 'Europe/Berlin')::date
      and channel='linkedin'
      and status in ('ready','drafted')
    order by rank asc
    limit $2
  `, [workspace, safeLimit]);

  for (const row of rows) {
    const company = String(row.payload?.company || "Ihrem Pflegedienst");
    const reasons = Array.isArray(row.payload?.reasons) ? row.payload.reasons.map(String) : [];
    const reason = reasons.find(Boolean) || "bei Ihrem Online-Auftritt ist mir ein konkreter Recruiting-Hebel aufgefallen";
    const message = `Hallo, ich habe mir ${company} kurz angesehen. ${reason}. Ich habe dazu 2 konkrete Ideen vorbereitet – soll ich sie Ihnen kurz schicken?`;
    await query(
      `update sales_outbound_tasks
       set payload=payload || jsonb_build_object('message',$2,'draftedAt',now()::text),status='drafted',updated_at=now()
       where id=$1 and workspace=$3`,
      [row.id, message, workspace],
    );
  }

  return getOutboundEngineSnapshot(workspace);
}

export async function dispatchLinkedInQueue(limit: number = 10, workspace = "default") {
  await ensureOutboundEngineSchema();
  const workerUrl = (process.env.LINKEDIN_AGENT_WORKER_URL || "").replace(/\/$/, "");
  if (!workerUrl) {
    return { ok: false, configured: false, error: "LINKEDIN_AGENT_WORKER_URL fehlt.", dispatched: 0 };
  }

  const safeLimit = Math.max(1, Math.min(30, Math.round(limit)));
  const rows = await query<TaskRow>(`
    select id,channel,rank,status,score,lead_id,company_id,payload,updated_at
    from sales_outbound_tasks
    where workspace=$1
      and task_date=(now() at time zone 'Europe/Berlin')::date
      and channel='linkedin'
      and status='drafted'
      and coalesce(payload->>'linkedin','')<>''
      and coalesce(payload->>'message','')<>''
    order by rank asc
    limit $2
  `, [workspace, safeLimit]);

  if (!rows.length) return { ok: true, configured: true, dispatched: 0, message: "Keine vorbereiteten LinkedIn-Tasks offen." };

  const response = await fetch(`${workerUrl}/v1/actions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(process.env.LINKEDIN_AGENT_WORKER_SECRET ? { authorization: `Bearer ${process.env.LINKEDIN_AGENT_WORKER_SECRET}` } : {}),
    },
    body: JSON.stringify({
      mode: process.env.LINKEDIN_AGENT_AUTO_SEND === "true" ? "send" : "queue",
      actions: rows.map((row) => ({
        taskId: row.id,
        leadId: row.lead_id,
        profileUrl: String(row.payload?.linkedin || ""),
        message: String(row.payload?.message || ""),
      })),
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`LinkedIn Worker ${response.status}: ${body.slice(0, 300)}`);
  }

  for (const row of rows) {
    await query(
      `update sales_outbound_tasks set status='queued',payload=payload || jsonb_build_object('queuedAt',now()::text),updated_at=now() where id=$1 and workspace=$2`,
      [row.id, workspace],
    );
  }
  return { ok: true, configured: true, dispatched: rows.length, autoSend: process.env.LINKEDIN_AGENT_AUTO_SEND === "true" };
}

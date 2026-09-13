import { query } from "./db";
import { ensureSalesOsSchema } from "./sales-os";

export const OUTBOUND_TARGETS = {
  call: 120,
  email: 100,
  video: 120,
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
    l.priority_score score,
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
    and l.last_contact_at is null
    and coalesce(l.do_not_contact,false)=false
`;

function insertChannelSql(channel: OutboundChannel, extraWhere: string, target: number) {
  return `
    with candidates as (
      ${baseCandidateSql}
      and ${extraWhere}
    ), deduped as (
      select *, row_number() over (
        partition by coalesce(nullif(lower(website),''), lower(company)||'|'||lower(city))
        order by score desc,job_count desc,company asc
      ) as company_rn
      from candidates
    ), ranked as (
      select *, row_number() over (
        order by
          case tier when 'A+' then 0 when 'A' then 1 when 'B' then 2 else 3 end,
          score desc,
          job_count desc,
          company asc
      )::int as rn
      from deduped
      where company_rn=1
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
        'tier',tier,
        'reasons',reasons,
        'websiteWeak',website_weak,
        'jobCount',job_count
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

const LOOM_READY_SQL = `
  coalesce(ct.email,'')<>''
  and coalesce(ct.phone,c.phone,'')<>''
  and coalesce(c.website,'')<>''
  and c.metadata->'daily_qualification'->>'tier'='A+'
  and coalesce(c.metadata->'daily_qualification'->>'qualityGatePassed','false')='true'
  and coalesce(c.metadata->'daily_qualification'->>'websiteWeak','false')='true'
  and coalesce(nullif(c.metadata->'daily_qualification'->>'version','')::int,0)>=3
  and coalesce(nullif(c.metadata->'daily_qualification'->'jobGrowth'->>'relevantOpenJobs','')::int,0)>=1
  and (c.metadata->'daily_qualification'->>'checkedAt')::timestamptz >= now() - interval '7 days'
`;

export async function buildDailyOutboundPlan(workspace = "default") {
  await ensureOutboundEngineSchema();

  await query(insertChannelSql("call", "coalesce(ct.phone,c.phone,'')<>''", OUTBOUND_TARGETS.call), [workspace]);
  await query(insertChannelSql("email", "coalesce(ct.email,'')<>''", OUTBOUND_TARGETS.email), [workspace]);
  await query(insertChannelSql("video", LOOM_READY_SQL, OUTBOUND_TARGETS.video), [workspace]);
  await query(insertChannelSql("linkedin", "coalesce(ct.linkedin,'')<>''", OUTBOUND_TARGETS.linkedin), [workspace]);

  return getOutboundEngineSnapshot(workspace);
}

export async function getOutboundEngineSnapshot(workspace = "default") {
  await ensureOutboundEngineSchema();
  const counts = await query<ChannelCountRow>(`
    select channel,
      count(*) filter(where status in ('ready','drafted','queued'))::int ready,
      count(*) filter(where status in ('done','sent','completed'))::int done,
      count(*)::int total
    from sales_outbound_tasks
    where workspace=$1 and task_date=(now() at time zone 'Europe/Berlin')::date
    group by channel
  `, [workspace]);

  const tasks = await query<TaskRow>(`
    select id,channel,rank,status,score,lead_id,company_id,payload,updated_at
    from sales_outbound_tasks
    where workspace=$1 and task_date=(now() at time zone 'Europe/Berlin')::date
    order by case channel when 'call' then 0 when 'email' then 1 when 'video' then 2 else 3 end, rank asc
    limit 500
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
  const rows = await query<{ lead_id: string }>(
    `update sales_outbound_tasks set status=$3,updated_at=now() where id=$1 and workspace=$2 returning lead_id`,
    [id, workspace, status],
  );
  if (rows[0]?.lead_id && ["sent", "done", "completed"].includes(status)) {
    await query(
      `update sales_leads set last_contact_at=coalesce(last_contact_at,now()),updated_at=now() where id=$1 and workspace=$2`,
      [rows[0].lead_id, workspace],
    );
  }
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

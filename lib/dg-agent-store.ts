import { query } from "@/lib/db";

export type AgentStoredMessage = { role: "user" | "assistant"; content: string };
export type AgentActionStatus = "pending_approval" | "approved" | "rejected" | "executed" | "failed";

let ready = false;

export async function ensureDgAgentSchema() {
  if (ready) return;
  await query(`
    create table if not exists dg_agent_threads (
      id uuid primary key,
      workspace text not null default 'default',
      title text not null default 'DG Core',
      status text not null default 'active',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table if not exists dg_agent_messages (
      id bigserial primary key,
      workspace text not null default 'default',
      thread_id uuid not null references dg_agent_threads(id) on delete cascade,
      role text not null,
      content text not null,
      meta jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );
    create index if not exists dg_agent_messages_thread_idx on dg_agent_messages(workspace,thread_id,id desc);
    create table if not exists dg_agent_actions (
      id uuid primary key,
      workspace text not null default 'default',
      thread_id uuid not null references dg_agent_threads(id) on delete cascade,
      tool_name text not null,
      args jsonb not null default '{}'::jsonb,
      risk text not null default 'safe',
      status text not null default 'executed',
      result jsonb,
      error text,
      created_at timestamptz not null default now(),
      executed_at timestamptz,
      expires_at timestamptz
    );
    create index if not exists dg_agent_actions_thread_idx on dg_agent_actions(workspace,thread_id,created_at desc);
    create index if not exists dg_agent_actions_pending_idx on dg_agent_actions(workspace,status,expires_at);
  `);
  ready = true;
}

export async function getOrCreateAgentThread(threadId?: string, workspace = "default") {
  await ensureDgAgentSchema();
  if (threadId) {
    const existing = await query<{ id: string }>("select id from dg_agent_threads where id=$1 and workspace=$2 and status='active' limit 1", [threadId, workspace]);
    if (existing[0]) return existing[0].id;
  }
  const id = crypto.randomUUID();
  await query("insert into dg_agent_threads(id,workspace,title) values($1,$2,'DG Core · Raphael')", [id, workspace]);
  return id;
}

export async function appendAgentMessage(threadId: string, role: "user" | "assistant", content: string, meta: Record<string, unknown> = {}, workspace = "default") {
  await ensureDgAgentSchema();
  await query(
    "insert into dg_agent_messages(workspace,thread_id,role,content,meta) values($1,$2,$3,$4,$5::jsonb)",
    [workspace, threadId, role, content.slice(0, 30_000), JSON.stringify(meta)],
  );
  await query("update dg_agent_threads set updated_at=now() where id=$1 and workspace=$2", [threadId, workspace]);
}

export async function loadAgentHistory(threadId: string, limit = 14, workspace = "default"): Promise<AgentStoredMessage[]> {
  await ensureDgAgentSchema();
  const rows = await query<{ role: string; content: string }>(
    "select role,content from dg_agent_messages where workspace=$1 and thread_id=$2 order by id desc limit $3",
    [workspace, threadId, Math.max(1, Math.min(40, limit))],
  );
  return rows.reverse().flatMap((row) => row.role === "user" || row.role === "assistant" ? [{ role: row.role, content: row.content } as AgentStoredMessage] : []);
}

export async function recordExecutedAgentAction(input: {
  threadId: string;
  toolName: string;
  args: Record<string, unknown>;
  risk?: string;
  result?: unknown;
  error?: string;
}, workspace = "default") {
  await ensureDgAgentSchema();
  const id = crypto.randomUUID();
  await query(
    `insert into dg_agent_actions(id,workspace,thread_id,tool_name,args,risk,status,result,error,executed_at)
     values($1,$2,$3,$4,$5::jsonb,$6,$7,$8::jsonb,$9,now())`,
    [id, workspace, input.threadId, input.toolName, JSON.stringify(input.args), input.risk || "safe", input.error ? "failed" : "executed", input.result === undefined ? null : JSON.stringify(input.result), input.error || null],
  );
  return id;
}

export async function createPendingAgentAction(input: {
  threadId: string;
  toolName: string;
  args: Record<string, unknown>;
  risk: string;
}, workspace = "default") {
  await ensureDgAgentSchema();
  const id = crypto.randomUUID();
  await query(
    `insert into dg_agent_actions(id,workspace,thread_id,tool_name,args,risk,status,expires_at)
     values($1,$2,$3,$4,$5::jsonb,$6,'pending_approval',now()+interval '30 minutes')`,
    [id, workspace, input.threadId, input.toolName, JSON.stringify(input.args), input.risk],
  );
  return id;
}

export async function listPendingAgentActions(threadId: string, workspace = "default") {
  await ensureDgAgentSchema();
  return query<{ id: string; tool_name: string; args: Record<string, unknown>; risk: string; created_at: string; expires_at: string }>(
    `select id,tool_name,args,risk,created_at,expires_at from dg_agent_actions
     where workspace=$1 and thread_id=$2 and status='pending_approval' and expires_at>now()
     order by created_at asc`,
    [workspace, threadId],
  );
}

export async function claimAgentAction(actionId: string, decision: "approve" | "reject", workspace = "default") {
  await ensureDgAgentSchema();
  if (decision === "reject") {
    const rows = await query<{ id: string; tool_name: string; args: Record<string, unknown>; risk: string }>(
      `update dg_agent_actions set status='rejected',executed_at=now()
       where id=$1 and workspace=$2 and status='pending_approval' and expires_at>now()
       returning id,tool_name,args,risk`,
      [actionId, workspace],
    );
    return rows[0] || null;
  }
  const rows = await query<{ id: string; tool_name: string; args: Record<string, unknown>; risk: string }>(
    `update dg_agent_actions set status='approved'
     where id=$1 and workspace=$2 and status='pending_approval' and expires_at>now()
     returning id,tool_name,args,risk`,
    [actionId, workspace],
  );
  return rows[0] || null;
}

export async function finishClaimedAgentAction(actionId: string, result: unknown, error = "", workspace = "default") {
  await ensureDgAgentSchema();
  await query(
    `update dg_agent_actions set status=$3,result=$4::jsonb,error=$5,executed_at=now()
     where id=$1 and workspace=$2 and status='approved'`,
    [actionId, workspace, error ? "failed" : "executed", result === undefined ? null : JSON.stringify(result), error || null],
  );
}

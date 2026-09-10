import { query } from "./db";
import { ensureSalesOsSchema } from "./sales-os";
import { ensureRevenueOpportunitySchema } from "./revenue-opportunities";

export const WEBSITE_PHASES = ["sales", "briefing", "research", "strategy", "design", "build", "assets", "qa", "preview", "sent"] as const;
export type WebsitePhase = (typeof WEBSITE_PHASES)[number];
export type WebsiteProjectStatus = "active" | "paused" | "sent" | "won" | "lost" | "archived";
type JsonObject = Record<string, unknown>;

export type WebsiteProject = {
  id: string; workspace: string; sales_lead_id: string | null; sales_company_id: string | null; opportunity_id: string | null;
  company: string; website_url: string; repo_full_name: string; preview_url: string; status: string; phase: WebsitePhase;
  progress: number; qa_score: number; gates: JsonObject; next_action: string; blocker: string; source: string;
  last_synced_at: string; created_at: string; updated_at: string;
};

let schemaReady = false;
const PROGRESS: Record<WebsitePhase, number> = { sales: 10, briefing: 16, research: 28, strategy: 40, design: 55, build: 72, assets: 78, qa: 88, preview: 96, sent: 100 };
const NEXT: Record<WebsitePhase, string> = {
  sales: "Bedarf bestätigen und Website-Entwurf freigeben lassen",
  briefing: "Fakten, Zielgruppe und Conversion-Ziel sauber festhalten",
  research: "Website, Wettbewerb und Suchintention vollständig analysieren",
  strategy: "Story, Conversion-Pfad und Seitenarchitektur festziehen",
  design: "Art Direction und Signature-Momente ausarbeiten",
  build: "High-End Build umsetzen und alle Funktionen verbinden",
  assets: "Fehlende Bilder, Logos oder Inhalte einsammeln",
  qa: "Visual QA, Conversion QA, Mobile und technische Gates schließen",
  preview: "Preview final prüfen und kundensicher versenden",
  sent: "Feedback nachfassen und Abschluss sichern",
};

function clamp(value: number) { return Math.max(0, Math.min(100, Math.round(value))); }
function phaseOf(value: string): WebsitePhase { return WEBSITE_PHASES.includes(value as WebsitePhase) ? value as WebsitePhase : "briefing"; }
function nextPhase(current: WebsitePhase): WebsitePhase {
  const map: Record<WebsitePhase, WebsitePhase> = { sales: "briefing", briefing: "research", research: "strategy", strategy: "design", design: "build", build: "qa", assets: "qa", qa: "preview", preview: "sent", sent: "sent" };
  return map[current];
}
const selectColumns = `id::text,workspace,sales_lead_id,sales_company_id,opportunity_id,company,website_url,repo_full_name,preview_url,status,phase,progress,qa_score,gates,next_action,blocker,source,last_synced_at,created_at,updated_at`;

export async function ensureWebsiteProjectsSchema() {
  if (schemaReady) return;
  await ensureSalesOsSchema();
  await ensureRevenueOpportunitySchema();
  await query(`
    create table if not exists website_projects (
      id uuid primary key default gen_random_uuid(), workspace text not null default 'default', sales_lead_id text, sales_company_id text,
      opportunity_id text, company text not null, website_url text not null default '', repo_full_name text not null default '', preview_url text not null default '',
      status text not null default 'active', phase text not null default 'briefing', progress integer not null default 0, qa_score integer not null default 0,
      gates jsonb not null default '{}'::jsonb, next_action text not null default '', blocker text not null default '', source text not null default 'cockpit',
      last_synced_at timestamptz not null default now(), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    alter table website_projects add column if not exists workspace text not null default 'default';
    alter table website_projects add column if not exists sales_lead_id text;
    alter table website_projects add column if not exists sales_company_id text;
    alter table website_projects add column if not exists opportunity_id text;
    create index if not exists website_projects_revenue_workspace_idx on website_projects(workspace,status,progress desc,updated_at desc);
    create index if not exists website_projects_sales_lead_idx on website_projects(workspace,sales_lead_id) where sales_lead_id is not null;
  `);
  schemaReady = true;
}

export async function listWebsiteProjects(workspace = "default") {
  await ensureWebsiteProjectsSchema();
  return query<WebsiteProject>(`select ${selectColumns} from website_projects where workspace=$1 and status<>'archived' order by case status when 'active' then 0 when 'paused' then 1 when 'sent' then 2 else 3 end,progress desc,updated_at desc`, [workspace]);
}

export async function createWebsiteProjectFromLead(salesLeadId: string, workspace = "default", source = "call") {
  await ensureWebsiteProjectsSchema();
  const [lead] = await query<{ lead_id: string; company_id: string; company: string; website: string; opportunity_id: string | null }>(`
    select l.id lead_id,c.id company_id,c.name company,c.website,
      (select o.id from sales_opportunities o where o.workspace=l.workspace and o.lead_id=l.id and o.product_key='website' order by case when o.status='open' then 0 else 1 end,o.updated_at desc limit 1) opportunity_id
    from sales_leads l join sales_companies c on c.id=l.company_id and c.workspace=l.workspace where l.workspace=$1 and l.id=$2 limit 1
  `, [workspace, salesLeadId]);
  if (!lead) throw new Error("Lead für Website-Projekt nicht gefunden.");

  const [existing] = await query<WebsiteProject>(`select ${selectColumns} from website_projects where workspace=$1 and sales_lead_id=$2 and status not in ('archived','lost') order by updated_at desc limit 1`, [workspace, salesLeadId]);
  if (existing) {
    await query(`update website_projects set status=case when status='paused' then 'active' else status end,opportunity_id=coalesce(opportunity_id,$3),last_synced_at=now(),updated_at=now() where id=$1::uuid and workspace=$2`, [existing.id, workspace, lead.opportunity_id]);
    return (await listWebsiteProjects(workspace)).find((item) => item.id === existing.id) || existing;
  }

  const [created] = await query<WebsiteProject>(`
    insert into website_projects(workspace,sales_lead_id,sales_company_id,opportunity_id,company,website_url,status,phase,progress,gates,next_action,source)
    values($1,$2,$3,$4,$5,$6,'active','briefing',$7,jsonb_build_object('briefing',false,'research',false,'strategy',false,'design',false,'build',false,'qa',false,'preview',false,'sent',false),$8,$9)
    returning ${selectColumns}
  `, [workspace, lead.lead_id, lead.company_id, lead.opportunity_id, lead.company, lead.website || "", PROGRESS.briefing, NEXT.briefing, source]);
  return created;
}

export async function createManualWebsiteProject(input: { company: string; websiteUrl?: string; repoFullName?: string; previewUrl?: string; phase?: WebsitePhase; nextAction?: string }, workspace = "default") {
  await ensureWebsiteProjectsSchema();
  const phase = input.phase || "briefing";
  const [created] = await query<WebsiteProject>(`
    insert into website_projects(workspace,company,website_url,repo_full_name,preview_url,status,phase,progress,gates,next_action,source)
    values($1,$2,$3,$4,$5,'active',$6,$7,'{}'::jsonb,$8,'manual') returning ${selectColumns}
  `, [workspace, input.company, input.websiteUrl || "", input.repoFullName || "", input.previewUrl || "", phase, PROGRESS[phase], input.nextAction || NEXT[phase]]);
  return created;
}

export async function updateWebsiteProject(id: string, patch: { status?: WebsiteProjectStatus; phase?: WebsitePhase; progress?: number; qaScore?: number; gates?: JsonObject; nextAction?: string; blocker?: string; repoFullName?: string; previewUrl?: string; websiteUrl?: string }, workspace = "default") {
  const current = (await listWebsiteProjects(workspace)).find((item) => item.id === id);
  if (!current) throw new Error("Website-Projekt nicht gefunden.");
  const phase = patch.phase || phaseOf(current.phase);
  const status = patch.status || (phase === "sent" ? "sent" : current.status);
  const [updated] = await query<WebsiteProject>(`
    update website_projects set status=$3,phase=$4,progress=$5,qa_score=$6,gates=$7::jsonb,next_action=$8,blocker=$9,repo_full_name=$10,preview_url=$11,website_url=$12,last_synced_at=now(),updated_at=now()
    where id=$1::uuid and workspace=$2 returning ${selectColumns}
  `, [id, workspace, status, phase, clamp(patch.progress ?? current.progress), clamp(patch.qaScore ?? current.qa_score), JSON.stringify(patch.gates ?? current.gates ?? {}), patch.nextAction ?? current.next_action, patch.blocker ?? current.blocker, patch.repoFullName ?? current.repo_full_name, patch.previewUrl ?? current.preview_url, patch.websiteUrl ?? current.website_url]);
  return updated;
}

export async function advanceWebsiteProject(id: string, workspace = "default") {
  const current = (await listWebsiteProjects(workspace)).find((item) => item.id === id);
  if (!current) throw new Error("Website-Projekt nicht gefunden.");
  const phase = phaseOf(current.phase);
  const next = nextPhase(phase);
  const gates = { ...(current.gates || {}) } as Record<string, unknown>;
  if (phase !== "sales") gates[phase] = true;
  if (next === "sent") { gates.preview = true; gates.sent = true; }
  return updateWebsiteProject(id, { phase: next, progress: PROGRESS[next], status: next === "sent" ? "sent" : "active", gates, blocker: next === "qa" ? "" : current.blocker, nextAction: NEXT[next] }, workspace);
}

import { z } from "zod";
import { query } from "@/lib/db";
import { secretStatus } from "@/lib/secrets";
import { getSalesOverview, ensureSalesOsSchema } from "@/lib/sales-os";
import { runWebsiteAudit } from "@/lib/website-audit";
import { runLeadFactoryCycle } from "@/lib/daily-lead-factory";
import {
  buildDailyOutboundPlan,
  dispatchLinkedInQueue,
  getOutboundEngineSnapshot,
  prepareLinkedInDrafts,
  updateOutboundTask,
} from "@/lib/outbound-engine";
import { createWebsiteProjectFromLead, listWebsiteProjects } from "@/lib/website-projects";
import type { DgAgentToolDefinition } from "@/lib/dg-agent-provider";

export type DgAgentRisk = "safe" | "internal_write" | "external_action";

type ToolSpec = {
  definition: DgAgentToolDefinition;
  risk: DgAgentRisk;
  schema: { parse: (value: unknown) => Record<string, unknown> };
  run: (args: Record<string, unknown>, workspace: string) => Promise<unknown>;
};

const tool = (
  name: string,
  description: string,
  parameters: Record<string, unknown>,
  risk: DgAgentRisk,
  schema: { parse: (value: unknown) => Record<string, unknown> },
  run: ToolSpec["run"],
): ToolSpec => ({ definition: { type: "function", function: { name, description, parameters } }, risk, schema, run });

const noArgs = z.object({}).strict();

const TOOLS: ToolSpec[] = [
  tool(
    "get_system_snapshot",
    "Liest den aktuellen Sales-OS- und Outbound-Status sowie nur den Konfigurationsstatus von Integrationen. Gibt niemals Secrets aus.",
    { type: "object", properties: {}, additionalProperties: false },
    "safe",
    noArgs,
    async (_args, workspace) => {
      const [sales, outbound, secrets] = await Promise.all([getSalesOverview(workspace), getOutboundEngineSnapshot(workspace), secretStatus()]);
      const configured = new Set(secrets.map((item) => item.key));
      return {
        sales,
        outbound,
        integrations: {
          experiential: configured.has("experiential_api_key") || Boolean(process.env.EXPLABS_API_KEY || process.env.EXPERIENTIAL_API_KEY),
          groq: configured.has("groq_api_key") || Boolean(process.env.GROQ_API_KEY),
          googleOAuth: configured.has("google_client_id") && configured.has("google_client_secret"),
          microsoftOAuth: configured.has("microsoft_client_id") && configured.has("microsoft_client_secret"),
        },
      };
    },
  ),
  tool(
    "search_leads",
    "Sucht echte Leads im Sales OS nach Firma/Stadt/Branche und optional Mindest-Priority. Nur lesen.",
    {
      type: "object",
      properties: {
        query: { type: "string", description: "Firma, Stadt oder Branche" },
        min_priority: { type: "number", minimum: 0, maximum: 100 },
        stage: { type: "string" },
        limit: { type: "number", minimum: 1, maximum: 30 },
      },
      additionalProperties: false,
    },
    "safe",
    z.object({ query: z.string().max(200).optional(), min_priority: z.number().min(0).max(100).optional(), stage: z.string().max(60).optional(), limit: z.number().int().min(1).max(30).optional() }).strict(),
    async (raw, workspace) => {
      await ensureSalesOsSchema();
      const args = raw as { query?: string; min_priority?: number; stage?: string; limit?: number };
      const needle = `%${(args.query || "").trim()}%`;
      return query(
        `select l.id,c.name as company,c.city,c.industry,c.website,coalesce(ct.name,'') as contact,
                coalesce(ct.email,'') as email,coalesce(ct.phone,c.phone,'') as phone,l.stage,l.status,
                l.priority_score,l.fit_score,l.opportunity_score,l.intent_score,l.owner,l.notes,l.updated_at
         from sales_leads l join sales_companies c on c.id=l.company_id
         left join sales_contacts ct on ct.id=l.contact_id
         where l.workspace=$1 and l.status='active'
           and ($2='' or c.name ilike $3 or c.city ilike $3 or c.industry ilike $3)
           and l.priority_score >= $4
           and ($5='' or lower(l.stage)=lower($5))
         order by l.priority_score desc,l.updated_at desc limit $6`,
        [workspace, (args.query || "").trim(), needle, args.min_priority || 0, (args.stage || "").trim(), args.limit || 12],
      );
    },
  ),
  tool(
    "get_lead",
    "Lädt einen Lead mit Firma, Kontakt, letztem Research und den letzten CRM-Aktivitäten. Nur lesen.",
    { type: "object", properties: { lead_id: { type: "string" } }, required: ["lead_id"], additionalProperties: false },
    "safe",
    z.object({ lead_id: z.string().min(3).max(200) }).strict(),
    async (raw, workspace) => {
      await ensureSalesOsSchema();
      const { lead_id } = raw as { lead_id: string };
      const leads = await query(
        `select l.*,c.name as company,c.city,c.industry,c.website,c.domain,c.phone as company_phone,c.metadata as company_metadata,
                coalesce(ct.name,'') as contact_name,coalesce(ct.email,'') as email,coalesce(ct.phone,'') as phone,
                coalesce(ct.linkedin,'') as linkedin,coalesce(ct.instagram,'') as instagram
         from sales_leads l join sales_companies c on c.id=l.company_id left join sales_contacts ct on ct.id=l.contact_id
         where l.workspace=$1 and l.id=$2 limit 1`,
        [workspace, lead_id],
      );
      if (!leads[0]) return { found: false };
      const companyId = String((leads[0] as { company_id?: unknown }).company_id || "");
      const [research, activities] = await Promise.all([
        query(`select website_score,contact_score,fit_score,opportunity_score,priority_score,signals,audit,summary,created_at from sales_research_runs where workspace=$1 and company_id=$2 order by created_at desc limit 1`, [workspace, companyId]),
        query(`select type,summary,meta,created_at from sales_activities where workspace=$1 and lead_id=$2 order by created_at desc limit 15`, [workspace, lead_id]),
      ]);
      return { found: true, lead: leads[0], latestResearch: research[0] || null, activities };
    },
  ),
  tool(
    "audit_website",
    "Führt die echte Website-Analyse des Tools aus. Nutze die echte URL; erfinde keine Befunde.",
    {
      type: "object",
      properties: { url: { type: "string" }, company: { type: "string" } },
      required: ["url"],
      additionalProperties: false,
    },
    "safe",
    z.object({ url: z.string().url().max(2000), company: z.string().max(300).optional() }).strict(),
    async (raw) => {
      const args = raw as { url: string; company?: string };
      return runWebsiteAudit(args.url, args.company || "");
    },
  ),
  tool(
    "list_website_projects",
    "Listet echte Website-Projekte mit Phase, Fortschritt, QA-Score, Blocker und nächster Aktion. Nur lesen.",
    { type: "object", properties: {}, additionalProperties: false },
    "safe",
    noArgs,
    async (_args, workspace) => listWebsiteProjects(workspace),
  ),
  tool(
    "create_website_project_from_lead",
    "Legt für einen bestehenden Lead ein internes Website-Projekt an oder öffnet das vorhandene. Baut oder deployed noch nichts.",
    { type: "object", properties: { lead_id: { type: "string" } }, required: ["lead_id"], additionalProperties: false },
    "internal_write",
    z.object({ lead_id: z.string().min(3).max(200) }).strict(),
    async (raw, workspace) => createWebsiteProjectFromLead(String((raw as { lead_id: string }).lead_id), workspace, "dg-agent"),
  ),
  tool(
    "build_daily_outbound_plan",
    "Baut/aktualisiert den internen Tagesplan. Das erstellt interne Tasks, versendet aber nichts.",
    { type: "object", properties: {}, additionalProperties: false },
    "internal_write",
    noArgs,
    async (_args, workspace) => buildDailyOutboundPlan(workspace),
  ),
  tool(
    "run_lead_factory",
    "Findet und qualifiziert Pflege-Leads mit den echten Discovery-, Hiring- und Website-Audit-Prozessen. Kein Versand.",
    { type: "object", properties: { batch_size: { type: "number", minimum: 1, maximum: 5 } }, additionalProperties: false },
    "internal_write",
    z.object({ batch_size: z.number().int().min(1).max(5).optional() }).strict(),
    async (raw) => runLeadFactoryCycle(Number((raw as { batch_size?: number }).batch_size || 5)),
  ),
  tool(
    "update_lead",
    "Ändert Stage, Owner oder Notizen eines bestehenden Leads. Keine Kontaktaufnahme.",
    {
      type: "object",
      properties: { lead_id: { type: "string" }, stage: { type: "string" }, owner: { type: "string" }, notes: { type: "string" } },
      required: ["lead_id"], additionalProperties: false,
    },
    "internal_write",
    z.object({ lead_id: z.string().min(3).max(200), stage: z.string().max(80).optional(), owner: z.string().max(120).optional(), notes: z.string().max(5000).optional() }).strict(),
    async (raw, workspace) => {
      const args = raw as { lead_id: string; stage?: string; owner?: string; notes?: string };
      const rows = await query<{ id: string; stage: string }>(
        `update sales_leads set stage=coalesce($3,stage),owner=coalesce($4,owner),notes=coalesce($5,notes),updated_at=now()
         where id=$1 and workspace=$2 returning id,stage`,
        [args.lead_id, workspace, args.stage ?? null, args.owner ?? null, args.notes ?? null],
      );
      // Mirrors the same stop-outbound-on-close logic as the CRM's PATCH handler
      // (app/api/crm/launch/route.ts) - without this, DG Core closing a lead here
      // would leave already-queued outbound sequence steps to go out anyway.
      if (rows[0] && (rows[0].stage === "Gewonnen" || rows[0].stage === "Verloren")) {
        await query("update er_outbox set status='stopped' where workspace=$2 and lead_id=$1 and status='queued'", [args.lead_id, workspace]);
      }
      return { updated: Boolean(rows[0]), leadId: args.lead_id };
    },
  ),
  tool(
    "add_activity_note",
    "Schreibt eine CRM-Notiz/Aktivität zu einem Lead. Keine Kontaktaufnahme.",
    {
      type: "object",
      properties: { lead_id: { type: "string" }, summary: { type: "string" } },
      required: ["lead_id", "summary"], additionalProperties: false,
    },
    "internal_write",
    z.object({ lead_id: z.string().min(3).max(200), summary: z.string().min(1).max(3000) }).strict(),
    async (raw, workspace) => {
      const args = raw as { lead_id: string; summary: string };
      const rows = await query<{ company_id: string }>("select company_id from sales_leads where id=$1 and workspace=$2 limit 1", [args.lead_id, workspace]);
      if (!rows[0]) throw new Error("Lead nicht gefunden.");
      await query(
        `insert into sales_activities(workspace,lead_id,company_id,type,summary,meta) values($1,$2,$3,'agent.note',$4,'{}'::jsonb)`,
        [workspace, args.lead_id, rows[0].company_id, args.summary],
      );
      return { created: true };
    },
  ),
  tool(
    "prepare_linkedin_drafts",
    "Erstellt nur LinkedIn-Drafts/Queue-Einträge zur Prüfung. Sendet nicht.",
    { type: "object", properties: { limit: { type: "number", minimum: 1, maximum: 50 } }, additionalProperties: false },
    "internal_write",
    z.object({ limit: z.number().int().min(1).max(50).optional() }).strict(),
    async (raw, workspace) => prepareLinkedInDrafts(Number((raw as { limit?: number }).limit || 10), workspace),
  ),
  tool(
    "set_outbound_task_status",
    "Ändert nur den internen Status eines Outbound-Tasks.",
    {
      type: "object",
      properties: { task_id: { type: "string" }, status: { type: "string" } },
      required: ["task_id", "status"], additionalProperties: false,
    },
    "internal_write",
    z.object({ task_id: z.string().min(3).max(200), status: z.string().min(2).max(30) }).strict(),
    async (raw, workspace) => {
      const args = raw as { task_id: string; status: string };
      await updateOutboundTask(args.task_id, args.status, workspace);
      return getOutboundEngineSnapshot(workspace);
    },
  ),
  tool(
    "dispatch_linkedin_queue",
    "Führt tatsächlich vorbereitete LinkedIn-Aktionen über den konfigurierten Worker aus. Externe Aktion: benötigt Raphaels Freigabe.",
    { type: "object", properties: { limit: { type: "number", minimum: 1, maximum: 30 } }, additionalProperties: false },
    "external_action",
    z.object({ limit: z.number().int().min(1).max(30).optional() }).strict(),
    async (raw, workspace) => dispatchLinkedInQueue(Number((raw as { limit?: number }).limit || 5), workspace),
  ),
];

const BY_NAME = new Map(TOOLS.map((item) => [item.definition.function.name, item]));

export const DG_AGENT_TOOL_DEFINITIONS = TOOLS.map((item) => item.definition);

export function dgAgentToolRisk(name: string): DgAgentRisk | null {
  return BY_NAME.get(name)?.risk || null;
}

export function dgAgentToolNeedsApproval(name: string) {
  return dgAgentToolRisk(name) === "external_action";
}

export function validateDgAgentToolArgs(name: string, args: unknown) {
  const spec = BY_NAME.get(name);
  if (!spec) throw new Error(`Unbekanntes Tool: ${name}`);
  return spec.schema.parse(args);
}

export async function executeDgAgentTool(name: string, args: Record<string, unknown>, workspace = "default") {
  const spec = BY_NAME.get(name);
  if (!spec) throw new Error(`Unbekanntes Tool: ${name}`);
  const parsed = spec.schema.parse(args);
  return spec.run(parsed, workspace);
}

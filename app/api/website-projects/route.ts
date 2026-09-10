import { z } from "zod";
import {
  WEBSITE_PHASES,
  advanceWebsiteProject,
  createManualWebsiteProject,
  createWebsiteProjectFromLead,
  listWebsiteProjects,
  updateWebsiteProject,
} from "@/lib/website-projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const phaseSchema = z.enum(WEBSITE_PHASES);
const statusSchema = z.enum(["active", "paused", "sent", "won", "lost", "archived"]);
const createSchema = z.union([
  z.object({ salesLeadId: z.string().min(1), source: z.string().max(80).optional() }),
  z.object({ company: z.string().min(2).max(300), websiteUrl: z.string().max(1000).optional(), repoFullName: z.string().max(300).optional(), previewUrl: z.string().max(1000).optional(), phase: phaseSchema.optional(), nextAction: z.string().max(1200).optional() }),
]);
const patchSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(["advance", "pause", "resume"]).optional(),
  status: statusSchema.optional(), phase: phaseSchema.optional(), progress: z.number().int().min(0).max(100).optional(), qaScore: z.number().int().min(0).max(100).optional(),
  gates: z.record(z.string(), z.unknown()).optional(), nextAction: z.string().max(1200).optional(), blocker: z.string().max(1200).optional(), repoFullName: z.string().max(300).optional(), previewUrl: z.string().max(1000).optional(), websiteUrl: z.string().max(1000).optional(),
});

function workspaceOf(request: Request) { return new URL(request.url).searchParams.get("workspace") || "default"; }

export async function GET(request: Request) {
  try { return Response.json({ projects: await listWebsiteProjects(workspaceOf(request)) }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Website-Projekte konnten nicht geladen werden." }, { status: 503 }); }
}

export async function POST(request: Request) {
  try {
    const workspace = workspaceOf(request);
    const input = createSchema.parse(await request.json());
    const project = "salesLeadId" in input
      ? await createWebsiteProjectFromLead(input.salesLeadId, workspace, input.source || "call")
      : await createManualWebsiteProject(input, workspace);
    return Response.json({ ok: true, project, projects: await listWebsiteProjects(workspace) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Website-Projekt konnte nicht angelegt werden." }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    const workspace = workspaceOf(request);
    const input = patchSchema.parse(await request.json());
    const { id, action, ...patch } = input;
    const project = action === "advance" ? await advanceWebsiteProject(id, workspace)
      : action === "pause" ? await updateWebsiteProject(id, { status: "paused" }, workspace)
      : action === "resume" ? await updateWebsiteProject(id, { status: "active" }, workspace)
      : await updateWebsiteProject(id, patch, workspace);
    return Response.json({ ok: true, project, projects: await listWebsiteProjects(workspace) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Website-Projekt konnte nicht aktualisiert werden." }, { status: 400 });
  }
}

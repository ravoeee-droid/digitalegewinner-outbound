import { z } from "zod";
import {
  PRODUCT_CATALOG,
  REVENUE_STAGES,
  addProductOpportunity,
  getRevenueSnapshot,
  seedRevenueOpportunities,
  updateRevenueOpportunity,
  type ProductKey,
  type OpportunityPatch,
} from "@/lib/revenue-opportunities";
import {
  refreshDeepWebsiteSalesIntelligence,
  refreshStoredWebsiteSalesIntelligence,
} from "@/lib/website-sales-intelligence";

export const runtime = "nodejs";
export const maxDuration = 60;

const stageSchema = z.enum(REVENUE_STAGES);
const productSchema = z.enum(Object.keys(PRODUCT_CATALOG) as [ProductKey, ...ProductKey[]]);

const patchSchema = z.object({
  id: z.string().min(3),
  stage: stageSchema.optional(),
  setupValue: z.number().min(0).max(10_000_000).optional(),
  monthlyValue: z.number().min(0).max(1_000_000).optional(),
  probability: z.number().int().min(0).max(100).optional(),
  nextAction: z.string().max(600).optional(),
  nextActionAt: z.string().max(120).nullable().optional(),
  notes: z.string().max(12000).optional(),
  outcome: z.enum(["Nicht erreicht", "Erreicht", "Interesse", "Termin", "Angebot", "Gewonnen", "Verloren"]).optional(),
});

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("refresh") }),
  z.object({ action: z.literal("add-product"), leadId: z.string().min(3), productKey: productSchema }),
]);

function workspaceOf(request: Request) {
  return new URL(request.url).searchParams.get("workspace") || "default";
}

export async function GET(request: Request) {
  try {
    const workspace = workspaceOf(request);
    await refreshStoredWebsiteSalesIntelligence(workspace);
    await seedRevenueOpportunities(workspace);
    return Response.json(await getRevenueSnapshot(workspace));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Revenue Pipeline konnte nicht geladen werden." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const workspace = workspaceOf(request);
    const input = actionSchema.parse(await request.json());
    if (input.action === "refresh") {
      await refreshStoredWebsiteSalesIntelligence(workspace);
      await refreshDeepWebsiteSalesIntelligence(workspace, 10);
      await seedRevenueOpportunities(workspace);
      return Response.json(await getRevenueSnapshot(workspace));
    }
    return Response.json(await addProductOpportunity(input.leadId, input.productKey, workspace));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Opportunity-Aktion fehlgeschlagen." }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    const workspace = workspaceOf(request);
    const input = patchSchema.parse(await request.json());
    const { id, ...patch } = input;
    return Response.json(await updateRevenueOpportunity(id, patch as OpportunityPatch, workspace));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Opportunity konnte nicht gespeichert werden." }, { status: 400 });
  }
}

import {z} from "zod";
import {getRevenueAttributionDashboard,recordManualAttributionFact,syncRevenueAttribution} from "@/lib/outbound-revenue-attribution";
export const runtime="nodejs"; export const maxDuration=60;
const manual=z.object({action:z.literal("record"),factType:z.enum(["meeting_booked","meeting_held","won","lost","revenue"]),leadId:z.string().min(1),opportunityId:z.string().optional().nullable(),amount:z.number().nonnegative().optional().nullable(),currency:z.string().length(3).default("EUR"),occurredAt:z.coerce.date().optional(),note:z.string().max(2000).optional().default("")});
const action=z.union([z.object({action:z.literal("sync")}),manual]);
export async function GET(){try{return Response.json({ok:true,...await getRevenueAttributionDashboard()})}catch(e){return Response.json({ok:false,error:e instanceof Error?e.message:"Revenue Dashboard konnte nicht geladen werden."},{status:503})}}
export async function POST(r:Request){try{const i=action.parse(await r.json());if(i.action==="sync")return Response.json({ok:true,result:await syncRevenueAttribution()});return Response.json({ok:true,result:await recordManualAttributionFact(i,"admin-session")})}catch(e){return Response.json({ok:false,error:e instanceof Error?e.message:"Revenue-Aktion fehlgeschlagen."},{status:400})}}

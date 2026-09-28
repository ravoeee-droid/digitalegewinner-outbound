import {z} from "zod";
import {getOptimizationDashboard,reviewOptimizationPolicy,reviewOptimizationProposal,runOptimizationCycle} from "@/lib/outbound-optimization";
export const runtime="nodejs";export const maxDuration=60;
const schema=z.discriminatedUnion("action",[
 z.object({action:z.literal("cycle")}),
 z.object({action:z.literal("policy"),policyId:z.string().uuid(),policyAction:z.enum(["approve","activate","pause","retire"]),reason:z.string().min(3).max(2000)}),
 z.object({action:z.literal("proposal"),proposalId:z.string().uuid(),proposalAction:z.enum(["approve","reject","execute"]),reason:z.string().min(3).max(2000)})
]);
export async function GET(){try{return Response.json({ok:true,...await getOptimizationDashboard()})}catch(e){return Response.json({ok:false,error:e instanceof Error?e.message:"Optimization Dashboard konnte nicht geladen werden."},{status:503})}}
export async function POST(r:Request){try{const i=schema.parse(await r.json());if(i.action==="cycle")return Response.json({ok:true,result:await runOptimizationCycle()});if(i.action==="policy")return Response.json({ok:true,result:await reviewOptimizationPolicy({policyId:i.policyId,action:i.policyAction,reason:i.reason},"admin-session")});return Response.json({ok:true,result:await reviewOptimizationProposal({proposalId:i.proposalId,action:i.proposalAction,reason:i.reason},"admin-session")})}catch(e){return Response.json({ok:false,error:e instanceof Error?e.message:"Optimization-Aktion fehlgeschlagen."},{status:400})}}

import { z } from "zod";
import {
  enqueueCompanyResearch,
  getResearchDashboard,
  processResearchQueue,
  reviewStrategyHypothesis,
  seedResearchQueue,
} from "@/lib/outbound-research-strategy";

export const runtime="nodejs";
export const maxDuration=60;

const actionSchema=z.discriminatedUnion("action",[
  z.object({action:z.literal("seed")}),
  z.object({action:z.literal("process")}),
  z.object({action:z.literal("queue"),companyId:z.string().min(1),leadId:z.string().min(1).optional().nullable()}),
  z.object({action:z.literal("review"),hypothesisId:z.string().uuid(),decision:z.enum(["approved","rejected"]),reason:z.string().min(3).max(2000)}),
]);

export async function GET(){
  try{return Response.json({ok:true,...await getResearchDashboard()})}
  catch(error){return Response.json({ok:false,error:error instanceof Error?error.message:"Research Dashboard konnte nicht geladen werden."},{status:503})}
}
export async function POST(request:Request){
  try{
    const input=actionSchema.parse(await request.json());
    if(input.action==="seed")return Response.json({ok:true,result:await seedResearchQueue(20)});
    if(input.action==="process")return Response.json({ok:true,result:await processResearchQueue(4)});
    if(input.action==="queue")return Response.json({ok:true,result:await enqueueCompanyResearch({companyId:input.companyId,leadId:input.leadId})});
    return Response.json({ok:true,result:await reviewStrategyHypothesis(input,"admin-session")});
  }catch(error){
    return Response.json({ok:false,error:error instanceof Error?error.message:"Research-Aktion fehlgeschlagen."},{status:400});
  }
}

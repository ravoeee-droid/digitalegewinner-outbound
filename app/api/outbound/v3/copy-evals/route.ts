import { z } from "zod";
import {
  createCopyCandidate,
  getCopyEvalDashboard,
  reviewCopyCandidate,
  runCriticRegression,
} from "@/lib/outbound-copy-evals";

export const runtime="nodejs";
export const maxDuration=60;

const actionSchema=z.discriminatedUnion("action",[
  z.object({action:z.literal("generate"),hypothesisId:z.string().uuid()}),
  z.object({action:z.literal("review"),candidateId:z.string().uuid(),decision:z.enum(["approved","rejected"]),reason:z.string().min(3).max(2000)}),
  z.object({action:z.literal("eval")}),
]);

export async function GET(){
  try{return Response.json({ok:true,...await getCopyEvalDashboard()})}
  catch(error){return Response.json({ok:false,error:error instanceof Error?error.message:"Copy/Eval Dashboard konnte nicht geladen werden."},{status:503})}
}
export async function POST(request:Request){
  try{
    const input=actionSchema.parse(await request.json());
    if(input.action==="generate")return Response.json({ok:true,result:await createCopyCandidate(input.hypothesisId)});
    if(input.action==="review")return Response.json({ok:true,result:await reviewCopyCandidate(input,"admin-session")});
    return Response.json({ok:true,result:await runCriticRegression("admin-session")});
  }catch(error){
    return Response.json({ok:false,error:error instanceof Error?error.message:"Copy/Eval-Aktion fehlgeschlagen."},{status:400});
  }
}

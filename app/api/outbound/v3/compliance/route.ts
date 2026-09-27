import { z } from "zod";
import {
  decidePermissionReview,
  getComplianceDashboard,
  permissionReviewDecisionSchema,
  permissionReviewRequestSchema,
  requestPermissionReview,
  createComplianceSuppression,
  suppressionRequestSchema,
} from "@/lib/outbound-compliance-engine";

export const runtime="nodejs";

const actionSchema=z.discriminatedUnion("action",[
  z.object({action:z.literal("request_review"),payload:permissionReviewRequestSchema}),
  z.object({action:z.literal("decide_review"),payload:permissionReviewDecisionSchema}),
  z.object({action:z.literal("suppress"),payload:suppressionRequestSchema}),
]);

export async function GET(){
  try{
    return Response.json({ok:true,...await getComplianceDashboard("default")});
  }catch(error){
    return Response.json({
      ok:false,
      error:error instanceof Error?error.message:"Compliance Dashboard konnte nicht geladen werden.",
    },{status:503});
  }
}

export async function POST(request:Request){
  try{
    const input=actionSchema.parse(await request.json());
    if(input.action==="request_review"){
      return Response.json({ok:true,result:await requestPermissionReview(input.payload,"admin-session","default")});
    }
    if(input.action==="decide_review"){
      return Response.json({ok:true,result:await decidePermissionReview(input.payload,"admin-session","default")});
    }
    return Response.json({
      ok:true,
      result:await createComplianceSuppression({...input.payload,actorId:"admin-session",workspace:"default"}),
    });
  }catch(error){
    return Response.json({
      ok:false,
      error:error instanceof Error?error.message:"Compliance-Aktion fehlgeschlagen.",
    },{status:400});
  }
}

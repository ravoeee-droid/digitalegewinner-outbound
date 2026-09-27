import { z } from "zod";
import {
  evaluateExperiment,
  evaluateRunningExperiments,
  getExperimentDashboard,
  setExperimentStatus,
} from "@/lib/outbound-experiment-engine";

export const runtime="nodejs";
export const maxDuration=60;

const actionSchema=z.discriminatedUnion("action",[
  z.object({action:z.literal("evaluate_all")}),
  z.object({action:z.literal("evaluate"),experimentId:z.string().uuid()}),
  z.object({
    action:z.literal("status"),
    experimentId:z.string().uuid(),
    statusAction:z.enum(["pause","resume","complete"]),
    reason:z.string().min(3).max(2000),
  }),
]);

export async function GET(){
  try{
    return Response.json({ok:true,...await getExperimentDashboard("default")});
  }catch(error){
    return Response.json({
      ok:false,
      error:error instanceof Error?error.message:"Experiment Dashboard konnte nicht geladen werden.",
    },{status:503});
  }
}

export async function POST(request:Request){
  try{
    const input=actionSchema.parse(await request.json());
    if(input.action==="evaluate_all"){
      return Response.json({ok:true,result:await evaluateRunningExperiments(20,"default")});
    }
    if(input.action==="evaluate"){
      return Response.json({ok:true,result:await evaluateExperiment(input.experimentId,"default")});
    }
    return Response.json({
      ok:true,
      result:await setExperimentStatus({
        experimentId:input.experimentId,
        action:input.statusAction,
        reason:input.reason,
        actorId:"admin-session",
        workspace:"default",
      }),
    });
  }catch(error){
    return Response.json({
      ok:false,
      error:error instanceof Error?error.message:"Experiment-Aktion fehlgeschlagen.",
    },{status:400});
  }
}

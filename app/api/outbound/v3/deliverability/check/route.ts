import { runDeliverabilityHealthCheck } from "@/lib/outbound-deliverability";

export const runtime="nodejs";
export const maxDuration=60;

export async function POST(){
  try{
    return Response.json({ok:true,...await runDeliverabilityHealthCheck("default")});
  }catch(error){
    return Response.json({
      ok:false,
      error:error instanceof Error?error.message:"Deliverability health check failed.",
    },{status:503});
  }
}

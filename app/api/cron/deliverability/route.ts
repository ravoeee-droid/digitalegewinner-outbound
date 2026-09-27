import { runDeliverabilityHealthCheck } from "@/lib/outbound-deliverability";
import { resolveOutboundRuntimeConfig } from "@/lib/outbound-runtime-config";

export const runtime="nodejs";
export const maxDuration=60;

function authorized(request:Request){
  const expected=process.env.CRON_SECRET;
  return Boolean(expected&&(request.headers.get("authorization")||"")===`Bearer ${expected}`);
}

async function run(request:Request){
  if(!authorized(request))return Response.json({error:"Unauthorized"},{status:401});
  const config=await resolveOutboundRuntimeConfig();
  if(config.v3Mode==="off"||config.deliverabilityMode==="off"){
    return Response.json({
      ok:true,
      enabled:false,
      v3Mode:config.v3Mode,
      deliverabilityMode:config.deliverabilityMode,
    });
  }

  try{
    const result=await runDeliverabilityHealthCheck("default");
    return Response.json({ok:true,...result});
  }catch(error){
    return Response.json({
      ok:false,
      error:error instanceof Error?error.message:"Deliverability health check failed.",
    },{status:503});
  }
}

export async function GET(request:Request){return run(request)}
export async function POST(request:Request){return run(request)}

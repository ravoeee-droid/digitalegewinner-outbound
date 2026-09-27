import { runDurableWorkflowShadowTick } from "@/lib/outbound-durable-workflows";
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
  if(config.v3Mode==="off"||config.durableWorkflowsMode==="off"){
    return Response.json({
      ok:true,
      enabled:false,
      v3Mode:config.v3Mode,
      durableWorkflowsMode:config.durableWorkflowsMode,
    });
  }

  if(config.durableWorkflowsMode==="active"){
    return Response.json(
      {error:"Native durable workflow execution is still locked; shadow mode only."},
      {status:409},
    );
  }

  const result=await runDurableWorkflowShadowTick({
    workspace:"default",
    syncLimit:50,
    stepLimit:100,
    signalLimit:100,
  });

  return Response.json({
    ok:true,
    enabled:true,
    mode:"shadow",
    ...result,
  });
}

export async function GET(request:Request){return run(request)}
export async function POST(request:Request){return run(request)}

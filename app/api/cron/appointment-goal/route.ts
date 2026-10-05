import { ensureAppointmentGoalQueue } from "@/lib/outbound-appointment-goal";

export const runtime="nodejs";
export const maxDuration=60;

function authorized(request:Request){
  const expected=process.env.CRON_SECRET;
  return Boolean(expected&&(request.headers.get("authorization")||"")===`Bearer ${expected}`);
}

async function run(request:Request){
  if(!authorized(request))return Response.json({error:"Unauthorized"},{status:401});
  try{
    const result=await ensureAppointmentGoalQueue("default");
    return Response.json(result,{status:result.ok?200:503});
  }catch(error){
    console.error("[appointment-goal] worker failed", error);
    return Response.json({ok:false,error:error instanceof Error?error.message:"Appointment goal worker failed"},{status:500});
  }
}

export async function GET(request:Request){return run(request)}
export async function POST(request:Request){return run(request)}

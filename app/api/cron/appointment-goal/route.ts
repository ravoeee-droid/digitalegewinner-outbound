import { ensureAppointmentGoalQueue } from "@/lib/outbound-appointment-goal";
import { seedCallLeadsIfEmpty } from "@/lib/seed-call-leads";
import { ensureSalesOsSchema } from "@/lib/sales-os";

export const runtime="nodejs";
export const maxDuration=60;

function authorized(request:Request){
  const expected=process.env.CRON_SECRET;
  return Boolean(expected&&(request.headers.get("authorization")||"")===`Bearer ${expected}`);
}

async function run(request:Request){
  if(!authorized(request))return Response.json({error:"Unauthorized"},{status:401});
  try{
    // Frische Datenbank: erst Grund-Leads einspielen, damit die Warteschlange gefüllt werden kann.
    await ensureSalesOsSchema().then(()=>seedCallLeadsIfEmpty()).catch(()=>null);
    const result=await ensureAppointmentGoalQueue("default");
    console.log("[appointment-goal]",JSON.stringify({ok:result.ok,queuedLeads:(result as {queuedLeads?:number}).queuedLeads,queuedMessages:(result as {queuedMessages?:number}).queuedMessages,reason:(result as {reason?:string}).reason}));
    return Response.json(result,{status:result.ok?200:503});
  }catch(error){
    console.error("[appointment-goal] worker failed", error);
    return Response.json({ok:false,error:error instanceof Error?error.message:"Appointment goal worker failed"},{status:500});
  }
}

export async function GET(request:Request){return run(request)}
export async function POST(request:Request){return run(request)}

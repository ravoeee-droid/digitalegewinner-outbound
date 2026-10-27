
import { ensureLoomCampaigns } from "@/lib/loom-campaign-launch";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function GET(request: Request) {
  const secret=process.env.CRON_SECRET;
  if(!secret||request.headers.get("authorization")!==`Bearer ${secret}`)
    return Response.json({ok:false,error:"Unauthorized"},{status:401});
  try{
    return Response.json(await ensureLoomCampaigns());
  }catch(error){
    return Response.json({ok:false,error:error instanceof Error?error.message:"Loom-Einplanung fehlgeschlagen."},{status:503});
  }
}
export async function POST(request:Request){return GET(request)}

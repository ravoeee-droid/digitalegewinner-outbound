import {syncRevenueAttribution} from "@/lib/outbound-revenue-attribution";
import {resolveOutboundRuntimeConfig} from "@/lib/outbound-runtime-config";
export const runtime="nodejs"; export const maxDuration=60;
function auth(r:Request){const s=process.env.CRON_SECRET;return Boolean(s&&(r.headers.get("authorization")||"")===`Bearer ${s}`)}
async function run(r:Request){if(!auth(r))return Response.json({error:"Unauthorized"},{status:401});const cfg=await resolveOutboundRuntimeConfig();if(cfg.v3Mode==="off")return Response.json({ok:true,enabled:false});try{return Response.json({ok:true,enabled:true,result:await syncRevenueAttribution()})}catch(e){return Response.json({ok:false,error:e instanceof Error?e.message:"Revenue sync failed."},{status:503})}}
export async function GET(r:Request){return run(r)} export async function POST(r:Request){return run(r)}

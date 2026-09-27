import { processPendingConversationMessages } from "@/lib/outbound-conversation-intelligence";
import { resolveOutboundRuntimeConfig } from "@/lib/outbound-runtime-config";

export const runtime="nodejs";
export const maxDuration=60;

function authorized(request:Request){
  const expected=process.env.CRON_SECRET;
  return Boolean(expected&&(request.headers.get("authorization")||"")===`Bearer ${expected}`);
}

async function run(request:Request){
  if(!authorized(request))return Response.json({error:"Unauthorized"},{status:401});
  const runtime=await resolveOutboundRuntimeConfig();
  if(runtime.v3Mode==="off"||runtime.conversationMode==="off"){
    return Response.json({ok:true,enabled:false,v3Mode:runtime.v3Mode,conversationMode:runtime.conversationMode});
  }
  try{
    return Response.json({ok:true,...await processPendingConversationMessages(8)});
  }catch(error){
    return Response.json({
      ok:false,
      error:error instanceof Error?error.message:"Conversation worker failed.",
    },{status:503});
  }
}

export async function GET(request:Request){return run(request)}
export async function POST(request:Request){return run(request)}

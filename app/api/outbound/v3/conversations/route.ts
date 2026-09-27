import { z } from "zod";
import { replyClassSchema } from "@/lib/outbound-contracts";
import {
  getConversationDashboard,
  humanReclassify,
  processPendingConversationMessages,
  resolveConversationEscalation,
} from "@/lib/outbound-conversation-intelligence";

export const runtime="nodejs";
export const maxDuration=60;

const actionSchema=z.discriminatedUnion("action",[
  z.object({action:z.literal("process_now")}),
  z.object({
    action:z.literal("resolve"),
    escalationId:z.string().uuid(),
    resolution:z.string().min(3).max(2000),
  }),
  z.object({
    action:z.literal("reclassify"),
    messageId:z.string().uuid(),
    replyClass:replyClassSchema,
    reason:z.string().min(3).max(2000),
  }),
]);

export async function GET(){
  try{
    return Response.json({ok:true,...await getConversationDashboard()});
  }catch(error){
    return Response.json({
      ok:false,
      error:error instanceof Error?error.message:"Conversation Dashboard konnte nicht geladen werden.",
    },{status:503});
  }
}

export async function POST(request:Request){
  try{
    const input=actionSchema.parse(await request.json());
    if(input.action==="process_now"){
      return Response.json({ok:true,result:await processPendingConversationMessages(8)});
    }
    if(input.action==="resolve"){
      return Response.json({
        ok:true,
        result:await resolveConversationEscalation({
          escalationId:input.escalationId,
          resolution:input.resolution,
          actorId:"admin-session",
        }),
      });
    }
    return Response.json({
      ok:true,
      result:await humanReclassify({
        messageId:input.messageId,
        replyClass:input.replyClass,
        reason:input.reason,
        actorId:"admin-session",
      }),
    });
  }catch(error){
    return Response.json({
      ok:false,
      error:error instanceof Error?error.message:"Conversation-Aktion fehlgeschlagen.",
    },{status:400});
  }
}

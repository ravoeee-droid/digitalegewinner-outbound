import { query, readState } from "@/lib/db";

export const runtime="nodejs";
type EventRow={id:number;lead_id:string;meta:Record<string,unknown>;created_at:string};
type State={leads?:Array<Record<string,unknown>>};
export async function GET(){
 try{
  const [events,row]=await Promise.all([query<EventRow>("select id,lead_id,meta,created_at from er_events where workspace='default' and type='reply' order by created_at desc limit 100"),readState()]);
  const state=row?.payload as State|undefined;const leads=new Map((state?.leads||[]).map(l=>[String(l.id),l]));
  const items=events.map(e=>{const l=leads.get(e.lead_id)||{};return{id:e.id,leadId:e.lead_id,company:String(l.company||"Unbekannt"),contact:String(l.contact||""),from:String(e.meta?.from||""),subject:String(e.meta?.subject||""),mailboxId:String(e.meta?.mailboxId||""),createdAt:e.created_at,stage:String(l.stage||"")}});
  return Response.json({items,count:items.length});
 }catch(error){return Response.json({error:error instanceof Error?error.message:"Inbox nicht erreichbar."},{status:503})}
}

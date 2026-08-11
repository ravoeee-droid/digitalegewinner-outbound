import { query } from "@/lib/db";
import { z } from "zod";

export const runtime = "nodejs";
const variantSchema=z.object({label:z.string().min(1).max(20),subject:z.string().min(1),body:z.string().min(1)});
const stepSchema=z.object({waitDays:z.number().int().min(0).max(60),subject:z.string().min(1),body:z.string().min(1),variants:z.array(variantSchema).min(2).max(3).optional()});
const filterSchema=z.object({industry:z.string().optional(),city:z.string().optional(),minEnergyScore:z.number().min(0).max(100).optional(),minWebsiteScore:z.number().min(0).max(100).optional(),minIntentScore:z.number().min(0).max(100).optional()});
const schema = z.object({
  campaign: z.object({id:z.string(),steps:z.array(stepSchema).min(1),filters:filterSchema.optional()}),
  leads:z.array(z.object({id:z.string(),email:z.string().email(),company:z.string(),contact:z.string().optional().default(""),city:z.string().optional().default(""),industry:z.string().optional().default(""),energyScore:z.number().optional().default(0),websiteScore:z.number().optional().default(0),intentScore:z.number().optional().default(0)})).min(1).max(5000),
  mailboxes:z.array(z.object({id:z.string(),enabled:z.boolean(),dailyLimit:z.number().int().min(1).max(100)})).min(1),
  senderName:z.string().default("Digitale Gewinner"),appUrl:z.string().url().optional(),
});
function render(template:string,lead:{id:string;company:string;contact:string;city:string},senderName:string,appUrl:string){const first=lead.contact.trim().split(/\s+/)[0]||"Guten Tag";return template.replaceAll("{{first_name}}",first).replaceAll("{{company}}",lead.company).replaceAll("{{city}}",lead.city).replaceAll("{{sender_name}}",senderName).replaceAll("{{analysis_link}}",`${appUrl}/a/${encodeURIComponent(lead.id)}`)}
function hash(value:string){let h=2166136261;for(let i=0;i<value.length;i++){h^=value.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0}
function matches(lead:{industry:string;city:string;energyScore:number;websiteScore:number;intentScore:number},filters?:z.infer<typeof filterSchema>){if(!filters)return true;if(filters.industry&&!lead.industry.toLowerCase().includes(filters.industry.toLowerCase()))return false;if(filters.city&&!lead.city.toLowerCase().includes(filters.city.toLowerCase()))return false;if(typeof filters.minEnergyScore==="number"&&lead.energyScore<filters.minEnergyScore)return false;if(typeof filters.minWebsiteScore==="number"&&lead.websiteScore<filters.minWebsiteScore)return false;if(typeof filters.minIntentScore==="number"&&lead.intentScore<filters.minIntentScore)return false;return true}
export async function POST(request:Request){
 try{
  const input=schema.parse(await request.json());const active=input.mailboxes.filter(m=>m.enabled&&m.dailyLimit>0);if(!active.length)return Response.json({error:"Keine aktive Mailbox."},{status:409});
  const suppressedRows=await query<{email:string}>("select email from er_suppressions where workspace='default'");const suppressed=new Set(suppressedRows.map(r=>r.email.toLowerCase()));const appUrl=input.appUrl||process.env.NEXT_PUBLIC_APP_URL||new URL(request.url).origin;
  const eligible=input.leads.filter(l=>matches(l,input.campaign.filters));const leadIds=eligible.map(l=>l.id);const enrolledRows=leadIds.length?await query<{lead_id:string}>("select distinct lead_id from er_outbox where workspace='default' and campaign_id=$1 and lead_id=any($2::text[]) and status not in ('failed','suppressed')",[input.campaign.id,leadIds]):[];const enrolled=new Set(enrolledRows.map(r=>r.lead_id));let queued=0,skipped=0,index=0;const variants:Record<string,number>={};
  for(const lead of eligible){if(suppressed.has(lead.email.toLowerCase())||enrolled.has(lead.id)){skipped++;continue}const mailbox=active[index++%active.length];for(let stepIndex=0;stepIndex<input.campaign.steps.length;stepIndex++){const step=input.campaign.steps[stepIndex];const candidates=step.variants?.length?step.variants:[{label:"A",subject:step.subject,body:step.body}];const selected=candidates[hash(`${input.campaign.id}:${lead.id}:${stepIndex}`)%candidates.length];variants[selected.label]=(variants[selected.label]||0)+1;const scheduled=new Date(Date.now()+step.waitDays*86400000);await query(`insert into er_outbox(id,workspace,campaign_id,lead_id,mailbox_id,recipient,subject,body,variant,scheduled_at) values($1,'default',$2,$3,$4,$5,$6,$7,$8,$9)`,[crypto.randomUUID(),input.campaign.id,lead.id,mailbox.id,lead.email,render(selected.subject,lead,input.senderName,appUrl),render(selected.body,lead,input.senderName,appUrl),selected.label,scheduled]);queued++}}
  return Response.json({ok:true,queued,skipped,eligibleLeads:eligible.length,totalLeads:input.leads.length,variants});
 }catch(error){return Response.json({error:error instanceof Error?error.message:"Kampagne konnte nicht gestartet werden."},{status:400})}
}

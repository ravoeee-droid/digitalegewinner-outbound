import { adminCookieName, authenticate, sessionValueFor } from "@/lib/admin-auth";
import { z } from "zod";
import { query } from "@/lib/db";

const schema=z.object({email:z.string().max(320).optional().default(""),password:z.string().min(1).max(500)});
// Schutz gegen Passwort-Raten: nach 10 Fehlversuchen pro IP in 15 Minuten wird gesperrt. Fällt die Datenbank aus, bleibt der Login nutzbar.
const withTimeout=<T,>(work:Promise<T>)=>Promise.race([work,new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error("timeout")),2500))]);
function clientIp(request:Request){return (request.headers.get("x-forwarded-for")||"").split(",")[0].trim()||"unbekannt"}
async function tooManyFailures(ip:string){
 try{const rows=await withTimeout(query<{n:number}>("select count(*)::int n from er_events where workspace='default' and type='login_failed' and meta->>'ip'=$1 and created_at>now()-interval '15 minutes'",[ip]));return Number(rows[0]?.n||0)>=10}catch{return false}
}
async function recordFailure(ip:string){
 try{await withTimeout(query("insert into er_events(workspace,type,meta) values('default','login_failed',$1::jsonb)",[JSON.stringify({ip})]))}catch{}
}
export async function POST(request:Request){
 try{
  const ip=clientIp(request);
  if(await tooManyFailures(ip))return Response.json({error:"Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen."},{status:429});
  const {email,password}=schema.parse(await request.json());
  const user=authenticate(email,password);
  if(!user){await recordFailure(ip);return Response.json({error:"E-Mail oder Passwort falsch."},{status:401})}
  const response=Response.json({ok:true,role:user.role});
  response.headers.append("Set-Cookie",`${adminCookieName()}=${sessionValueFor(user)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${process.env.NODE_ENV==="production"?"; Secure":""}`);
  return response;
 }catch{return Response.json({error:"Login fehlgeschlagen."},{status:400})}
}

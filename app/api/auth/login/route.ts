import { adminCookieName, authenticate, sessionValueFor } from "@/lib/admin-auth";
import { z } from "zod";

const schema=z.object({email:z.string().max(320).optional().default(""),password:z.string().min(1).max(500)});
export async function POST(request:Request){
 try{
  const {email,password}=schema.parse(await request.json());
  const user=authenticate(email,password);
  if(!user)return Response.json({error:"E-Mail oder Passwort falsch."},{status:401});
  const response=Response.json({ok:true,role:user.role});
  response.headers.append("Set-Cookie",`${adminCookieName()}=${sessionValueFor(user)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${process.env.NODE_ENV==="production"?"; Secure":""}`);
  return response;
 }catch{return Response.json({error:"Login fehlgeschlagen."},{status:400})}
}

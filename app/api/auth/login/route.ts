import { adminCookieName, sessionValue } from "@/lib/admin-auth";
import { z } from "zod";

const schema=z.object({password:z.string().min(1).max(500)});
export async function POST(request:Request){
 try{
  const {password}=schema.parse(await request.json());
  if(!process.env.ADMIN_PASSWORD)return Response.json({error:"ADMIN_PASSWORD fehlt."},{status:503});
  if(password!==process.env.ADMIN_PASSWORD)return Response.json({error:"Falsches Passwort."},{status:401});
  const response=Response.json({ok:true});
  response.headers.append("Set-Cookie",`${adminCookieName()}=${sessionValue()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${process.env.NODE_ENV==="production"?"; Secure":""}`);
  return response;
 }catch{return Response.json({error:"Login fehlgeschlagen."},{status:400})}
}

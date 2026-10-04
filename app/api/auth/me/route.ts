import { cookies } from "next/headers";
import { adminCookieName, sessionRole } from "@/lib/admin-auth";
export const dynamic="force-dynamic";
export async function GET(){
 const jar=await cookies();
 const role=sessionRole(jar.get(adminCookieName())?.value);
 if(!role)return Response.json({error:"Unauthorized"},{status:401});
 return Response.json({role});
}

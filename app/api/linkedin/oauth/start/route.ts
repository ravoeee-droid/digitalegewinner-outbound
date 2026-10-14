import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { adminCookieName, sessionRole } from "@/lib/admin-auth";
import { linkedinOAuthSettings } from "@/lib/linkedin-content";

export const runtime = "nodejs";
export async function GET() {
  const jar = await cookies();
  if (sessionRole(jar.get(adminCookieName())?.value) !== "admin") {
    return Response.json({ error:"Unauthorized" },{status:401});
  }
  const settings = linkedinOAuthSettings();
  if (!settings.configured) return Response.json({error:"LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET und NEXT_PUBLIC_APP_URL fehlen."},{status:503});
  const nonce = randomBytes(32).toString("hex");
  const params = new URLSearchParams({
    response_type:"code",
    client_id:settings.clientId,
    redirect_uri: settings.appUrl + "/api/linkedin/oauth/callback",
    state:nonce,
    scope:"openid profile w_member_social"
  });
  const response = NextResponse.redirect("https://www.linkedin.com/oauth/v2/authorization?" + params.toString());
  response.cookies.set("dg_linkedin_oauth_state",nonce,{
    httpOnly:true,sameSite:"lax",secure:settings.appUrl.startsWith("https://"),path:"/",maxAge:600
  });
  return response;
}

import { cookies } from "next/headers";
import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { adminCookieName, sessionRole } from "@/lib/admin-auth";
import { linkedinOAuthSettings, storeLinkedinConnection } from "@/lib/linkedin-content";

export const runtime = "nodejs";
export async function GET(request:Request) {
  const params = new URL(request.url).searchParams;
  const settings = linkedinOAuthSettings();
  const jar = await cookies();
  const previous = jar.get("dg_linkedin_oauth_state")?.value || "";
  const received = params.get("state") || "";
  if (sessionRole(jar.get(adminCookieName())?.value) !== "admin") return Response.json({error:"Unauthorized"},{status:401});
  if (!settings.configured || !previous || !received ||
      previous.length !== received.length ||
      !timingSafeEqual(Buffer.from(previous),Buffer.from(received))) {
    return Response.json({error:"OAuth-State ungültig oder abgelaufen."},{status:403});
  }
  const code = params.get("code");
  if (!code || params.get("error")) return Response.json({error:"LinkedIn-Autorisierung abgebrochen."},{status:400});
  try {
    const body = new URLSearchParams({
      grant_type:"authorization_code",code,
      redirect_uri:settings.appUrl + "/api/linkedin/oauth/callback",
      client_id:settings.clientId,client_secret:settings.clientSecret
    });
    const tokenResult = await fetch("https://www.linkedin.com/oauth/v2/accessToken",{
      method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body,cache:"no-store"
    });
    if (!tokenResult.ok) throw new Error("LinkedIn Token-Austausch fehlgeschlagen (" + tokenResult.status + ")");
    const token = await tokenResult.json() as {access_token?:string;expires_in?:number};
    if (!token.access_token || !token.expires_in) throw new Error("LinkedIn Access Token fehlt.");
    const profileResult = await fetch("https://api.linkedin.com/v2/userinfo",{
      headers:{Authorization:"Bearer " + token.access_token},cache:"no-store"
    });
    if (!profileResult.ok) throw new Error("LinkedIn-Profil konnte nicht gelesen werden (" + profileResult.status + ").");
    const profile = await profileResult.json() as {sub?:string};
    if (!profile.sub) throw new Error("LinkedIn-Profil-ID fehlt. OpenID Connect muss aktiviert sein.");
    await storeLinkedinConnection(token.access_token,profile.sub,token.expires_in);
    const response=NextResponse.redirect(settings.appUrl + "/outbound/linkedin?connected=1");
    response.cookies.set("dg_linkedin_oauth_state","",{httpOnly:true,sameSite:"lax",path:"/",maxAge:0});
    return response;
  } catch(error) {
    return Response.json({error:error instanceof Error?error.message:"LinkedIn-Verbindung fehlgeschlagen."},{status:502});
  }
}

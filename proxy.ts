import { NextRequest, NextResponse } from "next/server";
import { sessionRole, adminCookieName } from "@/lib/admin-auth";

const SALES_BLOCKED_PREFIXES=["/mail","/outbound","/outreach","/pro","/seo-radar","/studio","/websites"];
const SALES_BLOCKED_API_PREFIXES=["/api/mail","/api/outbound","/api/outreach","/api/pro","/api/seo","/api/studio","/api/websites","/api/settings","/api/admin"];

export function proxy(request:NextRequest){
 const {pathname}=request.nextUrl;
 const cookie=request.cookies.get(adminCookieName())?.value;
 const role=sessionRole(cookie);
 if(!role){
  if(pathname.startsWith("/api/"))return NextResponse.json({error:"Unauthorized"},{status:401});
  const url=request.nextUrl.clone();url.pathname="/login";url.searchParams.set("next",pathname);return NextResponse.redirect(url);
 }
 if(role==="sales"){
  const blocked=pathname.startsWith("/api/")
   ? SALES_BLOCKED_API_PREFIXES.some(prefix=>pathname.startsWith(prefix))
   : SALES_BLOCKED_PREFIXES.some(prefix=>pathname.startsWith(prefix));
  if(blocked){
   if(pathname.startsWith("/api/"))return NextResponse.json({error:"Forbidden"},{status:403});
   const url=request.nextUrl.clone();url.pathname="/";url.searchParams.set("denied","sales");return NextResponse.redirect(url);
  }
 }
 return NextResponse.next();
}

export const config={
 matcher:[
  "/",
  "/call/:path*",
  "/heute/:path*",
  "/dashboard/:path*",
  "/mail/:path*",
  "/outbound/:path*",
  "/outreach/:path*",
  "/pflege/:path*",
  "/pro/:path*",
  "/seo-radar/:path*",
  "/studio/:path*",
  "/ui/:path*",
  "/websites/:path*",
  "/api/((?!auth/login|track|t/|events/inbound|cron/|oauth/google/callback|oauth/microsoft/callback|video/callback|health/db).*)"
 ]
};

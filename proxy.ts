import { NextRequest, NextResponse } from "next/server";
import { validSession, adminCookieName } from "@/lib/admin-auth";

export function proxy(request:NextRequest){
 const {pathname}=request.nextUrl;
 const cookie=request.cookies.get(adminCookieName())?.value;
 if(validSession(cookie))return NextResponse.next();
 if(pathname.startsWith("/api/"))return NextResponse.json({error:"Unauthorized"},{status:401});
 const url=request.nextUrl.clone();url.pathname="/login";url.searchParams.set("next",pathname);return NextResponse.redirect(url);
}

export const config={
 matcher:[
  "/",
  "/call/:path*",
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
  "/api/((?!auth/login|track|t/|events/inbound|cron/|oauth/google/callback|oauth/microsoft/callback|video/callback).*)"
 ]
};

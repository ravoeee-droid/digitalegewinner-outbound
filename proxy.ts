import { NextRequest, NextResponse } from "next/server";
import { validSession, adminCookieName } from "@/lib/admin-auth";

const publicPrefixes=["/login","/api/auth/login","/a/","/api/track","/api/events/inbound","/api/cron/send","/api/oauth/"];

export function proxy(request:NextRequest){
 const {pathname}=request.nextUrl;
 if(publicPrefixes.some((p)=>pathname===p||pathname.startsWith(p)))return NextResponse.next();
 const cookie=request.cookies.get(adminCookieName())?.value;
 if(validSession(cookie))return NextResponse.next();
 if(pathname.startsWith("/api/"))return NextResponse.json({error:"Unauthorized"},{status:401});
 const url=request.nextUrl.clone();url.pathname="/login";url.searchParams.set("next",pathname);return NextResponse.redirect(url);
}

export const config={matcher:["/((?!_next/static|_next/image|favicon.ico).*)"]};

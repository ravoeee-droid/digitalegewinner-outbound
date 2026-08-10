import { encodeOAuthState } from "@/lib/oauth-state";
import { getSecret } from "@/lib/secrets";
import { z } from "zod";

const schema=z.object({mailboxId:z.string().min(1).max(120),name:z.string().max(120).optional()});
export async function GET(request:Request){
 try{
  const url=new URL(request.url);const input=schema.parse({mailboxId:url.searchParams.get("mailboxId"),name:url.searchParams.get("name")||undefined});
  const clientId=process.env.GOOGLE_CLIENT_ID||await getSecret("google_client_id");
  if(!clientId)return Response.json({error:"Google OAuth Client ID fehlt."},{status:503});
  const base=process.env.NEXT_PUBLIC_APP_URL||url.origin;const redirectUri=`${base}/api/oauth/google/callback`;
  const params=new URLSearchParams({client_id:clientId,redirect_uri:redirectUri,response_type:"code",access_type:"offline",prompt:"consent",include_granted_scopes:"true",scope:"https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly",state:encodeOAuthState({provider:"google",mailboxId:input.mailboxId,name:input.name})});
  return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
 }catch(error){return Response.json({error:error instanceof Error?error.message:"OAuth Start fehlgeschlagen."},{status:400})}
}

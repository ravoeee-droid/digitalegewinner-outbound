import { encodeOAuthState } from "@/lib/oauth-state";
import { getSecret } from "@/lib/secrets";
import { z } from "zod";

const schema=z.object({mailboxId:z.string().min(1).max(120),name:z.string().max(120).optional()});
export async function GET(request:Request){
 try{
  const url=new URL(request.url);const input=schema.parse({mailboxId:url.searchParams.get("mailboxId"),name:url.searchParams.get("name")||undefined});
  const clientId=process.env.MICROSOFT_CLIENT_ID||await getSecret("microsoft_client_id");if(!clientId)return Response.json({error:"Microsoft OAuth Client ID fehlt."},{status:503});
  const base=process.env.NEXT_PUBLIC_APP_URL||url.origin;const params=new URLSearchParams({client_id:clientId,response_type:"code",redirect_uri:`${base}/api/oauth/microsoft/callback`,response_mode:"query",scope:"openid profile email offline_access User.Read Mail.Send Mail.Read",state:encodeOAuthState({provider:"microsoft",mailboxId:input.mailboxId,name:input.name})});
  return Response.redirect(`https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`);
 }catch(error){return Response.json({error:error instanceof Error?error.message:"OAuth Start fehlgeschlagen."},{status:400})}
}

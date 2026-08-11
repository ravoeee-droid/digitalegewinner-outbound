import { decodeOAuthState } from "@/lib/oauth-state";
import { readState, writeState } from "@/lib/db";
import { getSecret, setSecret } from "@/lib/secrets";

export async function GET(request:Request){
 const url=new URL(request.url);const code=url.searchParams.get("code");const stateRaw=url.searchParams.get("state");
 try{
  if(!code||!stateRaw)throw new Error("OAuth Code/State fehlt.");const state=decodeOAuthState(stateRaw);if(state.provider!=="google")throw new Error("Falscher OAuth Provider.");
  const clientId=process.env.GOOGLE_CLIENT_ID||await getSecret("google_client_id");const clientSecret=process.env.GOOGLE_CLIENT_SECRET||await getSecret("google_client_secret");if(!clientId||!clientSecret)throw new Error("Google OAuth Credentials fehlen.");
  const base=process.env.NEXT_PUBLIC_APP_URL||url.origin;const body=new URLSearchParams({code,client_id:clientId,client_secret:clientSecret,redirect_uri:`${base}/api/oauth/google/callback`,grant_type:"authorization_code"});
  const tokenResponse=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body});if(!tokenResponse.ok)throw new Error(`Google Token Exchange fehlgeschlagen (${tokenResponse.status}).`);const token=await tokenResponse.json() as {access_token?:string;refresh_token?:string};if(!token.access_token)throw new Error("Google Access Token fehlt.");
  const profileResponse=await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile",{headers:{Authorization:`Bearer ${token.access_token}`}});if(!profileResponse.ok)throw new Error("Google Mailbox Profil konnte nicht gelesen werden.");const profile=await profileResponse.json() as {emailAddress?:string};if(!profile.emailAddress)throw new Error("Google Mailbox E-Mail fehlt.");
  const raw=await getSecret("mailbox_credentials_json").catch(()=>"");let list:Array<Record<string,unknown>>=[];try{list=raw?JSON.parse(raw):[]}catch{}const existing=list.find(x=>x.id===state.mailboxId) as Record<string,unknown>|undefined;const name=state.name||String(existing?.name||profile.emailAddress);const credential={...(existing||{}),id:state.mailboxId,provider:"gmail",email:profile.emailAddress,name,refreshToken:token.refresh_token||existing?.refreshToken,accessToken:token.refresh_token?undefined:token.access_token};const next=[...list.filter(x=>x.id!==state.mailboxId),credential];await setSecret("mailbox_credentials_json",JSON.stringify(next));
  const row=await readState().catch(()=>null);const current=(row?.payload||{}) as {mailboxes?:Array<Record<string,unknown>>};const mailboxes=current.mailboxes||[];const previous=mailboxes.find(x=>String(x.id)===state.mailboxId);const mailbox={...(previous||{}),id:state.mailboxId,name,email:profile.emailAddress,provider:"Google",dailyLimit:Number(previous?.dailyLimit||5),sentToday:Number(previous?.sentToday||0),warmupDay:Number(previous?.warmupDay||1),health:Number(previous?.health||60),enabled:true,spf:Boolean(previous?.spf),dkim:Boolean(previous?.dkim),dmarc:Boolean(previous?.dmarc)};await writeState({...current,mailboxes:[...mailboxes.filter(x=>String(x.id)!==state.mailboxId),mailbox]});
  return Response.redirect(`${base}/?oauth=google-connected`);
 }catch(error){return Response.json({error:error instanceof Error?error.message:"Google OAuth fehlgeschlagen."},{status:400})}
}

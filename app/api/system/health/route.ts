import { readState } from "@/lib/db";
import { secretStatus } from "@/lib/secrets";

export const runtime = "nodejs";

export async function GET() {
  try {
    const stored = new Set((await secretStatus()).map((x) => x.key));
    const stateRow=await readState().catch(()=>null);
    const state=stateRow?.payload as {mailboxes?:Array<{enabled?:boolean}>}|undefined;
    const activeMailboxes=(state?.mailboxes||[]).filter(m=>m.enabled).length;
    const checks = {
      database: Boolean(process.env.DATABASE_URL),
      admin: Boolean(process.env.ADMIN_PASSWORD),
      encryption: Boolean(process.env.APP_ENCRYPTION_KEY || process.env.ADMIN_PASSWORD),
      cronSecret: Boolean(process.env.CRON_SECRET),
      webhookSecret: Boolean(process.env.WEBHOOK_SECRET),
      publicUrl: Boolean(process.env.NEXT_PUBLIC_APP_URL),
      openai: Boolean(process.env.OPENAI_API_KEY || stored.has("openai_api_key")),
      mapsPlaces: Boolean(process.env.GOOGLE_MAPS_API_KEY || stored.has("google_maps_api_key")),
      emailVerifier: Boolean(process.env.EMAIL_VERIFIER_API_KEY || stored.has("email_verifier_api_key")),
      googleOAuth: Boolean((process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) || (stored.has("google_client_id") && stored.has("google_client_secret"))),
      microsoftOAuth: Boolean((process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET) || (stored.has("microsoft_client_id") && stored.has("microsoft_client_secret"))),
      mailboxCredentials: Boolean(process.env.MAILBOX_CREDENTIALS_JSON || stored.has("mailbox_credentials_json")),
      activeMailbox: activeMailboxes>0,
      videoRenderer: Boolean((process.env.VIDEO_RENDERER_URL || stored.has("video_renderer_url")) && (process.env.VIDEO_RENDERER_SECRET || stored.has("video_renderer_secret"))),
    };
    const coreReady=checks.database&&checks.admin&&checks.encryption&&checks.cronSecret&&checks.webhookSecret&&checks.publicUrl;
    const outboundReady=coreReady&&checks.activeMailbox&&checks.mailboxCredentials;
    const leadFinderReady=checks.mapsPlaces;
    const aiReady=checks.openai;
    const videoReady=checks.videoRenderer;
    const fullReady=outboundReady&&leadFinderReady&&aiReady&&videoReady;
    const configured = Object.values(checks).filter(Boolean).length;
    return Response.json({checks:{...checks,google:checks.mapsPlaces},configured,total:Object.keys(checks).length,activeMailboxes,coreReady,outboundReady,leadFinderReady,aiReady,videoReady,ready:fullReady});
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Health Check fehlgeschlagen." }, { status: 503 });
  }
}

import { secretStatus } from "@/lib/secrets";

export const runtime = "nodejs";

export async function GET() {
  try {
    const stored = new Set((await secretStatus()).map((x) => x.key));
    const checks = {
      database: Boolean(process.env.DATABASE_URL),
      admin: Boolean(process.env.ADMIN_PASSWORD),
      encryption: Boolean(process.env.APP_ENCRYPTION_KEY || process.env.ADMIN_PASSWORD),
      openai: Boolean(process.env.OPENAI_API_KEY || stored.has("openai_api_key")),
      googleOAuth: Boolean((process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) || (stored.has("google_client_id") && stored.has("google_client_secret"))),
      microsoftOAuth: Boolean((process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET) || (stored.has("microsoft_client_id") && stored.has("microsoft_client_secret"))),
      mapsSolar: Boolean(process.env.GOOGLE_MAPS_API_KEY || stored.has("google_maps_api_key")),
      emailVerifier: Boolean(process.env.EMAIL_VERIFIER_API_KEY || stored.has("email_verifier_api_key")),
      mailboxFleet: Boolean(process.env.MAILBOX_CREDENTIALS_JSON || stored.has("mailbox_credentials_json")),
      cronSecret: Boolean(process.env.CRON_SECRET),
      webhookSecret: Boolean(process.env.WEBHOOK_SECRET),
      publicUrl: Boolean(process.env.NEXT_PUBLIC_APP_URL),
    };
    const configured = Object.values(checks).filter(Boolean).length;
    return Response.json({ checks, configured, total: Object.keys(checks).length, ready: configured >= 7 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Health Check fehlgeschlagen." }, { status: 503 });
  }
}

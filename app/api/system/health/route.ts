export const runtime = "nodejs";

export async function GET() {
  const checks = {
    database: Boolean(process.env.DATABASE_URL),
    openai: Boolean(process.env.OPENAI_API_KEY),
    googleOAuth: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    microsoftOAuth: Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET),
    maps: Boolean(process.env.GOOGLE_MAPS_API_KEY || process.env.MAPBOX_TOKEN),
    emailVerifier: Boolean(process.env.EMAIL_VERIFIER_API_KEY),
    cronSecret: Boolean(process.env.CRON_SECRET),
    publicUrl: Boolean(process.env.NEXT_PUBLIC_APP_URL),
  };
  const configured = Object.values(checks).filter(Boolean).length;
  return Response.json({ checks, configured, total: Object.keys(checks).length, ready: configured >= 4 });
}

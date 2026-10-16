import { d1Configured, d1Query } from "@/lib/cloudflare-d1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Protected by proxy.ts; sales users cannot access /api/settings.
export async function GET() {
  if (!d1Configured()) return Response.json({ok:false,provider:"d1",error:"Cloudflare-Verbindung ist unvollständig."},{status:503});
  try {
    const [status] = await d1Query<{ok:number;states:number;vaultEntries:number;sentMessages:number}>(
      "SELECT 1 AS ok,(SELECT count(*) FROM er_state) AS states,(SELECT count(*) FROM er_secrets) AS vaultEntries,(SELECT count(*) FROM mail_sent) AS sentMessages",
    );
    return Response.json({ok:status?.ok===1,provider:"cloudflare-d1",scope:"mail-and-workspace-state",states:status?.states ?? 0,vaultEntries:status?.vaultEntries ?? 0,sentMessages:status?.sentMessages ?? 0});
  } catch {
    return Response.json({ok:false,provider:"cloudflare-d1",error:"Cloudflare-D1-Verbindung konnte nicht bestätigt werden."},{status:503});
  }
}

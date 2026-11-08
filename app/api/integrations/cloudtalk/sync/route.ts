import { cookies } from "next/headers";
import { adminCookieName, sessionRole } from "@/lib/admin-auth";
import { query } from "@/lib/db";
import { addCloudTalkContact, cloudtalkConfigured } from "@/lib/cloudtalk-api";
import { openCallContacts } from "@/lib/call-queue-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Schickt die heute offenen Calls als Kontakte (Tag pflege-heute) an CloudTalk. Jeder Lead höchstens einmal; ?dry=1 sendet nichts.
export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const dry = url.searchParams.get("dry") === "1";
    const tag = url.searchParams.get("tag") || "pflege-heute";
    if (!dry && !cloudtalkConfigured()) return Response.json({ error: "CLOUDTALK_API_ID / CLOUDTALK_API_SECRET sind in Vercel nicht gesetzt." }, { status: 503 });
    const store = await cookies();
    const owner = sessionRole(store.get(adminCookieName())?.value) === "sales" ? "Mattias" : "Raphael";
    const { contacts: all, openTasks, withoutPhone } = await openCallContacts(owner, tag);
    const done = new Set((await query<{ lead_id: string }>(
      `select distinct lead_id from sales_activities where type='cloudtalk.sync' and meta->>'tag'=$1 and lead_id=any($2::text[])`, [tag, all.map((c) => c.leadId)])).map((r) => r.lead_id));
    const todo = all.filter((c) => !done.has(c.leadId));
    if (dry) return Response.json({ ok: true, dry: true, offeneCalls: openTasks, ohneNummer: withoutPhone, offen: all.length, schonGesendet: done.size, wuerdeSenden: todo.length, beispiel: todo.slice(0, 3) });
    // In Portionen mit Pause senden (CloudTalk begrenzt Anfragen pro Minute); der Client ruft so lange erneut auf, bis nichts mehr offen ist.
    const batch = todo.slice(0, Math.max(1, Math.min(40, Number(url.searchParams.get("limit")) || 20)));
    let sent = 0; let attempted = 0; let rateLimited = false; const errors: string[] = [];
    for (const c of batch) {
      if (attempted > 0) await new Promise((r) => setTimeout(r, 1200));
      attempted++;
      try {
        const id = await addCloudTalkContact(c);
        await query(`insert into sales_activities(workspace,lead_id,company_id,type,summary,meta)
          select workspace,id,company_id,'cloudtalk.sync','An CloudTalk gesendet',jsonb_build_object('tag',$2::text,'cloudtalkContactId',$3::text) from sales_leads where id=$1`, [c.leadId, tag, id]);
        sent++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Fehler";
        errors.push(`${c.company}: ${msg}`);
        if (/HTTP 429/.test(msg)) { rateLimited = true; break; }
      }
    }
    return Response.json({ ok: errors.length === 0, offeneCalls: openTasks, ohneNummer: withoutPhone, gesendet: sent, schonVorhanden: done.size, verbleibend: Math.max(0, todo.length - sent), rateLimited, fehler: errors.slice(0, 5) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Sync fehlgeschlagen." }, { status: 500 });
  }
}

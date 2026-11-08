import { query } from "@/lib/db";
import { addCloudTalkContact } from "@/lib/cloudtalk-api";
import { openCallContacts } from "@/lib/call-queue-export";

export type SyncResult = { offeneCalls: number; ohneNummer: number; gesendet: number; schonVorhanden: number; verbleibend: number; rateLimited: boolean; fehler: string[]; vorschau?: unknown[] };

// Schickt höchstens `limit` noch nicht gesendete Leads der Tages-Queue als Kontakte mit Tag an CloudTalk (jeder Lead nur einmal). dry=true sendet nichts.
export async function syncCallQueue({ owner, tag, limit = 20, dry = false }: { owner: string; tag: string; limit?: number; dry?: boolean }): Promise<SyncResult> {
  const { contacts: all, openTasks, withoutPhone } = await openCallContacts(owner, tag);
  const done = new Set((await query<{ lead_id: string }>(
    `select distinct lead_id from sales_activities where type='cloudtalk.sync' and meta->>'tag'=$1 and lead_id=any($2::text[])`, [tag, all.map((c) => c.leadId)])).map((r) => r.lead_id));
  const todo = all.filter((c) => !done.has(c.leadId));
  if (dry) return { offeneCalls: openTasks, ohneNummer: withoutPhone, gesendet: 0, schonVorhanden: done.size, verbleibend: todo.length, rateLimited: false, fehler: [], vorschau: todo.slice(0, 3) };
  const batch = todo.slice(0, Math.max(1, Math.min(40, limit)));
  let sent = 0, attempted = 0, rateLimited = false;
  const errors: string[] = [];
  for (const c of batch) {
    if (attempted > 0) await new Promise((r) => setTimeout(r, 1200)); // CloudTalk begrenzt Anfragen pro Minute
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
  return { offeneCalls: openTasks, ohneNummer: withoutPhone, gesendet: sent, schonVorhanden: done.size, verbleibend: Math.max(0, todo.length - sent), rateLimited, fehler: errors.slice(0, 5) };
}

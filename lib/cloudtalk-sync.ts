import { query } from "@/lib/db";
import { addCloudTalkContact, renameCloudTalkContact } from "@/lib/cloudtalk-api";
import { openCallContacts } from "@/lib/call-queue-export";
import { enrichContactPersons } from "@/lib/contact-person-enrich";

export type SyncResult = { namenVersucht: number; namenGefunden: number; namenOffen: number; umbenannt: number; umbenennenOffen: number; offeneCalls: number; ohneNummer: number; gesendet: number; schonVorhanden: number; verbleibend: number; rateLimited: boolean; fehler: string[]; vorschau?: unknown[] };

// Schickt höchstens `limit` noch nicht gesendete Leads der Tages-Queue als Kontakte mit Tag an CloudTalk (jeder Lead nur einmal). dry=true sendet nichts.
export async function syncCallQueue({ owner, tag, limit = 20, dry = false }: { owner: string; tag: string; limit?: number; dry?: boolean }): Promise<SyncResult> {
  let { contacts: all, openTasks, withoutPhone } = await openCallContacts(owner, tag);
  // Fehlende Ansprechpartner zuerst aus den Webseiten nachtragen (je Aufruf eine Portion), dann Queue neu lesen.
  let namen = { tried: 0, found: 0, open: 0 };
  if (!dry) {
    namen = await enrichContactPersons(all.filter((c) => !c.person).map((c) => c.leadId));
    if (namen.found) ({ contacts: all, openTasks, withoutPhone } = await openCallContacts(owner, tag));
  }
  const done = new Set((await query<{ lead_id: string }>(
    `select distinct lead_id from sales_activities where type='cloudtalk.sync' and meta->>'tag'=$1 and lead_id=any($2::text[])`, [tag, all.map((c) => c.leadId)])).map((r) => r.lead_id));
  const todo = all.filter((c) => !done.has(c.leadId));
  if (dry) return { namenVersucht: 0, namenGefunden: 0, namenOffen: 0, umbenannt: 0, umbenennenOffen: 0, offeneCalls: openTasks, ohneNummer: withoutPhone, gesendet: 0, schonVorhanden: done.size, verbleibend: todo.length, rateLimited: false, fehler: [], vorschau: todo.slice(0, 3) };
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
  // Schon früher gesendete Leads: Name von Firma auf Ansprechpartner umstellen (einmal je Lead).
  let renamed = 0, renamePending = 0;
  if (!rateLimited) {
    const known = await query<{ lead_id: string; cid: string; renamed: boolean }>(
      `select a.lead_id, a.meta->>'cloudtalkContactId' cid,
              exists(select 1 from sales_activities r where r.type='cloudtalk.rename' and r.lead_id=a.lead_id and r.meta->>'tag'=$1) renamed
       from sales_activities a where a.type='cloudtalk.sync' and a.meta->>'tag'=$1 and a.lead_id=any($2::text[]) and coalesce(a.meta->>'cloudtalkContactId','')<>''`,
      [tag, all.filter((c) => c.person).map((c) => c.leadId)]);
    const byLead = new Map(all.map((c) => [c.leadId, c]));
    const pending = known.filter((k) => !k.renamed);
    renamePending = pending.length;
    for (const k of pending.slice(0, Math.max(0, 20 - sent))) {
      if (attempted > 0) await new Promise((r) => setTimeout(r, 1200));
      attempted++;
      try {
        await renameCloudTalkContact(k.cid, byLead.get(k.lead_id)!.name);
        await query(`insert into sales_activities(workspace,lead_id,company_id,type,summary,meta)
          select workspace,id,company_id,'cloudtalk.rename','CloudTalk-Kontakt auf Ansprechpartner umbenannt',jsonb_build_object('tag',$2::text,'cloudtalkContactId',$3::text) from sales_leads where id=$1`, [k.lead_id, tag, k.cid]);
        renamed++; renamePending--;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Fehler";
        errors.push(`Umbenennen ${k.lead_id}: ${msg}`);
        if (/HTTP 429/.test(msg)) { rateLimited = true; break; }
      }
    }
  }
  return { namenVersucht: namen.tried, namenGefunden: namen.found, namenOffen: namen.open, umbenannt: renamed, umbenennenOffen: renamePending, offeneCalls: openTasks, ohneNummer: withoutPhone, gesendet: sent, schonVorhanden: done.size, verbleibend: Math.max(0, todo.length - sent), rateLimited, fehler: errors.slice(0, 5) };
}

import { query } from "@/lib/db";
import { sendAlert } from "@/lib/alerts";
import { analysisUrl, ensureAnalysisPdf } from "@/lib/analysis-store";

// Terminbuchungen (Google Kalender, Calendly, Cal.com …) erkennen, die als E-Mail in einem verbundenen Postfach landen.
const CALENDAR_SENDERS = /(calendar-notification@google\.com|calendar@google\.com|no-?reply@calendly\.com|notifications@cal\.com|noreply@cal\.com|@calendly\.com|@cal\.com)/i;
const BOOKING_SUBJECT = /(neuer termin|neue terminbuchung|terminbuchung|termin (wurde )?(gebucht|bestätigt|vereinbart)|hat (einen )?termin gebucht|new booking|booking confirmed|booked|appointment (scheduled|confirmed|booked)|new event|invitation:|einladung:|accepted:|angenommen:|neue buchung)/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export function isBookingMail(from: string, subject: string) {
  return CALENDAR_SENDERS.test(from) || BOOKING_SUBJECT.test(subject);
}

// Nur Treffer mit einem Lead zählen, dem wir wirklich geschrieben haben – das verhindert Fehlalarme bei fremden Einladungen.
export async function findBookedLead(from: string, subject: string, body: string, ownEmail: string) {
  const found = new Set((`${from} ${subject} ${body}`.match(EMAIL) || []).map((value) => value.toLowerCase()));
  found.delete(ownEmail.toLowerCase());
  const candidates = [...found].filter((value) => !CALENDAR_SENDERS.test(value) && !/^(mailer-daemon|postmaster|no-?reply)@/i.test(value));
  if (!candidates.length) return null;
  const rows = await query<{ id: string; company: string; email: string }>(
    `select l.id, co.name as company, lower(ct.email) as email
       from sales_leads l
       join sales_contacts ct on ct.id=l.contact_id
       join sales_companies co on co.id=l.company_id
      where l.workspace='default' and lower(ct.email)=any($1::text[])
        and exists (select 1 from er_outbox o where o.workspace='default' and o.lead_id=l.id and o.status in ('sent','stopped'))
      order by l.updated_at desc limit 1`,
    [candidates],
  );
  return rows[0] || null;
}

export async function recordBooking(messageId: string, subject: string, mailboxId: string, lead: { id: string; company: string; email: string }) {
  const existing = await query<{ id: number }>(
    "select id from er_events where workspace='default' and type='appointment' and (meta->>'providerMessageId'=$1 or lead_id=$2) limit 1",
    [messageId, lead.id],
  );
  if (existing.length) return false;
  await query("insert into er_events(workspace,lead_id,type,meta) values('default',$1,'appointment',$2::jsonb)", [
    lead.id,
    JSON.stringify({ providerMessageId: messageId, subject, mailboxId, email: lead.email, source: "calendar-mail" }),
  ]);
  await query("update er_outbox set status='stopped' where workspace='default' and lead_id=$1 and status='queued'", [lead.id]);
  await query(
    `update sales_leads set stage='Termin', probability=greatest(probability,55), last_outcome='appointment',
            next_action='Termin vorbereiten', last_contact_at=now(), updated_at=now()
      where id=$1 and workspace='default'`,
    [lead.id],
  );
  await query(
    `insert into sales_activities(workspace,lead_id,company_id,type,summary,meta)
     select workspace,id,company_id,'appointment.booked',$2::text,$3::jsonb from sales_leads where id=$1`,
    [lead.id, "Termin gebucht (automatisch erkannt)", JSON.stringify({ source: "calendar-mail", subject, messageId })],
  );
  await sendAlert(`📅 Neuer Termin: ${lead.company}\n${lead.email}\n${subject}`);
  // Für den Termin wird automatisch die Wettbewerbsanalyse (PDF) vorbereitet; Link kommt per Telegram.
  try {
    const pdf = await Promise.race([ensureAnalysisPdf(lead.id), new Promise<null>((resolve) => setTimeout(() => resolve(null), 100_000))]);
    await sendAlert(pdf ? `📄 Wettbewerbsanalyse für den Termin ist fertig: ${lead.company}\n${analysisUrl(lead.id)}` : `📄 Für ${lead.company} konnte keine Wettbewerbsanalyse erstellt werden (keine Website bekannt oder Zeitüberschreitung). Im Menü Leads über "Analyse" erneut versuchen.`);
  } catch { /* Termin ist gespeichert, die Analyse kann später im CRM erzeugt werden */ }
  return true;
}

export async function handleBookingMail(messageId: string, from: string, subject: string, body: string, mailbox: { id: string; email: string }) {
  if (!isBookingMail(from, subject)) return false;
  let lead = await findBookedLead(from, subject, body, mailbox.email);
  if (!lead) {
    // Buchte jemand mit anderer E-Mail-Adresse: Wenn genau ein Lead in den letzten 3 Stunden den Kalender angeklickt hat, ist es sehr wahrscheinlich dieser.
    const recent = await query<{ id: string; company: string; email: string }>(
      `select l.id::text id, c.name company, coalesce(k.email,'') email
       from sales_leads l join sales_companies c on c.id=l.company_id and c.workspace=l.workspace
       left join lateral (select email from sales_contacts k where k.company_id=c.id and k.workspace=l.workspace order by (coalesce(email,'')<>'') desc limit 1) k on true
       where l.workspace='default' and l.id::text in (
         select e.lead_id from er_events e where e.workspace='default' and e.type in ('video_calendar_focus','video_booking_click') and coalesce(e.meta->>'bot','false')='false' and e.created_at>now()-interval '3 hours')
         and not exists(select 1 from er_events a where a.workspace='default' and a.type='appointment' and a.lead_id=l.id::text)`,
    ).catch(() => []);
    if (recent.length === 1) lead = recent[0] as never;
  }
  if (!lead) return false;
  return recordBooking(messageId, subject, mailbox.id, lead);
}

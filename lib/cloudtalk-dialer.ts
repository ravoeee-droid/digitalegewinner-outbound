import { z } from "zod";
import { query } from "@/lib/db";

export const dgDialerCampaign = "378110";

export const dialerDisposition = z.object({
  event_id: z.string().uuid(),
  type: z.literal("dialer.disposition_created"),
  occurred_at: z.string().datetime({ offset: true }),
  data: z.object({
    call_uuid: z.string().uuid(),
    dialer: z.object({ campaign: z.object({ id: z.string() }) }),
    disposition: z.object({
      tag: z.object({ name: z.string().optional() }),
      notes: z.string().optional(),
      attempt_no: z.number().int().nonnegative().optional(),
      rescheduled_at: z.string().datetime({ offset: true }).optional(),
    }),
    contact: z.object({ id: z.string() }).optional(),
  }),
});

let inboxReady: Promise<unknown> | undefined;

export function ensureDialerInbox() {
  inboxReady ??= query(`
    create table if not exists dg_cloudtalk_dialer_inbox (
      id text primary key,
      call_uuid text not null unique,
      occurred_at timestamptz not null,
      contact_id text,
      tag text not null,
      note text not null,
      callback_at timestamptz,
      attempt integer,
      processed_at timestamptz
    );
    create index if not exists dg_cloudtalk_dialer_inbox_pending
      on dg_cloudtalk_dialer_inbox(occurred_at) where processed_at is null
  `).catch((error) => {
    inboxReady = undefined;
    throw error;
  });
  return inboxReady;
}

const employeesPattern = /(?<![\d.,–-])\b(?:ca\.?\s+|rund\s+|etwa\s+)?(\d{1,5})\s*(?:mitarbeitende[nr]?|mitarbeiter(?:innen)?|ma)\b/giu;
const openingsPattern = /\b(?:such(?:en|t)|benötig(?:en|t)|brauch(?:en|t))\s+(\d{1,4})\s+(?:examinierte\s+)?(?:pflegefachkr[aä]ft(?:e|en)?|fachkr[aä]ft(?:e|en)?|pfk)\b/giu;

function extractCount(note: string, pattern: RegExp) {
  const matches = [...note.matchAll(pattern)].filter((match) => {
    const before = note.slice(Math.max(0, match.index - 30), match.index);
    const after = note.slice(match.index + match[0].length).split(/[.;!\n]/, 1)[0];
    return !/(?:\d\s*(?:bis|[-–])\s*|[<>]\s*)$/iu.test(before) &&
      !/^\s+(?:nicht|keine?n?)\b/iu.test(after);
  });
  if (!matches.length || new Set(matches.map((match) => match[1])).size !== 1) return null;
  return { count: Number(matches[0][1]), evidence: matches[0][0] };
}

export function extractDialerStaffing(note: string) {
  return {
    employees: extractCount(note, employeesPattern),
    openSkilledPositions: extractCount(note, openingsPattern),
  };
}

type InboxRow = {
  id: string;
  call_uuid: string;
  occurred_at: string;
  contact_id: string | null;
  tag: string;
  note: string;
  callback_at: string | null;
  attempt: number | null;
};

export async function processDgDialerBatch() {
  await ensureDialerInbox();
  const pending = await query<InboxRow>(`
    select id,call_uuid,occurred_at,contact_id,tag,note,callback_at,attempt
    from dg_cloudtalk_dialer_inbox where processed_at is null
    order by occurred_at,id limit 500
  `);
  if (!pending.length) return { processed: 0, unmatched: 0 };

  const events = pending.map((event) => ({
    id: event.id,
    staffing: extractDialerStaffing(event.note),
    opportunity_id: crypto.randomUUID(),
  }));

  const [counts] = await query<{ processed: number; unmatched: number }>(`
    with incoming as (
      select i.*, input.staffing, input.opportunity_id
      from jsonb_to_recordset($1::jsonb) as input(id text, staffing jsonb, opportunity_id text)
      join dg_cloudtalk_dialer_inbox i on i.id=input.id
      where i.processed_at is null
      order by i.id for update of i
    ), matches as (
      select i.id,min(l.id) lead_id
      from incoming i
      join sales_activities a on a.workspace='default' and a.type='cloudtalk.sync'
        and a.meta->>'tag'='pflege-heute' and a.meta->>'cloudtalkContactId'=i.contact_id
      join sales_leads l on l.id=a.lead_id and l.workspace=a.workspace
      group by i.id having count(distinct l.id)=1
    ), logged as (
      insert into sales_activities(workspace,lead_id,company_id,type,summary,meta)
      select l.workspace,l.id,l.company_id,'cloudtalk.disposition',
        concat_ws(' · ', 'CloudTalk',nullif(i.tag,''),
          case when i.staffing->'employees'->>'count' is not null
            then 'Team: ' || (i.staffing->'employees'->>'evidence') end,
          case when i.staffing->'openSkilledPositions'->>'count' is not null
            then 'Bedarf: ' || (i.staffing->'openSkilledPositions'->>'evidence') end,
          nullif(left(i.note,240),'')),
        jsonb_build_object('eventId',i.id,'callUuid',i.call_uuid,'occurredAt',i.occurred_at,
          'tag',i.tag,'note',i.note,'callbackAt',i.callback_at,'attempt',i.attempt,'staffing',i.staffing)
      from incoming i join matches m on m.id=i.id join sales_leads l on l.id=m.lead_id
    ), latest as (
      select distinct on (m.lead_id) m.lead_id,i.*
      from incoming i join matches m on m.id=i.id
      order by m.lead_id,i.occurred_at desc,i.id desc
    ), stopped as (
      select distinct m.lead_id from incoming i join matches m on m.id=i.id
      where lower(trim(i.tag))='nicht mehr anrufen'
    ), info as (
      insert into sales_opportunities
        (id,workspace,lead_id,company_id,product_key,stage,status,source,probability,next_action,next_action_at)
      select i.opportunity_id,l.workspace,l.id,l.company_id,'pflege_recruiting','Info angefragt','open',
        'manual',25,'Gewünschte Info-Mail senden',now()
      from latest i join sales_leads l on l.id=i.lead_id
      where lower(trim(i.tag)) in ('info mail','info-mail') and l.status='active'
        and not coalesce(l.do_not_contact,false)
        and not exists (select 1 from stopped s where s.lead_id=l.id)
        and (l.last_contact_at is null or l.last_contact_at <= i.occurred_at)
      on conflict(workspace,lead_id,product_key) do update set
        stage=excluded.stage,source=excluded.source,
        probability=greatest(sales_opportunities.probability,excluded.probability),
        next_action=excluded.next_action,next_action_at=excluded.next_action_at,updated_at=now()
      where sales_opportunities.status='open'
        and sales_opportunities.stage in ('Neu','Geprüft','Call bereit','Kontaktiert','Nachfassen','Interesse')
      returning lead_id
    ), lead_updates as (
      update sales_leads l set
        do_not_contact=case when s.lead_id is not null then true else l.do_not_contact end,
        last_contact_at=greatest(l.last_contact_at,i.occurred_at),
        last_outcome=case when s.lead_id is not null then 'dnc'
          when f.lead_id is not null then 'info_mail'
          when i.callback_at is not null then 'callback' else l.last_outcome end,
        next_action=case when s.lead_id is not null then '' when f.lead_id is not null then 'Info-Mail senden'
          when i.callback_at is not null then 'Rückruf' else l.next_action end,
        next_action_at=case when s.lead_id is not null then null when f.lead_id is not null then now()
          when i.callback_at is not null then i.callback_at else l.next_action_at end,
        updated_at=now()
      from latest i left join info f on f.lead_id=i.lead_id left join stopped s on s.lead_id=i.lead_id
      where l.id=i.lead_id and (s.lead_id is not null or (
        l.status='active' and not coalesce(l.do_not_contact,false)
        and (l.last_contact_at is null or l.last_contact_at <= i.occurred_at)))
    ), done as (
      update dg_cloudtalk_dialer_inbox i set processed_at=now()
      from incoming batch where i.id=batch.id returning i.id
    )
    select (select count(*)::int from done) processed,
      (select count(*)::int from incoming i left join matches m on m.id=i.id where m.id is null) unmatched
  `, [JSON.stringify(events)]);
  return counts;
}

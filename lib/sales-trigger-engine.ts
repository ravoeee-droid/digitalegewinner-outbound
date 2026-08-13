import { query } from "./db";

let triggerSchemaReady = false;

export const SALES_TRIGGER_TYPES = [
  "microsite_view",
  "video_view",
  "cta_click",
  "reply",
  "positive_reply",
  "appointment",
  "appointment_attended",
] as const;

export type SalesTriggerType = (typeof SALES_TRIGGER_TYPES)[number];

type EventMeta = Record<string, unknown>;
type LeadContext = {
  id: string;
  company_id: string;
  stage: string;
  intent_score: number;
  fit_score: number;
  opportunity_score: number;
  priority_score: number;
  email: string;
  phone: string;
};

type LatestSignal = {
  type: SalesTriggerType;
  strength: number;
  meta: EventMeta;
  created_at: string;
} | null;

type RecommendedAction = {
  actionType: string;
  priority: number;
  reason: string;
  payload?: EventMeta;
};

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function asNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isTriggerType(value: string): value is SalesTriggerType {
  return (SALES_TRIGGER_TYPES as readonly string[]).includes(value);
}

function signalLabel(type: SalesTriggerType) {
  switch (type) {
    case "microsite_view": return "Microsite angesehen";
    case "video_view": return "Video angesehen";
    case "cta_click": return "CTA geklickt";
    case "reply": return "Antwort eingegangen";
    case "positive_reply": return "Positive Antwort";
    case "appointment": return "Termin gebucht";
    case "appointment_attended": return "Termin wahrgenommen";
  }
}

export function signalStrength(type: SalesTriggerType, meta: EventMeta = {}) {
  if (type === "microsite_view") return 12;
  if (type === "video_view") return clamp(10 + asNumber(meta.value) * 0.2);
  if (type === "cta_click") return 35;
  if (type === "reply") return 45;
  if (type === "positive_reply") return 70;
  if (type === "appointment") return 80;
  return 95;
}

export async function ensureSalesTriggerSchema() {
  if (triggerSchemaReady) return;
  await query(`
    alter table sales_leads add column if not exists trigger_score integer not null default 0;
    alter table sales_leads add column if not exists last_signal_at timestamptz;

    create table if not exists sales_signals (
      id text primary key,
      workspace text not null,
      lead_id text not null references sales_leads(id) on delete cascade,
      company_id text not null references sales_companies(id) on delete cascade,
      source_event_id bigint,
      type text not null,
      strength integer not null default 0,
      summary text not null default '',
      meta jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );
    create unique index if not exists sales_signals_source_event_idx
      on sales_signals(workspace, source_event_id) where source_event_id is not null;
    create index if not exists sales_signals_lead_idx
      on sales_signals(workspace, lead_id, created_at desc);

    create table if not exists sales_next_actions (
      id text primary key,
      workspace text not null,
      lead_id text not null references sales_leads(id) on delete cascade,
      company_id text not null references sales_companies(id) on delete cascade,
      action_type text not null,
      priority integer not null default 0,
      reason text not null default '',
      payload jsonb not null default '{}'::jsonb,
      status text not null default 'open',
      due_at timestamptz not null default now(),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create unique index if not exists sales_next_actions_one_open_idx
      on sales_next_actions(workspace, lead_id) where status='open';
    create index if not exists sales_next_actions_queue_idx
      on sales_next_actions(workspace, status, priority desc, due_at asc);

    alter table sales_signals enable row level security;
    alter table sales_next_actions enable row level security;
    revoke all on table sales_signals from anon, authenticated;
    revoke all on table sales_next_actions from anon, authenticated;
    drop policy if exists sales_signals_deny_client on sales_signals;
    create policy sales_signals_deny_client on sales_signals for all to anon, authenticated using (false) with check (false);
    drop policy if exists sales_next_actions_deny_client on sales_next_actions;
    create policy sales_next_actions_deny_client on sales_next_actions for all to anon, authenticated using (false) with check (false);
  `);
  triggerSchemaReady = true;
}

async function getLeadContext(leadId: string, workspace: string) {
  const rows = await query<LeadContext>(
    `select l.id,l.company_id,l.stage,l.intent_score,l.fit_score,l.opportunity_score,l.priority_score,
            coalesce(ct.email,'') as email,coalesce(ct.phone,c.phone,'') as phone
     from sales_leads l
     join sales_companies c on c.id=l.company_id
     left join sales_contacts ct on ct.id=l.contact_id
     where l.workspace=$1 and l.id=$2 and l.status='active' limit 1`,
    [workspace, leadId],
  );
  return rows[0] || null;
}

async function latestSignalForLead(leadId: string, workspace: string): Promise<LatestSignal> {
  const rows = await query<{ type: string; strength: number; meta: EventMeta; created_at: string }>(
    `select type,strength,meta,created_at from sales_signals
     where workspace=$1 and lead_id=$2 order by created_at desc,id desc limit 1`,
    [workspace, leadId],
  );
  const row = rows[0];
  if (!row || !isTriggerType(row.type)) return null;
  return { ...row, type: row.type };
}

function recommendAction(lead: LeadContext, latest: LatestSignal, priorityScore: number): RecommendedAction {
  const hasPhone = Boolean(lead.phone.trim());
  const hasEmail = Boolean(lead.email.trim());
  const type = latest?.type;
  const progress = latest?.type === "video_view" ? asNumber(latest.meta.value) : 0;

  if (type === "appointment_attended") {
    return { actionType: "prepare_offer", priority: 100, reason: "Termin wurde wahrgenommen – Angebot und konkreten nächsten Schritt vorbereiten." };
  }
  if (type === "appointment") {
    return { actionType: "prepare_call", priority: 99, reason: "Termin gebucht – Gespräch personalisieren und Case/Analyse vorbereiten." };
  }
  if (type === "positive_reply" || type === "reply") {
    return { actionType: "reply_now", priority: 100, reason: "Lead hat geantwortet – Geschwindigkeit ist jetzt wichtiger als weiterer Automationsversand." };
  }
  if (type === "cta_click") {
    return hasPhone
      ? { actionType: "call_now", priority: 98, reason: "CTA geklickt und Telefonnummer vorhanden – heißester Zeitpunkt für einen persönlichen Anruf." }
      : { actionType: "personal_followup", priority: 96, reason: "CTA geklickt – sofort persönliches Follow-up senden." };
  }
  if (type === "video_view" && progress >= 60) {
    return hasPhone
      ? { actionType: "call_now", priority: 94, reason: `Video zu ${Math.round(progress)} % angesehen – hohes Interesse, jetzt persönlich anrufen.` }
      : { actionType: "personal_followup", priority: 91, reason: `Video zu ${Math.round(progress)} % angesehen – jetzt mit persönlichem Follow-up nachfassen.` };
  }
  if (type === "video_view") {
    return { actionType: "followup_after_video", priority: 86, reason: "Video angesehen – zeitnah mit Kontext aus der Analyse nachfassen." };
  }
  if (type === "microsite_view") {
    return { actionType: "followup_after_view", priority: 84, reason: "Personalisierte Microsite wurde geöffnet – Follow-up auslösen, bevor das Interesse abkühlt." };
  }
  if (priorityScore >= 80 && hasEmail) {
    return { actionType: "send_personalized_loom", priority: 82, reason: "Sehr hoher Research-Fit – personalisierte Analyse/Loom zuerst senden." };
  }
  if (priorityScore >= 72 && hasPhone) {
    return { actionType: "call_first", priority: 78, reason: "Hohe Priorität und Telefonnummer vorhanden – Lead persönlich qualifizieren." };
  }
  if (priorityScore >= 65 && hasEmail) {
    return { actionType: "send_personalized_loom", priority: 74, reason: "Guter Fit mit erreichbarer E-Mail – personalisierte Analyse in die Outreach-Sequenz geben." };
  }
  return { actionType: "research_more", priority: 55, reason: "Noch zu wenig Kaufsignal oder Kontaktierbarkeit – Daten anreichern, bevor Outreach startet." };
}

async function upsertNextAction(lead: LeadContext, workspace: string, action: RecommendedAction) {
  const existing = await query<{ id: string; action_type: string; reason: string }>(
    `select id,action_type,reason from sales_next_actions
     where workspace=$1 and lead_id=$2 and status='open' limit 1`,
    [workspace, lead.id],
  );
  const current = existing[0];
  const changed = !current || current.action_type !== action.actionType || current.reason !== action.reason;

  if (current) {
    await query(
      `update sales_next_actions set action_type=$3,priority=$4,reason=$5,payload=$6::jsonb,due_at=now(),updated_at=now()
       where workspace=$1 and id=$2`,
      [workspace, current.id, action.actionType, action.priority, action.reason, JSON.stringify(action.payload || {})],
    );
  } else {
    await query(
      `insert into sales_next_actions(id,workspace,lead_id,company_id,action_type,priority,reason,payload)
       values($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
       on conflict(workspace,lead_id) where status='open'
       do update set action_type=excluded.action_type,priority=excluded.priority,reason=excluded.reason,payload=excluded.payload,due_at=now(),updated_at=now()`,
      [crypto.randomUUID(), workspace, lead.id, lead.company_id, action.actionType, action.priority, action.reason, JSON.stringify(action.payload || {})],
    );
  }

  if (changed) {
    await query(
      `insert into sales_activities(workspace,lead_id,company_id,type,summary,meta)
       values($1,$2,$3,'trigger.action',$4,$5::jsonb)`,
      [workspace, lead.id, lead.company_id, `Nächste Aktion: ${action.actionType}`, JSON.stringify({ priority: action.priority, reason: action.reason })],
    );
  }
}

function nextStage(current: string, latest: LatestSignal) {
  const type = latest?.type;
  if (type === "appointment_attended") return "Qualifiziert";
  if (type === "appointment") return "Termin";
  if (["reply", "positive_reply", "cta_click"].includes(type || "") && ["Neu", "Kontaktiert"].includes(current)) return "Engaged";
  return current;
}

export async function refreshSalesNextAction(leadId: string, workspace = "default") {
  await ensureSalesTriggerSchema();
  const lead = await getLeadContext(leadId, workspace);
  if (!lead) return { ok: false, reason: "lead_not_found" as const };

  const [aggregate] = await query<{ trigger_score: number; last_signal_at: string | null }>(
    `select coalesce(sum(
       case
         when created_at >= now()-interval '2 days' then strength
         when created_at >= now()-interval '7 days' then round(strength*0.70)
         else round(strength*0.35)
       end
     ),0)::int as trigger_score,max(created_at) as last_signal_at
     from sales_signals where workspace=$1 and lead_id=$2 and created_at>=now()-interval '30 days'`,
    [workspace, leadId],
  );
  const latest = await latestSignalForLead(leadId, workspace);
  const triggerScore = clamp(aggregate?.trigger_score || 0);
  const intentScore = Math.max(lead.intent_score, triggerScore);
  const contactability = lead.email && lead.phone ? 100 : lead.email || lead.phone ? 70 : 10;
  const calculatedPriority = clamp(lead.opportunity_score * 0.34 + lead.fit_score * 0.24 + contactability * 0.10 + intentScore * 0.32);
  const priorityScore = Math.max(lead.priority_score, calculatedPriority);
  const stage = nextStage(lead.stage, latest);

  await query(
    `update sales_leads set trigger_score=$3,intent_score=$4,priority_score=$5,last_signal_at=$6,stage=$7,updated_at=now()
     where workspace=$1 and id=$2`,
    [workspace, leadId, triggerScore, intentScore, priorityScore, aggregate?.last_signal_at || null, stage],
  );

  const updatedLead = { ...lead, stage, intent_score: intentScore, priority_score: priorityScore };
  const action = recommendAction(updatedLead, latest, priorityScore);
  await upsertNextAction(updatedLead, workspace, action);

  return { ok: true, leadId, triggerScore, intentScore, priorityScore, stage, latestSignal: latest, nextAction: action };
}

export async function processSalesEvent(input: { eventId?: number; leadId: string; type: string; meta?: EventMeta }, workspace = "default") {
  if (!isTriggerType(input.type)) return { ok: false, reason: "ignored_event" as const };
  await ensureSalesTriggerSchema();
  const lead = await getLeadContext(input.leadId, workspace);
  if (!lead) return { ok: false, reason: "lead_not_found" as const };

  const strength = signalStrength(input.type, input.meta || {});
  const inserted = await query<{ id: string }>(
    `insert into sales_signals(id,workspace,lead_id,company_id,source_event_id,type,strength,summary,meta)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
     on conflict do nothing returning id`,
    [crypto.randomUUID(), workspace, lead.id, lead.company_id, input.eventId ?? null, input.type, strength, signalLabel(input.type), JSON.stringify(input.meta || {})],
  );

  if (inserted.length) {
    await query(
      `insert into sales_activities(workspace,lead_id,company_id,type,summary,meta)
       values($1,$2,$3,'trigger.signal',$4,$5::jsonb)`,
      [workspace, lead.id, lead.company_id, `${signalLabel(input.type)} · +${strength} Intent`, JSON.stringify({ sourceEventId: input.eventId ?? null, triggerType: input.type, strength })],
    );
  }

  return refreshSalesNextAction(lead.id, workspace);
}

export async function refreshSalesQueue(workspace = "default", limit = 40) {
  await ensureSalesTriggerSchema();
  const rows = await query<{ id: string }>(
    `select id from sales_leads
     where workspace=$1 and status='active'
     order by priority_score desc,updated_at desc limit $2`,
    [workspace, Math.max(1, Math.min(200, limit))],
  );
  let refreshed = 0;
  for (const row of rows) {
    const result = await refreshSalesNextAction(row.id, workspace);
    if (result.ok) refreshed++;
  }
  return refreshed;
}

export async function reconcileSalesTriggers(workspace = "default", limit = 200) {
  await ensureSalesTriggerSchema();
  const capped = Math.max(1, Math.min(500, limit));
  const events = await query<{ id: number; lead_id: string; type: string; meta: EventMeta }>(
    `select e.id,e.lead_id,e.type,e.meta
     from er_events e
     join sales_leads l on l.workspace=e.workspace and l.id=e.lead_id and l.status='active'
     left join sales_signals s on s.workspace=e.workspace and s.source_event_id=e.id
     where e.workspace=$1 and e.lead_id is not null and e.type=any($2::text[]) and s.id is null
     order by e.id asc limit $3`,
    [workspace, [...SALES_TRIGGER_TYPES], capped],
  );

  let processed = 0;
  for (const event of events) {
    const result = await processSalesEvent({ eventId: event.id, leadId: event.lead_id, type: event.type, meta: event.meta || {} }, workspace);
    if (result.ok) processed++;
  }
  const refreshedActions = await refreshSalesQueue(workspace, 40);
  return { scanned: events.length, processed, refreshedActions };
}

export async function getSalesTriggerSnapshots(workspace = "default") {
  await ensureSalesTriggerSchema();
  return query<{
    lead_id: string;
    trigger_score: number;
    last_signal_at: string | null;
    next_action: string;
    next_action_priority: number;
    next_action_reason: string;
    next_action_due_at: string | null;
  }>(
    `select l.id as lead_id,l.trigger_score,l.last_signal_at,
            coalesce(a.action_type,'') as next_action,coalesce(a.priority,0)::int as next_action_priority,
            coalesce(a.reason,'') as next_action_reason,a.due_at as next_action_due_at
     from sales_leads l
     left join lateral (
       select action_type,priority,reason,due_at from sales_next_actions
       where workspace=l.workspace and lead_id=l.id and status='open'
       order by priority desc,updated_at desc limit 1
     ) a on true
     where l.workspace=$1 and l.status='active'
     order by l.priority_score desc,l.updated_at desc limit 100`,
    [workspace],
  );
}

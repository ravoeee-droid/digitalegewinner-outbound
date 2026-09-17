import { z } from "zod";
import { query, readState, writeState } from "@/lib/db";
import { getCallSummary } from "@/lib/telephony";
import { ensureSalesOsSchema } from "@/lib/sales-os";

export const runtime = "nodejs";

const stages = ["Neu", "Research", "Bereit", "Kontaktiert", "Engaged", "Qualifiziert", "Termin", "Angebot", "Verhandlung", "Gewonnen", "Verloren", "Wiedervorlage"] as const;
const stageSchema = z.enum(stages);

const patchSchema = z.object({
  leadId: z.string().min(1).max(220),
  stage: stageSchema.optional(),
  outcome: z.string().max(120).optional().default(""),
  notesAppend: z.string().max(5000).optional().default(""),
  notes: z.string().max(12000).optional(),
  dealValue: z.number().min(0).max(10_000_000).optional(),
  probability: z.number().int().min(0).max(100).optional(),
  callbackAt: z.string().max(120).optional().default(""),
  nextAction: z.string().max(500).optional(),
  nextActionAt: z.string().max(120).optional().nullable(),
  expectedCloseDate: z.string().max(32).optional().nullable(),
  lostReason: z.string().max(300).optional(),
  doNotContact: z.boolean().optional(),
  phoneStatus: z.enum(["ready", "verify", "invalid"]).optional(),
});

const createSchema = z.object({
  company: z.string().min(1).max(300),
  contact: z.string().max(300).optional().default(""),
  email: z.string().max(500).optional().default(""),
  phone: z.string().max(120).optional().default(""),
  website: z.string().max(800).optional().default(""),
  city: z.string().max(300).optional().default(""),
  industry: z.string().max(300).optional().default("Pflege"),
  notes: z.string().max(5000).optional().default(""),
  stage: stageSchema.optional().default("Neu"),
  dealValue: z.number().min(0).max(10_000_000).optional().default(0),
});

const deleteSchema = z.object({ leadId: z.string().min(1).max(220) });

type LaunchLead = {
  id: string;
  company: string;
  contact: string;
  city: string;
  industry: string;
  website: string;
  email: string;
  phone: string;
  stage: string;
  deal_value: number;
  notes: string;
  priority_score: number;
  fit_score: number;
  opportunity_score: number;
  intent_score: number;
  website_score: number;
  metadata: Record<string, unknown>;
  last_call_at: string | null;
  last_outcome: string;
  next_action: string;
  next_action_at: string | null;
  do_not_contact: boolean;
  probability: number;
  expected_close_date: string | null;
  lost_reason: string;
  last_contact_at: string | null;
  phone_status: string;
  updated_at: string;
};

type LegacyState = {
  leads?: Array<Record<string, unknown>>;
  campaigns?: unknown[];
  mailboxes?: unknown[];
  settings?: Record<string, unknown>;
  [key: string]: unknown;
};

const pflegeFilter = `(lower(coalesce(c.industry,'')) like '%pflege%' or lower(c.name) like '%pflege%' or c.source like 'pflege%' or coalesce(c.metadata->>'campaign','') like 'pflege%')`;

function parseDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function legacyFromLead(lead: LaunchLead) {
  return {
    id: lead.id,
    company: lead.company,
    contact: lead.contact,
    email: lead.email,
    phone: lead.phone,
    website: lead.website,
    city: lead.city,
    industry: lead.industry || "Pflege",
    stage: lead.stage,
    dealValue: Number(lead.deal_value || 0),
    notes: lead.notes || "",
    intentScore: Number(lead.intent_score || 0),
    websiteScore: Number(lead.website_score || 0),
    nextAction: lead.next_action,
    nextActionAt: lead.next_action_at,
    probability: lead.probability,
  };
}

async function loadLeads(workspace: string) {
  return query<LaunchLead>(
    `select l.id,c.name as company,coalesce(ct.name,'') as contact,c.city,c.industry,c.website,
            coalesce(ct.email,'') as email,coalesce(ct.phone,c.phone,'') as phone,l.stage,
            l.deal_value::float8 as deal_value,l.notes,l.priority_score,l.fit_score,l.opportunity_score,l.intent_score,
            coalesce(rr.website_score,0)::int as website_score,
            case
              when l.do_not_contact then c.metadata || '{"phone_ready":false,"queue_reason":"do_not_contact"}'::jsonb
              when l.phone_status='invalid' then c.metadata || '{"phone_ready":false,"queue_reason":"invalid_phone"}'::jsonb
              when (c.metadata->>'phone_ready')='false' then c.metadata
              when l.stage in ('Termin','Angebot','Verhandlung','Gewonnen','Verloren') then c.metadata || '{"phone_ready":false,"queue_reason":"pipeline_stage"}'::jsonb
              when l.last_contact_at>=date_trunc('day',now()) and l.last_outcome not in ('Rückruf','Nicht erreicht','') then c.metadata || '{"phone_ready":false,"today_done":true}'::jsonb
              else c.metadata
            end as metadata,
            coalesce(call_activity.created_at,l.last_contact_at,latest_call.started_at) as last_call_at,
            coalesce(nullif(l.last_outcome,''),call_activity.meta->>'outcome','') as last_outcome,
            l.next_action,l.next_action_at,l.do_not_contact,l.probability,l.expected_close_date,l.lost_reason,
            l.last_contact_at,l.phone_status,l.updated_at
     from sales_leads l
     join sales_companies c on c.id=l.company_id
     left join sales_contacts ct on ct.id=l.contact_id
     left join lateral (
       select website_score from sales_research_runs r where r.company_id=l.company_id order by r.created_at desc limit 1
     ) rr on true
     left join lateral (
       select created_at,meta from sales_activities a
       where a.workspace=l.workspace and a.lead_id=l.id and a.type='call.outcome'
       order by a.created_at desc limit 1
     ) call_activity on true
     left join lateral (
       select started_at from sales_calls sc where sc.workspace=l.workspace and sc.lead_ref=l.id order by sc.created_at desc limit 1
     ) latest_call on true
     where l.workspace=$1 and l.status='active' and ${pflegeFilter}
     order by
       case when l.do_not_contact or l.phone_status='invalid' or (c.metadata->>'phone_ready')='false' then 1 else 0 end,
       case when l.next_action_at is not null and l.next_action_at<=now() then 0 else 1 end,
       l.priority_score desc,
       nullif(c.metadata->>'call_order','')::int nulls last,
       l.updated_at desc
     limit 750`,
    [workspace],
  );
}

async function mirrorToLegacy(leads: LaunchLead[]) {
  const row = await readState();
  const state = (row?.payload || {}) as LegacyState;
  const existing = Array.isArray(state.leads) ? state.leads : [];
  const map = new Map(existing.map((lead) => [String(lead.id || ""), lead]));
  let changed = false;
  for (const lead of leads) {
    const previous = map.get(lead.id) || {};
    const next = { ...previous, ...legacyFromLead(lead) };
    if (!map.has(lead.id) || JSON.stringify(previous) !== JSON.stringify(next)) changed = true;
    map.set(lead.id, next);
  }
  if (changed) await writeState({ ...state, leads: [...map.values()] });
}

function outcomeUpdates(outcome: string, callbackAt: string) {
  const normalized = outcome.trim();
  const callback = parseDate(callbackAt);
  if (normalized === "Nicht erreicht") return { stage: "Kontaktiert", probability: 10, nextAction: "Erneut anrufen", nextActionAt: callback, lostReason: "", phoneStatus: "ready", dnc: false };
  if (normalized === "Erreicht") return { stage: "Kontaktiert", probability: 20, nextAction: "Bedarf qualifizieren", nextActionAt: null, lostReason: "", phoneStatus: "ready", dnc: false };
  if (normalized === "Interesse") return { stage: "Engaged", probability: 35, nextAction: "Analyse / Termin nachfassen", nextActionAt: null, lostReason: "", phoneStatus: "ready", dnc: false };
  if (normalized === "Termin") return { stage: "Termin", probability: 55, nextAction: "Termin vorbereiten", nextActionAt: callback, lostReason: "", phoneStatus: "ready", dnc: false };
  if (normalized === "Angebot senden") return { stage: "Angebot", probability: 65, nextAction: "Angebot senden", nextActionAt: callback, lostReason: "", phoneStatus: "ready", dnc: false };
  if (normalized === "Rückruf") return { stage: "Wiedervorlage", probability: 25, nextAction: "Rückruf", nextActionAt: callback, lostReason: "", phoneStatus: "ready", dnc: false };
  if (normalized === "Kein Interesse") return { stage: "Verloren", probability: 0, nextAction: "", nextActionAt: null, lostReason: "Kein Interesse", phoneStatus: "ready", dnc: true };
  if (normalized === "Falsche Nummer") return { stage: "Kontaktiert", probability: 5, nextAction: "Telefonnummer verifizieren", nextActionAt: null, lostReason: "", phoneStatus: "invalid", dnc: true };
  return null;
}

async function loadPayload(workspace: string) {
  await ensureSalesOsSchema();
  const leads = await loadLeads(workspace);
  await mirrorToLegacy(leads);

  const [stats] = await query<{ companies: number; leads: number; hot: number; appointments: number; won: number; pipeline: number; weighted_pipeline: number; due_actions: number }>(
    `select
      count(distinct c.id)::int companies,
      count(*)::int leads,
      count(*) filter(where l.priority_score>=70 and l.stage not in ('Gewonnen','Verloren'))::int hot,
      count(*) filter(where l.stage='Termin')::int appointments,
      count(*) filter(where l.stage='Gewonnen')::int won,
      coalesce(sum(l.deal_value) filter(where l.stage not in ('Gewonnen','Verloren')),0)::float8 pipeline,
      coalesce(sum(l.deal_value*l.probability/100.0) filter(where l.stage not in ('Gewonnen','Verloren')),0)::float8 weighted_pipeline,
      count(*) filter(where l.next_action_at is not null and l.next_action_at<=now() and l.stage not in ('Gewonnen','Verloren'))::int due_actions
     from sales_leads l join sales_companies c on c.id=l.company_id
     where l.workspace=$1 and l.status='active' and ${pflegeFilter}`,
    [workspace],
  );

  const activities = await query<{ id: number; lead_id: string; type: string; summary: string; meta: Record<string, unknown>; created_at: string }>(
    `select a.id,coalesce(a.lead_id,'') lead_id,a.type,a.summary,a.meta,a.created_at
     from sales_activities a
     where a.workspace=$1 and (
       a.lead_id is null or a.lead_id='' or a.lead_id in (
         select l.id from sales_leads l join sales_companies c on c.id=l.company_id
         where l.workspace=$1 and l.status='active' and ${pflegeFilter}
       )
     ) order by a.created_at desc limit 150`,
    [workspace],
  );

  const callHistory = await query<{ id: number; lead_ref: string; company: string; direction: string; status: string; external_number: string; started_at: string | null; answered_at: string | null; ended_at: string | null; duration_seconds: number; raw_payload: Record<string, unknown> }>(
    `select id,lead_ref,company,direction,status,external_number,started_at,answered_at,ended_at,duration_seconds,raw_payload
     from sales_calls where workspace=$1 order by coalesce(started_at,created_at) desc limit 250`,
    [workspace],
  );

  const [outcomeStats] = await query<{ today: number; connected: number; meetings: number; interested: number }>(
    `select count(*)::int today,
      count(*) filter(where coalesce(meta->>'outcome','') not in ('Nicht erreicht','Falsche Nummer',''))::int connected,
      count(*) filter(where meta->>'outcome'='Termin')::int meetings,
      count(*) filter(where meta->>'outcome' in ('Interesse','Termin','Angebot senden'))::int interested
     from sales_activities where workspace=$1 and type='call.outcome' and created_at>=date_trunc('day',now())`,
    [workspace],
  );
  const telephony = await getCallSummary(workspace);
  const calls = {
    today: Math.max(Number(outcomeStats?.today || 0), Number(telephony.today || 0)),
    connected: Math.max(Number(outcomeStats?.connected || 0), Number(telephony.connected || 0)),
    meetings: Number(outcomeStats?.meetings || 0),
    interested: Number(outcomeStats?.interested || 0),
    talk_seconds: Number(telephony.talk_seconds || 0),
    history: callHistory,
  };

  const stateRow = await readState(workspace);
  const state = (stateRow?.payload || {}) as LegacyState;
  const campaigns = Array.isArray(state.campaigns) ? state.campaigns : [];
  const mailboxes = Array.isArray(state.mailboxes) ? state.mailboxes : [];

  // store.campaigns (the legacy JSON mirror) only ever gets a campaign's sent/replies/
  // positive/appointments counters set to 0 at creation - nothing increments them
  // afterward, so the Campaigns table showed permanent zeros. Compute the real numbers
  // from er_outbox/er_events on every load instead of trying to keep another counter in sync.
  const campaignStatsRows = await query<{ campaign_id: string; sent: number; replies: number; positive: number; appointments: number }>(
    `with outbox_leads as (
       select distinct campaign_id, lead_id from er_outbox where workspace=$1 and campaign_id is not null
     ),
     sent_counts as (
       select campaign_id, count(*)::int as sent from er_outbox
       where workspace=$1 and campaign_id is not null and status='sent' group by campaign_id
     ),
     event_counts as (
       select ol.campaign_id,
         count(distinct e.lead_id) filter (where e.type in ('reply','positive_reply'))::int as replies,
         count(distinct e.lead_id) filter (where e.type='positive_reply')::int as positive,
         count(distinct e.lead_id) filter (where e.type='appointment')::int as appointments
       from outbox_leads ol
       join er_events e on e.workspace=$1 and e.lead_id=ol.lead_id
       group by ol.campaign_id
     )
     select coalesce(s.campaign_id,ec.campaign_id) as campaign_id,
       coalesce(s.sent,0) as sent, coalesce(ec.replies,0) as replies,
       coalesce(ec.positive,0) as positive, coalesce(ec.appointments,0) as appointments
     from sent_counts s full outer join event_counts ec on ec.campaign_id=s.campaign_id`,
    [workspace],
  );
  const campaignStats = Object.fromEntries(campaignStatsRows.map((row) => [row.campaign_id, { sent: row.sent, replies: row.replies, positive: row.positive, appointments: row.appointments }]));

  // Per-variant breakdown (A/B subject-line tests) - only meaningful where a campaign
  // step actually defines variants, but cheap enough to always compute.
  const variantRows = await query<{ campaign_id: string; variant: string; sent: number; replies: number }>(
    `with variant_sent as (
       select campaign_id, variant, count(*)::int as sent from er_outbox
       where workspace=$1 and campaign_id is not null and status='sent' group by campaign_id, variant
     ),
     variant_leads as (
       select distinct campaign_id, variant, lead_id from er_outbox where workspace=$1 and campaign_id is not null
     ),
     variant_replies as (
       select vl.campaign_id, vl.variant, count(distinct e.lead_id)::int as replies
       from variant_leads vl
       join er_events e on e.workspace=$1 and e.lead_id=vl.lead_id and e.type in ('reply','positive_reply')
       group by vl.campaign_id, vl.variant
     )
     select coalesce(vs.campaign_id,vr.campaign_id) as campaign_id, coalesce(vs.variant,vr.variant) as variant,
       coalesce(vs.sent,0) as sent, coalesce(vr.replies,0) as replies
     from variant_sent vs full outer join variant_replies vr on vr.campaign_id=vs.campaign_id and vr.variant=vs.variant`,
    [workspace],
  );
  const campaignVariantStats: Record<string, Array<{ variant: string; sent: number; replies: number }>> = {};
  for (const row of variantRows) (campaignVariantStats[row.campaign_id] ||= []).push({ variant: row.variant, sent: row.sent, replies: row.replies });

  return {
    stats: stats || { companies: 0, leads: 0, hot: 0, appointments: 0, won: 0, pipeline: 0, weighted_pipeline: 0, due_actions: 0 },
    leads,
    activities,
    calls,
    campaignStats,
    campaignVariantStats,
    system: { campaigns: campaigns.length, mailboxes: mailboxes.length, activeMailboxes: mailboxes.filter((mailbox) => Boolean((mailbox as Record<string, unknown>).enabled)).length },
  };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const workspace = url.searchParams.get("workspace") || "default";
    return Response.json(await loadPayload(workspace));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "CRM konnte nicht geladen werden." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    await ensureSalesOsSchema();
    const input = createSchema.parse(await request.json());
    const companyId = crypto.randomUUID();
    const contactId = crypto.randomUUID();
    const leadId = crypto.randomUUID();
    const website = input.website.trim();
    let domain = "";
    try { domain = website ? new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`).hostname.replace(/^www\./, "") : ""; } catch {}

    await query(
      `insert into sales_companies(id,workspace,name,domain,website,city,industry,phone,source,source_id,research_status,latest_score,metadata)
       values($1,'default',$2,$3,$4,$5,$6,$7,'pflege-manual',$8,'pending',50,$9::jsonb)`,
      [companyId, input.company.trim(), domain, website, input.city.trim(), input.industry.trim() || "Pflege", input.phone.trim(), leadId, JSON.stringify({ campaign: "pflege-manual", phone_ready: Boolean(input.phone.trim()) })],
    );
    await query(
      `insert into sales_contacts(id,workspace,company_id,name,email,phone,is_primary,source)
       values($1,'default',$2,$3,$4,$5,true,'manual')`,
      [contactId, companyId, input.contact.trim(), input.email.trim().toLowerCase(), input.phone.trim()],
    );
    await query(
      `insert into sales_leads(id,workspace,company_id,contact_id,stage,status,deal_value,fit_score,opportunity_score,priority_score,notes,probability,next_action)
       values($1,'default',$2,$3,$4,'active',$5,50,50,50,$6,$7,'Erstkontakt')`,
      [leadId, companyId, contactId, input.stage, input.dealValue, input.notes.trim(), input.stage === "Neu" ? 10 : 20],
    );
    await query(
      `insert into sales_activities(workspace,lead_id,company_id,type,summary,meta) values('default',$1,$2,'lead.created',$3,$4::jsonb)`,
      [leadId, companyId, `Lead manuell angelegt: ${input.company}`, JSON.stringify({ source: "pflege-crm" })],
    );
    const payload = await loadPayload("default");
    return Response.json({ ok: true, leadId, ...payload }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Lead konnte nicht angelegt werden." }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    await ensureSalesOsSchema();
    const input = patchSchema.parse(await request.json());
    const [existing] = await query<{ company_id: string; notes: string; stage: string; probability: number; phone_status: string }>(
      "select company_id,notes,stage,probability,phone_status from sales_leads where id=$1 and workspace='default' and status='active' limit 1",
      [input.leadId],
    );
    if (!existing) return Response.json({ error: "Lead nicht gefunden." }, { status: 404 });

    const outcome = outcomeUpdates(input.outcome, input.callbackAt);
    const nextStage = input.stage || (outcome?.stage as typeof stages[number] | undefined) || null;
    const notes = input.notes !== undefined ? input.notes.trim() : [existing.notes || "", input.notesAppend.trim()].filter(Boolean).join("\n");
    const nextActionAt = input.nextActionAt !== undefined ? parseDate(input.nextActionAt) : outcome?.nextActionAt ?? undefined;
    const expectedCloseDate = input.expectedCloseDate === undefined ? undefined : input.expectedCloseDate || null;
    const probability = input.probability ?? outcome?.probability ?? undefined;
    const nextAction = input.nextAction ?? outcome?.nextAction ?? undefined;
    const lostReason = input.lostReason ?? outcome?.lostReason ?? undefined;
    const doNotContact = input.doNotContact ?? outcome?.dnc ?? undefined;
    const phoneStatus = input.phoneStatus ?? outcome?.phoneStatus ?? undefined;

    const rows = await query<{ id: string }>(
      `update sales_leads set
         stage=coalesce($2,stage), notes=$3, deal_value=coalesce($4,deal_value), probability=coalesce($5,probability),
         next_action=coalesce($6,next_action), next_action_at=case when $7::boolean then $8::timestamptz else next_action_at end,
         expected_close_date=case when $9::boolean then $10::date else expected_close_date end,
         lost_reason=coalesce($11,lost_reason), do_not_contact=coalesce($12,do_not_contact), phone_status=coalesce($13,phone_status),
         last_contact_at=case when $14 then now() else last_contact_at end,
         last_outcome=case when $14 then $15 else last_outcome end,
         updated_at=now()
       where id=$1 and workspace='default' and status='active' returning id`,
      [
        input.leadId, nextStage, notes, input.dealValue ?? null, probability ?? null, nextAction ?? null,
        nextActionAt !== undefined, nextActionAt ?? null,
        expectedCloseDate !== undefined, expectedCloseDate,
        lostReason ?? null, doNotContact ?? null, phoneStatus ?? null,
        Boolean(input.outcome), input.outcome,
      ],
    );
    if (!rows.length) return Response.json({ error: "Lead konnte nicht aktualisiert werden." }, { status: 409 });

    // Stage moved to closed, or the lead got marked do-not-contact: kill any
    // outbound sequence steps still queued for it right away instead of
    // waiting for the send cron to notice on its next run.
    if (nextStage === "Gewonnen" || nextStage === "Verloren" || doNotContact === true) {
      await query("update er_outbox set status='stopped' where workspace='default' and lead_id=$1 and status='queued'", [input.leadId]);
    }

    if (phoneStatus === "invalid" || input.outcome === "Falsche Nummer") {
      await query(
        `update sales_companies set metadata=metadata || $2::jsonb,updated_at=now() where id=$1`,
        [existing.company_id, JSON.stringify({ phone_ready: false, phone_verification: "manual_wrong_number" })],
      );
    }
    if (phoneStatus === "ready" && input.phoneStatus === "ready") {
      await query(
        `update sales_companies set metadata=(metadata - 'queue_reason') || $2::jsonb,updated_at=now() where id=$1`,
        [existing.company_id, JSON.stringify({ phone_ready: true, phone_verification: "manual_verified" })],
      );
    }

    const summary = input.outcome
      ? `Call-Ergebnis: ${input.outcome}${input.callbackAt ? ` · ${input.callbackAt}` : ""}`
      : nextStage && nextStage !== existing.stage
        ? `Pipeline: ${existing.stage} → ${nextStage}`
        : "Lead aktualisiert";
    await query(
      `insert into sales_activities(workspace,lead_id,company_id,type,summary,meta) values('default',$1,$2,$3,$4,$5::jsonb)`,
      [input.leadId, existing.company_id, input.outcome ? "call.outcome" : "lead.updated", summary, JSON.stringify({ ...input, stage: nextStage })],
    );

    return Response.json({ ok: true, ...(await loadPayload("default")) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Lead konnte nicht aktualisiert werden." }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    await ensureSalesOsSchema();
    const input = deleteSchema.parse(await request.json());
    const [existing] = await query<{ company_id: string }>("select company_id from sales_leads where id=$1 and workspace='default' and status='active' limit 1", [input.leadId]);
    if (!existing) return Response.json({ error: "Lead nicht gefunden." }, { status: 404 });
    await query("update sales_leads set status='archived',updated_at=now() where id=$1 and workspace='default'", [input.leadId]);
    await query(`insert into sales_activities(workspace,lead_id,company_id,type,summary) values('default',$1,$2,'lead.archived','Lead archiviert')`, [input.leadId, existing.company_id]);
    return Response.json({ ok: true, ...(await loadPayload("default")) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Lead konnte nicht archiviert werden." }, { status: 400 });
  }
}

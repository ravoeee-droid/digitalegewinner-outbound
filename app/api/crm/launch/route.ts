import { z } from "zod";
import { query, readState, writeState } from "@/lib/db";
import { getCallSummary } from "@/lib/telephony";

export const runtime = "nodejs";

const stages = ["Neu", "Kontaktiert", "Engaged", "Termin", "Angebot", "Gewonnen", "Verloren"] as const;
const patchSchema = z.object({
  leadId: z.string().min(1).max(220),
  stage: z.enum(stages).optional(),
  outcome: z.string().max(120).optional().default(""),
  notesAppend: z.string().max(2500).optional().default(""),
  dealValue: z.number().min(0).max(10_000_000).optional(),
  callbackAt: z.string().max(120).optional().default(""),
});

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
  };
}

async function loadLeads(workspace: string) {
  return query<LaunchLead>(
    `select l.id,c.name as company,coalesce(ct.name,'') as contact,c.city,c.industry,c.website,
            coalesce(ct.email,'') as email,coalesce(ct.phone,c.phone,'') as phone,l.stage,
            l.deal_value::float8 as deal_value,l.notes,l.priority_score,l.fit_score,l.opportunity_score,l.intent_score,
            coalesce(rr.website_score,0) as website_score,c.metadata,
            call_activity.created_at as last_call_at,coalesce(call_activity.meta->>'outcome','') as last_outcome,l.updated_at
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
     where l.workspace=$1 and l.status='active' and ${pflegeFilter}
     order by
       case when (c.metadata->>'phone_ready')='false' then 1 else 0 end,
       l.priority_score desc,
       nullif(c.metadata->>'call_order','')::int nulls last,
       l.updated_at desc
     limit 250`,
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
    if (!map.has(lead.id) || String(previous.stage || "") !== lead.stage || String(previous.phone || "") !== lead.phone || String(previous.email || "") !== lead.email || String(previous.notes || "") !== lead.notes) changed = true;
    map.set(lead.id, next);
  }

  if (changed) await writeState({ ...state, leads: [...map.values()] });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const workspace = url.searchParams.get("workspace") || "default";
    const leads = await loadLeads(workspace);
    await mirrorToLegacy(leads);

    const [stats] = await query<{ companies: number; leads: number; hot: number; appointments: number; won: number; pipeline: number }>(
      `select
        count(distinct c.id)::int companies,
        count(*)::int leads,
        count(*) filter(where l.priority_score>=70)::int hot,
        count(*) filter(where l.stage='Termin')::int appointments,
        count(*) filter(where l.stage='Gewonnen')::int won,
        coalesce(sum(l.deal_value) filter(where l.stage not in ('Gewonnen','Verloren')),0)::float8 pipeline
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
       )
       order by a.created_at desc limit 60`,
      [workspace],
    );
    const [outcomeStats] = await query<{ today: number; connected: number }>(
      `select
         count(*)::int today,
         count(*) filter(where coalesce(meta->>'outcome','') not in ('Nicht erreicht','Falsche Nummer',''))::int connected
       from sales_activities
       where workspace=$1 and type='call.outcome' and created_at>=date_trunc('day',now())`,
      [workspace],
    );
    const telephony = await getCallSummary(workspace);
    const calls = {
      today: Math.max(Number(outcomeStats?.today || 0), Number(telephony.today || 0)),
      connected: Math.max(Number(outcomeStats?.connected || 0), Number(telephony.connected || 0)),
      talk_seconds: Number(telephony.talk_seconds || 0),
    };
    return Response.json({ stats: stats || { companies: 0, leads: 0, hot: 0, appointments: 0, won: 0, pipeline: 0 }, leads, activities, calls });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Launch CRM konnte nicht geladen werden." }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  try {
    const input = patchSchema.parse(await request.json());
    const [existing] = await query<{ company_id: string; notes: string; stage: string }>(
      "select company_id,notes,stage from sales_leads where id=$1 and workspace='default' and status='active' limit 1",
      [input.leadId],
    );
    if (!existing) return Response.json({ error: "Lead nicht gefunden." }, { status: 404 });

    const notes = [existing.notes || "", input.notesAppend.trim()].filter(Boolean).join(" · ");
    const rows = await query<{ id: string }>(
      `update sales_leads set
         stage=coalesce($2,stage),
         notes=$3,
         deal_value=coalesce($4,deal_value),
         updated_at=now()
       where id=$1 and workspace='default' and status='active'
       returning id`,
      [input.leadId, input.stage ?? null, notes, input.dealValue ?? null],
    );
    if (!rows.length) return Response.json({ error: "Lead konnte nicht aktualisiert werden." }, { status: 409 });

    if (input.outcome === "Falsche Nummer") {
      await query(
        `update sales_companies set metadata=metadata || $2::jsonb,updated_at=now() where id=$1`,
        [existing.company_id, JSON.stringify({ phone_ready: false, phone_verification: "manual_wrong_number" })],
      );
    }

    const summary = input.outcome
      ? `Call-Ergebnis: ${input.outcome}${input.callbackAt ? ` · Rückruf ${input.callbackAt}` : ""}`
      : input.stage && input.stage !== existing.stage
        ? `Pipeline: ${existing.stage} → ${input.stage}`
        : "Lead aktualisiert";
    await query(
      `insert into sales_activities(workspace,lead_id,company_id,type,summary,meta)
       values('default',$1,$2,$3,$4,$5::jsonb)`,
      [input.leadId, existing.company_id, input.outcome ? "call.outcome" : "lead.updated", summary, JSON.stringify({ outcome: input.outcome, callbackAt: input.callbackAt, stage: input.stage, notesAppend: input.notesAppend })],
    );

    const refreshed = await loadLeads("default");
    await mirrorToLegacy(refreshed);
    return Response.json({ ok: true, lead: refreshed.find((lead) => lead.id === input.leadId) || null });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Lead konnte nicht aktualisiert werden." }, { status: 400 });
  }
}

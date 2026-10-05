import { z } from "zod";
import { cookies } from "next/headers";
import { adminCookieName, sessionRole } from "@/lib/admin-auth";
import { buildDailyOutboundPlan, getOutboundEngineSnapshot } from "@/lib/outbound-engine";
import { query } from "@/lib/db";
import { addProductOpportunity, updateRevenueOpportunity } from "@/lib/revenue-opportunities";
import { createWebsiteProjectFromLead } from "@/lib/website-projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const outcomeSchema = z.object({
  id: z.string().min(3),
  outcome: z.enum(["not_reached", "callback", "pain", "appointment", "no_fit", "dnc", "website_requested"]),
  note: z.string().max(4000).optional().default(""),
  opener: z.enum(["A", "B", "C", "D"]).optional().default("D"),
  callbackPreset: z.enum(["30m", "afternoon", "time"]).optional(),
  callbackTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
});

const postSchema = z.union([
  outcomeSchema,
  z.object({
    id: z.string().min(3),
    action: z.literal("extreme_hot"),
    value: z.boolean().optional().default(true),
  }),
]);


async function currentOwner() {
  const store = await cookies();
  const role = sessionRole(store.get(adminCookieName())?.value);
  return role === "sales" ? "Mattias" : "Raphael";
}

function ownerTasks(tasks: Array<{ channel: string; lead_id: string; payload: Record<string, unknown> }>, owner: string) {
  return tasks.filter((task) => task.channel === "call" && String(task.payload?.owner || "") === owner);
}

async function hydrateContacts<T extends { lead_id: string; payload: Record<string, unknown> }>(tasks: T[]) {
  const leadIds = [...new Set(tasks.map((task) => task.lead_id).filter(Boolean))];
  if (!leadIds.length) return tasks;
  const contacts = await query<{ lead_id: string; contact_name: string; contact_email: string; contact_phone: string; extreme_hot: boolean }>(`
    select l.id lead_id,coalesce(ct.name,'') contact_name,coalesce(ct.email,'') contact_email,
           coalesce(ct.phone,'') contact_phone,coalesce(l.extreme_hot,false) extreme_hot
    from sales_leads l
    left join sales_contacts ct on ct.id=l.contact_id
    where l.id=any($1::text[])
  `, [leadIds]);
  const byLead = new Map(contacts.map((row) => [row.lead_id, row]));
  return tasks.map((task) => {
    const contact = byLead.get(task.lead_id);
    if (!contact) return task;
    return {
      ...task,
      payload: {
        ...task.payload,
        contactName: String(task.payload?.contactName || contact.contact_name || ""),
        contactEmail: String(task.payload?.contactEmail || contact.contact_email || ""),
        contactPhone: String(task.payload?.contactPhone || contact.contact_phone || ""),
        extremeHot: contact.extreme_hot,
      },
    };
  });
}

export async function GET() {
  try {
    const snapshot = await buildDailyOutboundPlan();
    const owner = await currentOwner();
    const tasks = await hydrateContacts(ownerTasks(snapshot.tasks, owner));
    return Response.json({ date: snapshot.date, channels: snapshot.channels, owner, tasks });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Call Console konnte nicht geladen werden." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const input = postSchema.parse(await request.json());
    await buildDailyOutboundPlan();
    const taskRows = await query<{ lead_id: string; company_id: string }>(`select lead_id,company_id from sales_outbound_tasks where id=$1::text and channel='call' limit 1`, [input.id]);
    const task = taskRows[0];
    if (!task) return Response.json({ error: "Call-Task nicht gefunden." }, { status: 404 });

    if ("action" in input && input.action === "extreme_hot") {
      await query(`update sales_leads set extreme_hot=$2,updated_at=now() where id=$1`, [task.lead_id, input.value]);
      await query(
        `insert into sales_activities(workspace,lead_id,company_id,type,summary,meta)
         select workspace,id,company_id,'lead.extreme_hot',$2::text,jsonb_build_object('extremeHot',$3::boolean)
         from sales_leads where id=$1`,
        [task.lead_id, input.value ? "🔥 Extrem Hot markiert" : "Extrem Hot entfernt", input.value],
      );
      const snapshot = await getOutboundEngineSnapshot();
      const owner = await currentOwner();
      const tasks = await hydrateContacts(ownerTasks(snapshot.tasks, owner));
      return Response.json({ ok: true, owner, tasks, channels: snapshot.channels, extremeHot: input.value });
    }

    const outcomeInput = outcomeSchema.parse(input);

    let callbackAt: string | null = null;
    if (outcomeInput.outcome === "callback") {
      const preset = outcomeInput.callbackPreset || "30m";
      const rows = await query<{ callback_at: string }>(`
        select case
          when $1='30m' then (now() + interval '30 minutes')
          when $1='afternoon' then (
            case
              when (((now() at time zone 'Europe/Berlin')::date + time '15:00') at time zone 'Europe/Berlin') > now()
                then (((now() at time zone 'Europe/Berlin')::date + time '15:00') at time zone 'Europe/Berlin')
              else ((((now() at time zone 'Europe/Berlin')::date + 1 + time '15:00')) at time zone 'Europe/Berlin')
            end
          )
          else (
            case
              when (((now() at time zone 'Europe/Berlin')::date + coalesce(nullif($2,'')::time,time '09:00')) at time zone 'Europe/Berlin') > now()
                then (((now() at time zone 'Europe/Berlin')::date + coalesce(nullif($2,'')::time,time '09:00')) at time zone 'Europe/Berlin')
              else ((((now() at time zone 'Europe/Berlin')::date + 1 + coalesce(nullif($2,'')::time,time '09:00'))) at time zone 'Europe/Berlin')
            end
          )
        end as callback_at
      `, [preset, outcomeInput.callbackTime || ""]);
      callbackAt = rows[0]?.callback_at || null;
    }

    await query(
      `update sales_outbound_tasks
       set status=$5,
           payload=payload || jsonb_build_object(
             'callOutcome',$2::text,
             'callNote',$3::text,
             'openerTest',$4::text,
             'callOutcomeAt',now()::text,
             'callbackAt',$6::text
           ),
           updated_at=now()
       where id=$1::text and channel='call'`,
      [input.id, outcomeInput.outcome, outcomeInput.note, outcomeInput.opener, outcomeInput.outcome === "callback" ? "callback" : "done", callbackAt || ""],
    );

    const dashboardOutcome =
      outcomeInput.outcome === "not_reached" ? "Nicht erreicht" :
      outcomeInput.outcome === "appointment" ? "Termin" :
      outcomeInput.outcome === "pain" || outcomeInput.outcome === "website_requested" ? "Interesse" :
      "Erreicht";

    await query(`
      insert into sales_activities(workspace,lead_id,company_id,type,summary,meta)
      select workspace,id,company_id,'revenue.outcome',$2::text,
             jsonb_build_object(
               'outcome',$3::text,
               'callOutcome',$4::text,
               'note',$5::text,
               'callbackAt',$6::text,
               'source','call-console'
             )
      from sales_leads where id=$1
    `, [
      task.lead_id,
      `Call · ${dashboardOutcome}`,
      dashboardOutcome,
      outcomeInput.outcome,
      outcomeInput.note,
      callbackAt || "",
    ]);

    await query(`
      insert into sales_activities(workspace,lead_id,company_id,type,summary,meta)
      select workspace,id,company_id,'call.outcome',$2::text,
             jsonb_build_object(
               'outcome',$3::text,
               'callOutcome',$4::text,
               'note',$5::text,
               'callbackAt',$6::text,
               'source','call-console',
               'taskId',$7::text
             )
      from sales_leads
      where id=$1
        and not exists (
          select 1 from sales_activities a
          where a.workspace=sales_leads.workspace
            and a.type='call.outcome'
            and a.meta->>'taskId'=$7::text
        )
    `, [
      task.lead_id,
      `Call · ${dashboardOutcome}`,
      dashboardOutcome,
      outcomeInput.outcome,
      outcomeInput.note,
      callbackAt || "",
      input.id,
    ]);

    await query(`
      update sales_leads
      set last_contact_at=now(),last_outcome=$2,updated_at=now(),
          next_action=case when $3::text<>'' then 'Rückruf' else next_action end,
          next_action_at=case when $3::text<>'' then $3::timestamptz else next_action_at end
      where id=$1
    `, [task.lead_id, outcomeInput.outcome, callbackAt || ""]);

    let websiteProject = null;
    let integrationWarning = "";
    if (outcomeInput.outcome === "website_requested") {
      try {
        await addProductOpportunity(task.lead_id, "website");
        const opportunityRows = await query<{ id: string }>(`select id from sales_opportunities where workspace='default' and lead_id=$1 and product_key='website' order by case when status='open' then 0 else 1 end,updated_at desc limit 1`, [task.lead_id]);
        const opportunity = opportunityRows[0];
        if (opportunity) {
          await updateRevenueOpportunity(opportunity.id, { outcome: "Interesse", nextAction: "Website-Entwurf erstellen und Preview vorbereiten", notes: outcomeInput.note || undefined });
        }
        websiteProject = await createWebsiteProjectFromLead(task.lead_id, "default", "rapid-call");
      } catch (integrationError) {
        integrationWarning = integrationError instanceof Error ? integrationError.message : "Website-Projekt konnte nicht automatisch verknüpft werden.";
      }
    }

    const snapshot = await getOutboundEngineSnapshot();
    const owner = await currentOwner();
    const tasks = await hydrateContacts(ownerTasks(snapshot.tasks, owner));
    return Response.json({ ok: true, owner, tasks, channels: snapshot.channels, websiteProject, integrationWarning });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Call-Ergebnis konnte nicht gespeichert werden." }, { status: 400 });
  }
}

import { randomUUID } from "node:crypto";
import { query } from "@/lib/db";
import { recordOutboundEventByMode } from "@/lib/outbound-event-ledger";

type LegacyOutboxRow={
  id:string;
  mailbox_id:string;
  recipient:string;
  variant:string;
  status:string;
  attempts:number;
  scheduled_at:Date;
  sent_at:Date|null;
  provider_message_id:string|null;
  error:string|null;
};

type LeadContextRow={
  company_id:string|null;
  contact_id:string|null;
};

type WorkflowRunRow={
  id:string;
  status:string;
  terminal_reason:string|null;
  inserted?:boolean;
};

type WorkflowStepRow={
  id:string;
  run_id:string;
  step_key:string;
  status:string;
  wake_at:Date|null;
  legacy_outbox_id:string|null;
  provider_message_id:string|null;
  attempt:number;
  max_attempts:number;
  lease_owner:string|null;
  lease_expires_at:Date|null;
};

type WorkflowSignalRow={
  id:string;
  run_id:string|null;
  signal_type:string;
  subject_type:string;
  subject_id:string;
  payload:Record<string,unknown>;
  attempt:number;
  max_attempts:number;
};

type LegacySequenceKey={
  campaign_id:string;
  lead_id:string;
};

export type WorkflowSignalType=
  |"reply_received"
  |"bounce"
  |"unsubscribe"
  |"meeting_booked"
  |"approval_granted"
  |"approval_rejected"
  |"manual_pause"
  |"manual_resume"
  |"manual_cancel";

function legacyStepStatus(status:string,scheduledAt:Date){
  switch(status){
    case "sent":return "completed";
    case "failed":return "failed";
    case "stopped":
    case "suppressed":return "cancelled";
    case "sending":return "running";
    case "queued":return scheduledAt.getTime()<=Date.now()?"ready":"waiting";
    default:return "pending";
  }
}

async function refreshRunState(runId:string){
  await query(
    `with stats as (
       select
         count(*)::int as total,
         count(*) filter(where status='failed')::int as failed,
         count(*) filter(where status='blocked')::int as blocked,
         count(*) filter(where status='running')::int as running,
         count(*) filter(where status='ready')::int as ready,
         count(*) filter(where status in ('pending','waiting'))::int as waiting,
         count(*) filter(where status in ('completed','cancelled'))::int as terminal,
         min(wake_at) filter(where status in ('pending','waiting','ready')) as next_wake_at
       from outbound_workflow_steps
       where run_id=$1
     )
     update outbound_workflow_runs r
     set status=case
           when r.terminal_reason is not null then r.status
           when stats.total>0 and (stats.failed>0 or stats.blocked>0) then 'failed'
           when stats.total>0 and stats.terminal=stats.total then 'completed'
           when stats.running>0 or stats.ready>0 then 'running'
           when stats.waiting>0 then 'waiting'
           else 'pending'
         end,
         next_wake_at=case when r.terminal_reason is null then stats.next_wake_at else r.next_wake_at end,
         started_at=coalesce(r.started_at,now()),
         completed_at=case
           when r.terminal_reason is null and stats.total>0 and stats.terminal=stats.total then coalesce(r.completed_at,now())
           else r.completed_at
         end,
         failed_at=case
           when r.terminal_reason is null and (stats.failed>0 or stats.blocked>0) then coalesce(r.failed_at,now())
           else r.failed_at
         end
     from stats
     where r.id=$1`,
    [runId],
  );
}

export async function ensureLegacyWorkflowForLead(input:{
  campaignId:string;
  leadId:string;
  workspace?:string;
}){
  const workspace=input.workspace??"default";
  const outbox=await query<LegacyOutboxRow>(
    `select id,mailbox_id,recipient,variant,status,attempts,scheduled_at,sent_at,provider_message_id,error
     from er_outbox
     where workspace=$1 and campaign_id=$2 and lead_id=$3
     order by scheduled_at asc,created_at asc,id asc`,
    [workspace,input.campaignId,input.leadId],
  );
  if(!outbox.length)return null;

  const [lead]=await query<LeadContextRow>(
    `select company_id,contact_id
     from sales_leads
     where workspace=$1 and id=$2
     limit 1`,
    [workspace,input.leadId],
  );

  const idempotencyKey=`legacy-sequence:${input.campaignId}:${input.leadId}`;
  const [run]=await query<WorkflowRunRow>(
    `insert into outbound_workflow_runs(
       workspace,workflow_key,workflow_version,kind,status,subject_type,subject_id,
       company_id,contact_id,lead_id,legacy_campaign_id,idempotency_key,input,state,
       next_wake_at,started_at
     )
     values(
       $1,'legacy-email-sequence',1,'email_sequence','pending','lead',$2,
       $3,$4,$2,$5,$6,$7::jsonb,'{}'::jsonb,
       $8,now()
     )
     on conflict(workspace,idempotency_key) do update
       set company_id=coalesce(outbound_workflow_runs.company_id,excluded.company_id),
           contact_id=coalesce(outbound_workflow_runs.contact_id,excluded.contact_id),
           state=outbound_workflow_runs.state || jsonb_build_object('lastMirroredAt',now())
     returning id,status,terminal_reason,(xmax=0) as inserted`,
    [
      workspace,
      input.leadId,
      lead?.company_id??null,
      lead?.contact_id??null,
      input.campaignId,
      idempotencyKey,
      JSON.stringify({legacyCampaignId:input.campaignId,source:"legacy-shadow"}),
      outbox[0]?.scheduled_at??new Date(),
    ],
  );
  if(!run)return null;

  if(run.inserted){
    await recordOutboundEventByMode({
      workspace,
      type:"workflow_started",
      actorType:"workflow",
      companyId:lead?.company_id??null,
      contactId:lead?.contact_id??null,
      leadId:input.leadId,
      correlationId:run.id,
      idempotencyKey:`workflow-started:${run.id}`,
      payload:{
        workflowRunId:run.id,
        workflowKey:"legacy-email-sequence",
        legacyCampaignId:input.campaignId,
        mode:"shadow",
      },
    });
  }

  for(const [index,row] of outbox.entries()){
    const status=legacyStepStatus(row.status,new Date(row.scheduled_at));
    const stepKey=`legacy-outbox:${row.id}`;
    const stepIdempotency=`legacy-outbox:${row.id}`;
    const [step]=await query<{id:string;inserted:boolean}>(
      `insert into outbound_workflow_steps(
         workspace,run_id,step_key,step_type,sequence_index,status,idempotency_key,
         input,wake_at,attempt,max_attempts,retry_backoff_seconds,
         legacy_outbox_id,provider_message_id,last_error,
         started_at,completed_at,failed_at,cancelled_at
       )
       values(
         $1,$2,$3,'email_send',$4,$5,$6,
         $7::jsonb,$8,$9,5,300,
         $10,$11,$12,
         case when $5 in ('running','completed','failed','cancelled') then now() else null end,
         case when $5='completed' then coalesce($13,now()) else null end,
         case when $5='failed' then now() else null end,
         case when $5='cancelled' then now() else null end
       )
       on conflict(run_id,step_key) do update
         set status=excluded.status,
             wake_at=excluded.wake_at,
             attempt=greatest(outbound_workflow_steps.attempt,excluded.attempt),
             provider_message_id=coalesce(excluded.provider_message_id,outbound_workflow_steps.provider_message_id),
             last_error=excluded.last_error,
             started_at=coalesce(outbound_workflow_steps.started_at,excluded.started_at),
             completed_at=case when excluded.status='completed' then coalesce(outbound_workflow_steps.completed_at,excluded.completed_at,now()) else outbound_workflow_steps.completed_at end,
             failed_at=case when excluded.status='failed' then coalesce(outbound_workflow_steps.failed_at,excluded.failed_at,now()) else outbound_workflow_steps.failed_at end,
             cancelled_at=case when excluded.status='cancelled' then coalesce(outbound_workflow_steps.cancelled_at,excluded.cancelled_at,now()) else outbound_workflow_steps.cancelled_at end,
             lease_owner=case when excluded.status in ('completed','failed','cancelled') then null else outbound_workflow_steps.lease_owner end,
             lease_expires_at=case when excluded.status in ('completed','failed','cancelled') then null else outbound_workflow_steps.lease_expires_at end
       returning id,(xmax=0) as inserted`,
      [
        workspace,
        run.id,
        stepKey,
        index,
        status,
        stepIdempotency,
        JSON.stringify({
          legacyOutboxId:row.id,
          mailboxId:row.mailbox_id,
          recipient:row.recipient,
          variant:row.variant,
          legacyStatus:row.status,
        }),
        row.scheduled_at,
        row.attempts,
        row.id,
        row.provider_message_id,
        row.error,
        row.sent_at,
      ],
    );
    if(step?.inserted){
      await recordOutboundEventByMode({
        workspace,
        type:"workflow_step_scheduled",
        actorType:"workflow",
        companyId:lead?.company_id??null,
        contactId:lead?.contact_id??null,
        leadId:input.leadId,
        correlationId:run.id,
        causationId:run.id,
        idempotencyKey:`workflow-step-scheduled:${step.id}`,
        payload:{
          workflowRunId:run.id,
          workflowStepId:step.id,
          legacyOutboxId:row.id,
          sequenceIndex:index,
          wakeAt:row.scheduled_at,
          observedLegacyStatus:row.status,
        },
      });
    }
  }

  await refreshRunState(run.id);
  return {runId:run.id,stepCount:outbox.length};
}

export async function syncLegacyWorkflowShadowBatch(limit=100,workspace="default"){
  const sequences=await query<LegacySequenceKey>(
    `select campaign_id,lead_id
     from er_outbox
     where workspace=$1
       and campaign_id is not null
       and created_at>=now()-interval '30 days'
     group by campaign_id,lead_id
     order by max(created_at) desc
     limit $2`,
    [workspace,limit],
  );

  let runs=0;
  let steps=0;
  for(const sequence of sequences){
    const result=await ensureLegacyWorkflowForLead({
      workspace,
      campaignId:sequence.campaign_id,
      leadId:sequence.lead_id,
    });
    if(result){
      runs++;
      steps+=result.stepCount;
    }
  }
  return {sequences:sequences.length,runs,steps};
}

export async function recordWorkflowSignal(input:{
  type:WorkflowSignalType;
  subjectType?:"company"|"contact"|"lead"|"campaign"|"workflow";
  subjectId:string;
  idempotencyKey:string;
  payload?:Record<string,unknown>;
  workspace?:string;
}){
  const workspace=input.workspace??"default";
  const [row]=await query<{id:string;inserted:boolean}>(
    `insert into outbound_workflow_signals(
       workspace,signal_type,subject_type,subject_id,idempotency_key,payload
     )
     values($1,$2,$3,$4,$5,$6::jsonb)
     on conflict(workspace,idempotency_key) do update
       set payload=outbound_workflow_signals.payload
     returning id,(xmax=0) as inserted`,
    [
      workspace,
      input.type,
      input.subjectType??"lead",
      input.subjectId,
      input.idempotencyKey,
      JSON.stringify(input.payload??{}),
    ],
  );
  if(row?.inserted){
    await recordOutboundEventByMode({
      workspace,
      type:"workflow_signal_received",
      actorType:"workflow",
      leadId:(input.subjectType??"lead")==="lead"?input.subjectId:null,
      idempotencyKey:`workflow-signal-received:${row.id}`,
      payload:{
        workflowSignalId:row.id,
        signalType:input.type,
        subjectType:input.subjectType??"lead",
        subjectId:input.subjectId,
      },
    });
  }
  return row??null;
}

async function claimPendingSignals(workerId:string,limit:number,workspace:string){
  return query<WorkflowSignalRow>(
    `with claim as (
       select id
       from outbound_workflow_signals
       where workspace=$1
         and processed_at is null
         and attempt<max_attempts
         and (lease_expires_at is null or lease_expires_at<now())
       order by received_at asc
       for update skip locked
       limit $2
     )
     update outbound_workflow_signals s
     set lease_owner=$3,
         lease_expires_at=now()+interval '90 seconds',
         attempt=s.attempt+1,
         processing_error=null
     from claim
     where s.id=claim.id
     returning s.id,s.run_id,s.signal_type,s.subject_type,s.subject_id,s.payload,s.attempt,s.max_attempts`,
    [workspace,limit,workerId],
  );
}

async function applySignal(signal:WorkflowSignalRow,workspace:string){
  const runs=signal.run_id
    ? await query<{id:string}>(
        `select id from outbound_workflow_runs
         where workspace=$1 and id=$2
           and status not in ('completed','failed','cancelled')`,
        [workspace,signal.run_id],
      )
    : signal.subject_type==="lead"
      ? await query<{id:string}>(
          `select id from outbound_workflow_runs
           where workspace=$1 and lead_id=$2
             and status not in ('completed','failed','cancelled')
           order by created_at desc`,
          [workspace,signal.subject_id],
        )
      : [];

  for(const run of runs){
    const terminal=signal.signal_type==="reply_received"||
      signal.signal_type==="unsubscribe"||
      signal.signal_type==="meeting_booked"||
      signal.signal_type==="bounce"||
      signal.signal_type==="manual_cancel";

    if(terminal){
      await query(
        `update outbound_workflow_steps
         set status='cancelled',
             cancelled_at=coalesce(cancelled_at,now()),
             lease_owner=null,
             lease_expires_at=null,
             last_error=case when $2='bounce' then 'Sequence stopped by bounce signal' else last_error end
         where run_id=$1
           and status not in ('completed','failed','cancelled')`,
        [run.id,signal.signal_type],
      );
    }

    if(signal.signal_type==="bounce"){
      await query(
        `update outbound_workflow_runs
         set status='failed',
             terminal_reason='bounce',
             failed_at=coalesce(failed_at,now()),
             lease_owner=null,
             lease_expires_at=null
         where id=$1`,
        [run.id],
      );
    }else if(signal.signal_type==="manual_cancel"){
      await query(
        `update outbound_workflow_runs
         set status='cancelled',
             terminal_reason='manual_cancel',
             cancelled_at=coalesce(cancelled_at,now()),
             lease_owner=null,
             lease_expires_at=null
         where id=$1`,
        [run.id],
      );
    }else if(signal.signal_type==="reply_received"||signal.signal_type==="unsubscribe"||signal.signal_type==="meeting_booked"){
      await query(
        `update outbound_workflow_runs
         set status='completed',
             terminal_reason=$2,
             completed_at=coalesce(completed_at,now()),
             lease_owner=null,
             lease_expires_at=null
         where id=$1`,
        [run.id,signal.signal_type],
      );
    }else if(signal.signal_type==="manual_pause"){
      await query(
        `update outbound_workflow_runs
         set status='paused',
             next_wake_at=null,
             lease_owner=null,
             lease_expires_at=null
         where id=$1 and status not in ('completed','failed','cancelled')`,
        [run.id],
      );
    }else if(signal.signal_type==="manual_resume"){
      await query(
        `update outbound_workflow_runs
         set status='waiting',
             next_wake_at=(
               select min(wake_at)
               from outbound_workflow_steps
               where run_id=$1 and status in ('pending','waiting','ready')
             )
         where id=$1 and status='paused'`,
        [run.id],
      );
    }

    await recordOutboundEventByMode({
      workspace,
      type:"workflow_signal_applied",
      actorType:"workflow",
      leadId:signal.subject_type==="lead"?signal.subject_id:null,
      correlationId:run.id,
      causationId:signal.id,
      idempotencyKey:`workflow-signal-applied:${signal.id}:${run.id}`,
      payload:{
        workflowRunId:run.id,
        workflowSignalId:signal.id,
        signalType:signal.signal_type,
      },
    });
  }

  await query(
    `update outbound_workflow_signals
     set processed_at=now(),
         lease_owner=null,
         lease_expires_at=null,
         processing_error=null
     where id=$1`,
    [signal.id],
  );

  return runs.length;
}

export async function processWorkflowSignals(input?:{
  limit?:number;
  workerId?:string;
  workspace?:string;
}){
  const limit=Math.max(1,Math.min(200,input?.limit??100));
  const workspace=input?.workspace??"default";
  const workerId=input?.workerId??`workflow-${randomUUID()}`;
  const signals=await claimPendingSignals(workerId,limit,workspace);
  let processed=0;
  let appliedRuns=0;
  let failed=0;

  for(const signal of signals){
    try{
      appliedRuns+=await applySignal(signal,workspace);
      processed++;
    }catch(error){
      const message=error instanceof Error?error.message:"Workflow signal processing failed";
      await query(
        `update outbound_workflow_signals
         set lease_owner=null,
             lease_expires_at=null,
             processing_error=$2
         where id=$1`,
        [signal.id,message],
      );
      failed++;
    }
  }
  return {claimed:signals.length,processed,appliedRuns,failed};
}

export async function recoverExpiredWorkflowLeases(workspace="default"){
  const steps=await query<{id:string;run_id:string}>(
    `update outbound_workflow_steps
     set lease_owner=null,
         lease_expires_at=null,
         status=case when status='running' then
           case when wake_at is null or wake_at<=now() then 'ready' else 'waiting' end
           else status end,
         last_error=case when status='running' then 'Expired workflow lease recovered' else last_error end
     where workspace=$1
       and lease_expires_at is not null
       and lease_expires_at<now()
       and status not in ('completed','failed','cancelled')
     returning id,run_id`,
    [workspace],
  );

  const signals=await query<{id:string}>(
    `update outbound_workflow_signals
     set lease_owner=null,
         lease_expires_at=null,
         processing_error=coalesce(processing_error,'Expired signal lease recovered')
     where workspace=$1
       and processed_at is null
       and lease_expires_at is not null
       and lease_expires_at<now()
     returning id`,
    [workspace],
  );

  const runIds=[...new Set(steps.map(step=>step.run_id))];
  for(const runId of runIds)await refreshRunState(runId);

  for(const step of steps){
    await recordOutboundEventByMode({
      workspace,
      type:"workflow_recovered",
      actorType:"workflow",
      correlationId:step.run_id,
      idempotencyKey:`workflow-recovered:${step.id}:${Date.now()}`,
      payload:{workflowRunId:step.run_id,workflowStepId:step.id,reason:"expired_lease"},
    });
  }

  return {steps:steps.length,signals:signals.length};
}

async function claimDueShadowSteps(workerId:string,limit:number,workspace:string){
  return query<WorkflowStepRow>(
    `with claim as (
       select s.id
       from outbound_workflow_steps s
       join outbound_workflow_runs r on r.id=s.run_id
       where s.workspace=$1
         and r.status not in ('paused','completed','failed','cancelled')
         and s.status in ('pending','waiting','ready','running')
         and (s.wake_at is null or s.wake_at<=now())
         and (s.lease_expires_at is null or s.lease_expires_at<now())
         and s.attempt<s.max_attempts
         and s.legacy_outbox_id is not null
       order by s.wake_at asc nulls first,s.sequence_index asc
       for update of s skip locked
       limit $2
     )
     update outbound_workflow_steps s
     set lease_owner=$3,
         lease_expires_at=now()+interval '90 seconds',
         attempt=s.attempt+1
     from claim
     where s.id=claim.id
     returning s.id,s.run_id,s.step_key,s.status,s.wake_at,s.legacy_outbox_id,
               s.provider_message_id,s.attempt,s.max_attempts,s.lease_owner,s.lease_expires_at`,
    [workspace,limit,workerId],
  );
}

export async function observeDueShadowSteps(input?:{
  limit?:number;
  workerId?:string;
  workspace?:string;
}){
  const workspace=input?.workspace??"default";
  const limit=Math.max(1,Math.min(200,input?.limit??100));
  const workerId=input?.workerId??`workflow-${randomUUID()}`;
  const steps=await claimDueShadowSteps(workerId,limit,workspace);

  let observed=0;
  let missing=0;
  for(const step of steps){
    const [legacy]=await query<LegacyOutboxRow>(
      `select id,mailbox_id,recipient,variant,status,attempts,scheduled_at,sent_at,provider_message_id,error
       from er_outbox
       where workspace=$1 and id=$2
       limit 1`,
      [workspace,step.legacy_outbox_id],
    );

    if(!legacy){
      await query(
        `update outbound_workflow_steps
         set status='blocked',
             lease_owner=null,
             lease_expires_at=null,
             last_error='Legacy outbox row missing during shadow observation'
         where id=$1`,
        [step.id],
      );
      missing++;
      continue;
    }

    const mapped=legacyStepStatus(legacy.status,new Date(legacy.scheduled_at));
    await query(
      `update outbound_workflow_steps
       set status=$2,
           provider_message_id=coalesce($3,provider_message_id),
           last_error=$4,
           lease_owner=null,
           lease_expires_at=null,
           completed_at=case when $2='completed' then coalesce(completed_at,$5,now()) else completed_at end,
           failed_at=case when $2='failed' then coalesce(failed_at,now()) else failed_at end,
           cancelled_at=case when $2='cancelled' then coalesce(cancelled_at,now()) else cancelled_at end
       where id=$1`,
      [step.id,mapped,legacy.provider_message_id,legacy.error,legacy.sent_at],
    );
    await refreshRunState(step.run_id);

    await recordOutboundEventByMode({
      workspace,
      type:"workflow_step_observed",
      actorType:"workflow",
      correlationId:step.run_id,
      idempotencyKey:`workflow-step-observed:${step.id}:${legacy.status}:${legacy.provider_message_id??"none"}`,
      payload:{
        workflowRunId:step.run_id,
        workflowStepId:step.id,
        legacyOutboxId:legacy.id,
        legacyStatus:legacy.status,
        workflowStatus:mapped,
        providerMessageId:legacy.provider_message_id,
      },
    });
    observed++;
  }

  return {claimed:steps.length,observed,missing};
}

export async function runDurableWorkflowShadowTick(input?:{
  workspace?:string;
  workerId?:string;
  syncLimit?:number;
  stepLimit?:number;
  signalLimit?:number;
}){
  const workspace=input?.workspace??"default";
  const workerId=input?.workerId??`workflow-${randomUUID()}`;
  const recovered=await recoverExpiredWorkflowLeases(workspace);
  const mirrored=await syncLegacyWorkflowShadowBatch(input?.syncLimit??100,workspace);
  const signals=await processWorkflowSignals({
    workspace,
    workerId,
    limit:input?.signalLimit??100,
  });
  const observed=await observeDueShadowSteps({
    workspace,
    workerId,
    limit:input?.stepLimit??100,
  });

  return {workerId,recovered,mirrored,signals,observed};
}

-- DG Outbound OS V3 — M5 Conversation Intelligence
-- Additive, human-first and safe at L2.

alter table public.outbound_runtime_settings
  add column if not exists conversation_mode text not null default 'shadow'
    check (conversation_mode in ('off','shadow','assist'));

create table if not exists public.outbound_conversation_threads (
  id uuid primary key default gen_random_uuid(),
  workspace text not null default 'default',
  lead_id text not null,
  contact_id text,
  company_id text,
  channel text not null default 'email'
    check (channel in ('email','phone','whatsapp','linkedin','sms','other')),
  mailbox_id text,
  status text not null default 'open'
    check (status in ('open','waiting','needs_human','qualified','closed','suppressed')),
  last_reply_class text,
  requires_human boolean not null default false,
  priority text not null default 'normal'
    check (priority in ('low','normal','high','urgent')),
  owner text,
  next_action text,
  next_action_at timestamptz,
  last_message_at timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace,channel,lead_id)
);

create table if not exists public.outbound_conversation_messages (
  id uuid primary key default gen_random_uuid(),
  workspace text not null default 'default',
  thread_id uuid not null references public.outbound_conversation_threads(id) on delete cascade,
  direction text not null check (direction in ('inbound','outbound')),
  provider_message_id text,
  mailbox_id text,
  subject text not null default '',
  body_text text not null default '',
  body_hash text,
  processing_status text not null default 'pending'
    check (processing_status in ('pending','processing','classified','failed','ignored')),
  attempt integer not null default 0 check (attempt >= 0),
  max_attempts integer not null default 5 check (max_attempts > 0),
  lease_owner text,
  lease_expires_at timestamptz,
  last_error text,
  received_at timestamptz,
  sent_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists outbound_conversation_messages_provider_uidx
  on public.outbound_conversation_messages(workspace,direction,provider_message_id)
  where provider_message_id is not null;

create index if not exists outbound_conversation_messages_pending_idx
  on public.outbound_conversation_messages(workspace,processing_status,created_at)
  where direction='inbound' and processing_status in ('pending','processing');

create index if not exists outbound_conversation_messages_thread_idx
  on public.outbound_conversation_messages(thread_id,created_at desc);

create table if not exists public.outbound_reply_classifications (
  id uuid primary key default gen_random_uuid(),
  workspace text not null default 'default',
  thread_id uuid not null references public.outbound_conversation_threads(id) on delete cascade,
  message_id uuid not null references public.outbound_conversation_messages(id) on delete cascade,
  reply_class text not null
    check (reply_class in (
      'positive',
      'meeting_intent',
      'needs_information',
      'objection_price',
      'objection_existing_solution',
      'objection_timing',
      'not_responsible',
      'referral',
      'not_interested',
      'already_filled',
      'out_of_office',
      'unsubscribe',
      'legal_complaint',
      'unknown'
    )),
  confidence numeric(8,6) not null check (confidence >= 0 and confidence <= 1),
  classifier text not null,
  model text,
  rationale text not null default '',
  recommended_action text not null default 'human_review'
    check (recommended_action in (
      'call_now',
      'book_meeting',
      'send_information',
      'human_reply',
      'ask_referral',
      'retry_later',
      'close_loop',
      'no_action',
      'suppress',
      'legal_review',
      'human_review'
    )),
  priority text not null default 'normal'
    check (priority in ('low','normal','high','urgent')),
  requires_human boolean not null default true,
  draft_reply text,
  policy_version text not null,
  prompt_version text not null,
  is_current boolean not null default true,
  review_status text not null default 'proposed'
    check (review_status in ('proposed','accepted','rejected')),
  reviewed_by text,
  reviewed_at timestamptz,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists outbound_reply_classifications_current_uidx
  on public.outbound_reply_classifications(message_id)
  where is_current=true;

create index if not exists outbound_reply_classifications_thread_idx
  on public.outbound_reply_classifications(thread_id,created_at desc);

create table if not exists public.outbound_conversation_escalations (
  id uuid primary key default gen_random_uuid(),
  workspace text not null default 'default',
  thread_id uuid not null references public.outbound_conversation_threads(id) on delete cascade,
  message_id uuid not null references public.outbound_conversation_messages(id) on delete cascade,
  classification_id uuid references public.outbound_reply_classifications(id) on delete set null,
  reason text not null,
  priority text not null default 'normal'
    check (priority in ('low','normal','high','urgent')),
  recommended_action text,
  draft_reply text,
  status text not null default 'open'
    check (status in ('open','in_progress','resolved','dismissed')),
  owner text,
  due_at timestamptz,
  resolved_by text,
  resolved_at timestamptz,
  resolution text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists outbound_conversation_escalations_open_idx
  on public.outbound_conversation_escalations(workspace,status,priority,created_at desc);

drop trigger if exists outbound_conversation_threads_touch on public.outbound_conversation_threads;
create trigger outbound_conversation_threads_touch
before update on public.outbound_conversation_threads
for each row execute function public.outbound_touch_updated_at();

drop trigger if exists outbound_conversation_escalations_touch on public.outbound_conversation_escalations;
create trigger outbound_conversation_escalations_touch
before update on public.outbound_conversation_escalations
for each row execute function public.outbound_touch_updated_at();

alter table public.outbound_conversation_threads enable row level security;
alter table public.outbound_conversation_messages enable row level security;
alter table public.outbound_reply_classifications enable row level security;
alter table public.outbound_conversation_escalations enable row level security;

revoke all on table public.outbound_conversation_threads from anon, authenticated;
revoke all on table public.outbound_conversation_messages from anon, authenticated;
revoke all on table public.outbound_reply_classifications from anon, authenticated;
revoke all on table public.outbound_conversation_escalations from anon, authenticated;

drop policy if exists outbound_conversation_threads_deny_client on public.outbound_conversation_threads;
create policy outbound_conversation_threads_deny_client
  on public.outbound_conversation_threads for all to anon, authenticated
  using (false) with check (false);

drop policy if exists outbound_conversation_messages_deny_client on public.outbound_conversation_messages;
create policy outbound_conversation_messages_deny_client
  on public.outbound_conversation_messages for all to anon, authenticated
  using (false) with check (false);

drop policy if exists outbound_reply_classifications_deny_client on public.outbound_reply_classifications;
create policy outbound_reply_classifications_deny_client
  on public.outbound_reply_classifications for all to anon, authenticated
  using (false) with check (false);

drop policy if exists outbound_conversation_escalations_deny_client on public.outbound_conversation_escalations;
create policy outbound_conversation_escalations_deny_client
  on public.outbound_conversation_escalations for all to anon, authenticated
  using (false) with check (false);

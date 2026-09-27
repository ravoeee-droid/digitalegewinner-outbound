-- DG Outbound OS V3 — M4 Compliance Engine
-- Additive only. Existing er_suppressions remains mirrored for legacy compatibility.

alter table public.outbound_contact_permissions
  add column if not exists verification_level text not null default 'human'
    check (verification_level in ('human','system','imported')),
  add column if not exists evidence_hash text,
  add column if not exists decision_reason text,
  add column if not exists supersedes_id uuid references public.outbound_contact_permissions(id) on delete set null;

create table if not exists public.outbound_compliance_suppressions (
  id uuid primary key default gen_random_uuid(),
  workspace text not null default 'default',
  channel text not null
    check (channel in ('email','phone','whatsapp','linkedin','sms','other')),
  identifier text not null,
  contact_id text,
  company_id text,
  lead_id text,
  reason text not null
    check (reason in ('unsubscribe','bounce','complaint','legal','manual','do_not_contact','other')),
  status text not null default 'active'
    check (status in ('active','revoked')),
  source text,
  evidence jsonb not null default '{}'::jsonb,
  created_by text not null,
  revoked_by text,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists outbound_compliance_suppressions_active_uidx
  on public.outbound_compliance_suppressions(workspace,channel,lower(identifier))
  where status='active';

create index if not exists outbound_compliance_suppressions_contact_idx
  on public.outbound_compliance_suppressions(workspace,contact_id,status,created_at desc);

create index if not exists outbound_compliance_suppressions_lead_idx
  on public.outbound_compliance_suppressions(workspace,lead_id,status,created_at desc);

create table if not exists public.outbound_permission_reviews (
  id uuid primary key default gen_random_uuid(),
  workspace text not null default 'default',
  company_id text,
  contact_id text,
  channel text not null
    check (channel in ('email','phone','whatsapp','linkedin','sms','other')),
  jurisdiction text not null,
  requested_basis text not null
    check (requested_basis in (
      'explicit_consent',
      'existing_customer_exception',
      'human_verified_business_expectation',
      'inbound_request',
      'contractual_necessity',
      'unknown',
      'denied'
    )),
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','cancelled')),
  source text,
  evidence jsonb not null default '{}'::jsonb,
  requested_by text not null,
  reviewed_by text,
  reviewed_at timestamptz,
  decision_reason text,
  permission_id uuid references public.outbound_contact_permissions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (company_id is not null or contact_id is not null)
);

create index if not exists outbound_permission_reviews_status_idx
  on public.outbound_permission_reviews(workspace,status,created_at desc);

create index if not exists outbound_permission_reviews_contact_idx
  on public.outbound_permission_reviews(workspace,contact_id,created_at desc);

drop trigger if exists outbound_permission_reviews_touch on public.outbound_permission_reviews;
create trigger outbound_permission_reviews_touch
before update on public.outbound_permission_reviews
for each row execute function public.outbound_touch_updated_at();

alter table public.outbound_compliance_suppressions enable row level security;
alter table public.outbound_permission_reviews enable row level security;

revoke all on table public.outbound_compliance_suppressions from anon, authenticated;
revoke all on table public.outbound_permission_reviews from anon, authenticated;

drop policy if exists outbound_compliance_suppressions_deny_client on public.outbound_compliance_suppressions;
create policy outbound_compliance_suppressions_deny_client
  on public.outbound_compliance_suppressions
  for all to anon, authenticated
  using (false) with check (false);

drop policy if exists outbound_permission_reviews_deny_client on public.outbound_permission_reviews;
create policy outbound_permission_reviews_deny_client
  on public.outbound_permission_reviews
  for all to anon, authenticated
  using (false) with check (false);

insert into public.outbound_compliance_suppressions(
  workspace,channel,identifier,reason,status,source,evidence,created_by,created_at
)
select
  s.workspace,
  'email',
  lower(s.email),
  case when s.reason='bounce' then 'bounce' else 'manual' end,
  'active',
  'legacy-er-suppressions',
  jsonb_build_object('legacyReason',s.reason),
  'migration',
  s.created_at
from public.er_suppressions s
where not exists (
  select 1
  from public.outbound_compliance_suppressions cs
  where cs.workspace=s.workspace
    and cs.channel='email'
    and lower(cs.identifier)=lower(s.email)
    and cs.status='active'
);

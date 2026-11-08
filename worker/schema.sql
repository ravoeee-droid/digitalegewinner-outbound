-- Anreicherungs-Worker (Oracle): Rohdaten je Firma und Quelle sowie gelernte Signal-Gewichte aus Call-Ergebnissen.
create table if not exists public.lead_enrichment (
  company_id text not null references public.sales_companies(id) on delete cascade,
  source text not null,
  status text not null default 'ok',
  data jsonb not null default '{}'::jsonb,
  error text not null default '',
  fetched_at timestamptz not null default now(),
  primary key (company_id, source)
);
create index if not exists lead_enrichment_fetched_idx on public.lead_enrichment(source, fetched_at);
alter table public.lead_enrichment enable row level security;

create table if not exists public.lead_learning_signals (
  signal text primary key,
  calls integer not null default 0,
  positives integer not null default 0,
  rate numeric(6,4) not null default 0,
  lift numeric(8,4) not null default 1,
  updated_at timestamptz not null default now()
);
alter table public.lead_learning_signals enable row level security;

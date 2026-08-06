-- Tabela de leads captados pelo funil de anúncios (Ilha do Foco / Aventura das Letras)
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  contact_email text,
  contact_whatsapp text,
  instagram_handle text,
  language text not null default 'pt-BR' check (language in ('pt-BR', 'it')),
  quiz_answers jsonb default '{}'::jsonb,
  quiz_profile text check (quiz_profile is null or quiz_profile in ('tdah', 'dislexia', 'ambos', 'investigando', 'outro')),
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  funnel_stage text not null default 'novo' check (funnel_stage in ('novo', 'contatado', 'trial', 'cliente', 'perdido')),
  whatsapp_opt_in boolean not null default false,
  email_opt_in boolean not null default false,
  converted_family_id uuid references public.families(id),
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_at timestamp with time zone not null default timezone('utc'::text, now())
);

comment on table public.leads is 'Captura de leads do funil de anúncios (ads -> quiz -> WhatsApp/email/Instagram -> conversão). Vira family quando assina.';

-- Histórico de eventos/toques do funil por lead
create table public.lead_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  event_type text not null check (event_type in (
    'quiz_completed', 'whatsapp_sent', 'whatsapp_replied',
    'email_sent', 'email_opened', 'instagram_follow_clicked',
    'instagram_dm_sent', 'checkout_started', 'converted', 'lost'
  )),
  channel text check (channel is null or channel in ('whatsapp', 'email', 'instagram', 'ads', 'site')),
  metadata jsonb default '{}'::jsonb,
  occurred_at timestamp with time zone not null default now()
);

comment on table public.lead_events is 'Timeline de eventos por lead, usada para visualizar o funil (kanban) e analytics de conversão.';

-- Índices para consultas comuns (kanban por estágio, timeline por lead)
create index idx_leads_funnel_stage on public.leads(funnel_stage);
create index idx_leads_created_at on public.leads(created_at desc);
create index idx_lead_events_lead_id on public.lead_events(lead_id);
create index idx_lead_events_occurred_at on public.lead_events(occurred_at desc);

-- Trigger para manter updated_at em dia
create or replace function public.set_leads_updated_at()
returns trigger as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$ language plpgsql;

create trigger trg_leads_updated_at
before update on public.leads
for each row execute function public.set_leads_updated_at();

-- RLS: por enquanto, apenas acesso via service_role (Edge Functions), sem acesso direto do client público
alter table public.leads enable row level security;
alter table public.lead_events enable row level security;
alter table public.child_profiles
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

alter table public.reading_progress
  add column if not exists daily_usage_seconds jsonb not null default '{}';

comment on column public.child_profiles.updated_at is 'Atualizado a cada mudança de progresso (estrelas, sementes, etc).';
comment on column public.reading_progress.daily_usage_seconds is 'Tempo de uso por dia da semana, ex: {"Seg": 300, "Ter": 450}.';

select 'ok' as status;
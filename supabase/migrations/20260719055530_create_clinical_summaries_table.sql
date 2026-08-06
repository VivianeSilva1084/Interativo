create table if not exists public.clinical_summaries (
  id uuid primary key default gen_random_uuid(),
  child_profile_id uuid not null references public.child_profiles(id) on delete cascade,
  generated_at timestamptz not null default now(),
  summary_pt text not null,
  summary_it text not null,
  data_snapshot jsonb not null
);

alter table public.clinical_summaries enable row level security;

create policy "families read own summaries"
  on public.clinical_summaries for select
  using (public.is_own_child_profile(child_profile_id));

create policy "professional reads linked summaries"
  on public.clinical_summaries for select
  using (public.is_linked_professional_for_child(child_profile_id));

comment on table public.clinical_summaries is
  'Resumos clínicos descritivos gerados via Claude API, baseados nos dados das últimas 4 semanas. Não constituem diagnóstico médico. Cache de 24h por criança.';

select 'ok' as status;
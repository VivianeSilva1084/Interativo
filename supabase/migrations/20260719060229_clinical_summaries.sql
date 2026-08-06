create table if not exists public.clinical_summaries (
  id uuid primary key default gen_random_uuid(),
  child_profile_id uuid not null references public.child_profiles(id) on delete cascade,
  generated_at timestamptz not null default now(),
  summary_pt text not null,
  summary_it text not null,
  data_snapshot jsonb not null
);

create index if not exists clinical_summaries_child_profile_generated_at_idx
  on public.clinical_summaries (child_profile_id, generated_at desc);

alter table public.clinical_summaries enable row level security;

drop policy if exists "families read own summaries" on public.clinical_summaries;
create policy "families read own summaries"
  on public.clinical_summaries for select
  using (public.is_own_child_profile(child_profile_id));

drop policy if exists "professional reads linked summaries" on public.clinical_summaries;
create policy "professional reads linked summaries"
  on public.clinical_summaries for select
  using (public.is_linked_professional_for_child(child_profile_id));

comment on table public.clinical_summaries is
  'Resumos clinicos descritivos gerados automaticamente via Claude API, baseados nos dados de jogo da crianca. Nao constituem diagnostico medico. Cache de 24h por crianca.';
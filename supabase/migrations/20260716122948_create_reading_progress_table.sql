create table if not exists public.reading_progress (
  child_profile_id uuid primary key references public.child_profiles(id) on delete cascade,
  learned_letters jsonb not null default '[]',
  mastered_syllables jsonb not null default '[]',
  read_words jsonb not null default '[]',
  unlocked_clothing jsonb not null default '[]',
  equipped_clothing text,
  challenges_completed integer not null default 0,
  avatar_name text,
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table public.reading_progress is 'Progresso específico do Aventura das Letras (alfabetização/leitura), ligado ao perfil canônico da criança.';

alter table public.reading_progress enable row level security;

create policy "families read own reading progress"
  on public.reading_progress for select
  using (child_profile_id in (
    select cp.id from public.child_profiles cp
    join public.families f on f.id = cp.family_id
    where f.auth_user_id = auth.uid()
  ));

create policy "families update own reading progress"
  on public.reading_progress for update
  using (child_profile_id in (
    select cp.id from public.child_profiles cp
    join public.families f on f.id = cp.family_id
    where f.auth_user_id = auth.uid()
  ));

create policy "families insert own reading progress"
  on public.reading_progress for insert
  with check (child_profile_id in (
    select cp.id from public.child_profiles cp
    join public.families f on f.id = cp.family_id
    where f.auth_user_id = auth.uid()
  ));

create policy "professional reads linked reading progress"
  on public.reading_progress for select
  using (
    child_profile_id in (
      select pcl.child_profile_id from public.professional_child_links pcl
      join public.professionals p on p.id = pcl.professional_id
      where p.auth_user_id = auth.uid() and pcl.status = 'active'
    )
  );
-- Meta de frequência semanal por criança e jogo (opcional — default 3x/semana
-- se a criança não tiver meta customizada, seguindo o padrão do Eye-Riders)
create table if not exists public.adherence_goals (
  id uuid primary key default gen_random_uuid(),
  child_profile_id uuid not null references public.child_profiles(id) on delete cascade,
  game_key text not null,
  sessions_per_week integer not null default 3,
  created_at timestamptz not null default timezone('utc', now()),
  constraint adherence_goals_unique unique (child_profile_id, game_key)
);

alter table public.adherence_goals enable row level security;

create policy "families manage own adherence goals"
  on public.adherence_goals for all
  using (child_profile_id in (
    select cp.id from public.child_profiles cp
    join public.families f on f.id = cp.family_id
    where f.auth_user_id = auth.uid()
  ));

create policy "professional reads linked adherence goals"
  on public.adherence_goals for select
  using (public.is_linked_professional_for_child(child_profile_id));

-- View: adesão semanal real (sessões completas por semana vs meta)
create or replace view public.v_weekly_adherence as
with weekly_sessions as (
  select
    profile_id,
    game_key,
    date_trunc('week', start_time) as week_start,
    count(*) filter (where status = 'completed') as sessoes_completas,
    count(*) filter (where status = 'abandoned') as sessoes_abandonadas
  from public.game_sessions
  where start_time >= now() - interval '9 weeks'
  group by profile_id, game_key, date_trunc('week', start_time)
)
select
  ws.profile_id,
  ws.game_key,
  ws.week_start,
  ws.sessoes_completas,
  ws.sessoes_abandonadas,
  coalesce(ag.sessions_per_week, 3) as meta_semanal,
  round(100.0 * ws.sessoes_completas / coalesce(ag.sessions_per_week, 3), 1) as adesao_pct,
  case
    when ws.sessoes_completas >= coalesce(ag.sessions_per_week, 3) then 'meta_atingida'
    when ws.sessoes_completas > 0 then 'parcial'
    else 'nenhuma_sessao'
  end as status_semana
from weekly_sessions ws
left join public.adherence_goals ag
  on ag.child_profile_id = ws.profile_id and ag.game_key = ws.game_key;

-- View: adesão consolidada (últimas 9 semanas, número único por criança/jogo,
-- no mesmo espírito do "mais de 90% completam" que os concorrentes usam)
create or replace view public.v_adherence_summary as
select
  profile_id,
  game_key,
  count(*) as semanas_com_dado,
  count(*) filter (where status_semana = 'meta_atingida') as semanas_com_meta_atingida,
  round(100.0 * count(*) filter (where status_semana = 'meta_atingida') / nullif(count(*), 0), 1) as taxa_adesao_pct
from public.v_weekly_adherence
group by profile_id, game_key;

select 'ok' as status;
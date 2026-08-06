create or replace view public.v_weekly_adherence
with (security_invoker = true) as
select * from (
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
    on ag.child_profile_id = ws.profile_id and ag.game_key = ws.game_key
) t where public.has_premium_access(t.profile_id);

create or replace view public.v_adherence_summary
with (security_invoker = true) as
select
  profile_id,
  game_key,
  count(*) as semanas_com_dado,
  count(*) filter (where status_semana = 'meta_atingida') as semanas_com_meta_atingida,
  round(100.0 * count(*) filter (where status_semana = 'meta_atingida') / nullif(count(*), 0), 1) as taxa_adesao_pct
from public.v_weekly_adherence
group by profile_id, game_key;

create or replace view public.v_recommended_difficulty
with (security_invoker = true) as
select * from (
  with recent_answers as (
    select
      profile_id,
      game_key,
      correct,
      response_time_ms,
      row_number() over (partition by profile_id, game_key order by occurred_at desc) as rn
    from public.game_events
    where event_type = 'answer'
  ),
  recent_window as (
    select * from recent_answers where rn <= 15
  ),
  stats as (
    select
      profile_id,
      game_key,
      count(*) as total_respostas,
      round(100.0 * count(*) filter (where correct = true) / nullif(count(*), 0), 1) as taxa_acerto,
      avg(response_time_ms) filter (where correct = true) as tempo_medio_acerto_ms
    from recent_window
    group by profile_id, game_key
  )
  select
    profile_id,
    game_key,
    total_respostas,
    taxa_acerto,
    round(tempo_medio_acerto_ms) as tempo_medio_acerto_ms,
    case
      when total_respostas < 5 then 'dados_insuficientes'
      when taxa_acerto >= 85 then 'subir'
      when taxa_acerto < 60 then 'descer'
      else 'manter'
    end as recomendacao
  from stats
) t where public.has_premium_access(t.profile_id);

select 'ok' as status_parte_4;
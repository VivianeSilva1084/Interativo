create or replace view public.v_impulsivity_raw_counts
with (security_invoker = true) as
select * from (
  with response_times as (
    select
      ge.*,
      avg(ge.response_time_ms) over (partition by ge.profile_id, ge.target_type) as avg_target_response_ms
    from public.game_events ge
    where ge.event_type = 'answer'
  ),
  erros_precipitados_calc as (
    select
      profile_id,
      count(*) as erros_precipitados
    from response_times
    where correct = false
      and coalesce(error_type, '') <> 'impulsiva'
      and response_time_ms is not null
      and avg_target_response_ms is not null
      and response_time_ms < 0.5 * avg_target_response_ms
    group by profile_id
  )
  select
    cp.id as profile_id,
    count(*) filter (where ge.event_type = 'premature_click') as cliques_antecipados,
    count(*) filter (where ge.event_type = 'answer' and ge.error_type = 'impulsiva') as respostas_impulsivas,
    count(*) filter (where ge.event_type = 'abandon') as abandonos,
    count(*) filter (where ge.event_type = 'repeated_tap') as toques_repetitivos,
    coalesce(max(epc.erros_precipitados), 0) as erros_precipitados,
    count(*) filter (where ge.event_type = 'wait_task' and ge.correct = true) as esperas_corretas,
    count(*) filter (where ge.event_type = 'activity_complete') as atividades_concluidas,
    count(*) filter (where ge.event_type = 'answer' and ge.correct = true) as acertos_apos_reflexao
  from public.child_profiles cp
  left join public.game_events ge on ge.profile_id = cp.id
  left join erros_precipitados_calc epc on epc.profile_id = cp.id
  group by cp.id
) t where public.has_premium_access(t.profile_id);

create or replace view public.v_impulsivity_index
with (security_invoker = true) as
select
  profile_id,
  cliques_antecipados,
  respostas_impulsivas,
  abandonos,
  toques_repetitivos,
  erros_precipitados,
  esperas_corretas,
  atividades_concluidas,
  acertos_apos_reflexao,
  (esperas_corretas * 3) + (atividades_concluidas * 5) + (acertos_apos_reflexao * 4) as controle,
  (cliques_antecipados * 4) + (respostas_impulsivas * 5) + (abandonos * 8)
    + (toques_repetitivos * 2) + (erros_precipitados * 3) as penalidade,
  greatest(0, least(100,
    50
    + ((esperas_corretas * 3) + (atividades_concluidas * 5) + (acertos_apos_reflexao * 4))
    - ((cliques_antecipados * 4) + (respostas_impulsivas * 5) + (abandonos * 8)
       + (toques_repetitivos * 2) + (erros_precipitados * 3))
  )) as indice
from public.v_impulsivity_raw_counts;

create or replace view public.v_impulsivity_classification
with (security_invoker = true) as
select
  profile_id,
  indice,
  case
    when indice >= 90 then 'Excelente controle inibitório'
    when indice >= 80 then 'Bom controle'
    when indice >= 70 then 'Dentro do esperado, com impulsividade ocasional'
    when indice >= 60 then 'Impulsividade moderada'
    when indice >= 40 then 'Impulsividade elevada'
    else 'Impulsividade muito elevada'
  end as classificacao
from public.v_impulsivity_index;

create or replace view public.v_impulsivity_dimensions
with (security_invoker = true) as
select
  profile_id,
  cliques_antecipados,
  toques_repetitivos,
  respostas_impulsivas,
  erros_precipitados,
  esperas_corretas,
  abandonos,
  atividades_concluidas,
  greatest(0, least(100, 50 + (atividades_concluidas * 2) - (toques_repetitivos * 2 + cliques_antecipados * 3)))
    as impulsividade_motora,
  greatest(0, least(100, 50 + (acertos_apos_reflexao * 3) - (respostas_impulsivas * 4 + erros_precipitados * 3)))
    as impulsividade_cognitiva,
  greatest(0, least(100, 50 + (esperas_corretas * 4) - (abandonos * 6)))
    as tolerancia_espera,
  round(
    0.40 * greatest(0, least(100, 50 + (atividades_concluidas * 2) - (toques_repetitivos * 2 + cliques_antecipados * 3)))
    + 0.35 * greatest(0, least(100, 50 + (acertos_apos_reflexao * 3) - (respostas_impulsivas * 4 + erros_precipitados * 3)))
    + 0.25 * greatest(0, least(100, 50 + (esperas_corretas * 4) - (abandonos * 6)))
  , 1) as indice_geral_ponderado
from public.v_impulsivity_raw_counts;

select 'ok' as status_parte_3;
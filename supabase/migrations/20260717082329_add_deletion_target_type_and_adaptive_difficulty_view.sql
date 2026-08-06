-- Adiciona 'deletion' como target_type válido, para a mecânica de deleção fonêmica
alter table public.game_events drop constraint if exists game_events_target_type_check;
alter table public.game_events add constraint game_events_target_type_check check (
  target_type is null or target_type in (
    'letter', 'syllable', 'word', 'instruction', 'sequence', 'image', 'rule',
    'grid', 'light', 'deletion'
  )
);

-- View: dificuldade recomendada por criança e jogo, baseada nas últimas 15
-- respostas (precisão + velocidade). Lógica:
--   > 85% de acerto e resposta rápida (abaixo da própria média histórica)
--     -> sobe dificuldade
--   < 60% de acerto -> desce dificuldade
--   entre os dois -> mantém
create or replace view public.v_recommended_difficulty as
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
from stats;

select 'ok' as status;
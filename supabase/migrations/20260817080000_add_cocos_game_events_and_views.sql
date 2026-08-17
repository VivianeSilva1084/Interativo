-- "Quantos Cocos?": 8º minijogo (Ilha do Foco), primeiro de numeracia -
-- comparação de magnitude não-simbólica/subitizing (a criança toca na pilha
-- com mais cocos, sem contar). Cada rodada é logada como
-- target_type='quantity', target=JSON{left,right} - precisa ampliar o CHECK
-- constraint. Lista real confirmada ao vivo antes desta migration via
-- execute_sql (mesma lição da migration do Cestas: não confiar cegamente no
-- arquivo de migration mais recente no disco).
ALTER TABLE public.game_events DROP CONSTRAINT game_events_target_type_check;
ALTER TABLE public.game_events ADD CONSTRAINT game_events_target_type_check
  CHECK (target_type IS NULL OR target_type = ANY (ARRAY[
    'letter','syllable','word','instruction','sequence','image','rule',
    'grid','light','deletion','emotion','strategy','move','quantity'
  ]));

-- Acurácia em rodadas de quantidade pequena (1-3, reconhecimento perceptivo
-- instantâneo / subitizing perceptivo) vs. grande (4+, exige subagrupamento
-- visual / subitizing conceitual) - a diferença entre as duas localiza onde
-- intervir (perceptivo intacto + conceitual fraco é um padrão clínico comum
-- e informativo). Gate n>=5 (Cocos tem 6-10 rodadas por sessão, mais volume
-- de dado por criança que Cestas, que é 1 problema por sessão).
CREATE VIEW public.v_cocos_small_qty_accuracy
WITH (security_invoker = true) AS
SELECT profile_id, accuracy_pct, n
FROM (
  SELECT
    game_events.profile_id,
    round(avg(game_events.correct::int) * 100) AS accuracy_pct,
    count(*) AS n
  FROM game_events
  WHERE game_events.game_key = 'cocos'
    AND game_events.event_type = 'answer'
    AND game_events.target_type = 'quantity'
    AND greatest(
      (game_events.target::jsonb ->> 'left')::int,
      (game_events.target::jsonb ->> 'right')::int
    ) <= 3
  GROUP BY game_events.profile_id
  HAVING count(*) >= 5
) t
WHERE has_premium_access(profile_id);

COMMENT ON VIEW public.v_cocos_small_qty_accuracy IS 'Acurácia (%) em rodadas de Quantos Cocos? com quantidade máxima <=3 (subitizing perceptivo, reconhecimento instantâneo). Gate n>=5 rodadas.';

CREATE VIEW public.v_cocos_large_qty_accuracy
WITH (security_invoker = true) AS
SELECT profile_id, accuracy_pct, n
FROM (
  SELECT
    game_events.profile_id,
    round(avg(game_events.correct::int) * 100) AS accuracy_pct,
    count(*) AS n
  FROM game_events
  WHERE game_events.game_key = 'cocos'
    AND game_events.event_type = 'answer'
    AND game_events.target_type = 'quantity'
    AND greatest(
      (game_events.target::jsonb ->> 'left')::int,
      (game_events.target::jsonb ->> 'right')::int
    ) > 3
  GROUP BY game_events.profile_id
  HAVING count(*) >= 5
) t
WHERE has_premium_access(profile_id);

COMMENT ON VIEW public.v_cocos_large_qty_accuracy IS 'Acurácia (%) em rodadas de Quantos Cocos? com quantidade máxima >3 (subitizing conceitual, exige subagrupamento visual). Gate n>=5 rodadas.';

-- Tempo médio de resposta só nas rodadas de quantidade pequena (<=3) - sinal
-- de automaticidade de reconhecimento (latências atipicamente altas nessa
-- faixa são um sinal clínico conhecido), não velocidade competitiva. Sem
-- timer no jogo, então é deliberação genuína.
CREATE VIEW public.v_cocos_deliberation_time
WITH (security_invoker = true) AS
SELECT profile_id, avg_response_ms, n
FROM (
  SELECT
    game_events.profile_id,
    avg(game_events.response_time_ms) AS avg_response_ms,
    count(*) AS n
  FROM game_events
  WHERE game_events.game_key = 'cocos'
    AND game_events.event_type = 'answer'
    AND game_events.target_type = 'quantity'
    AND game_events.response_time_ms IS NOT NULL
    AND greatest(
      (game_events.target::jsonb ->> 'left')::int,
      (game_events.target::jsonb ->> 'right')::int
    ) <= 3
  GROUP BY game_events.profile_id
  HAVING count(*) >= 5
) t
WHERE has_premium_access(profile_id);

COMMENT ON VIEW public.v_cocos_deliberation_time IS 'Tempo médio (ms) de resposta em rodadas de Quantos Cocos? com quantidade máxima <=3 - proxy de automaticidade de reconhecimento numérico, sem pressão de tempo externa (jogo não tem timer). Gate n>=5 rodadas.';

SELECT 'ok' AS status;

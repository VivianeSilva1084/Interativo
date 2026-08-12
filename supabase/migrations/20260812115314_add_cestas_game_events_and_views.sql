-- "Cestas da Ilha": 7º minijogo (Ilha do Foco), Torre de Londres adaptada
-- pra planejamento/função executiva. Cada movimento de fruta é logado como
-- target_type='move' - precisa ampliar o CHECK constraint (lista real
-- confirmada ao vivo antes desta migration, não a de nenhum arquivo local
-- antigo, senão remove 'emotion'/'strategy' de novo e quebra o Termômetro).
ALTER TABLE public.game_events DROP CONSTRAINT game_events_target_type_check;
ALTER TABLE public.game_events ADD CONSTRAINT game_events_target_type_check
  CHECK (target_type IS NULL OR target_type = ANY (ARRAY[
    'letter','syllable','word','instruction','sequence','image','rule',
    'grid','light','deletion','emotion','strategy','move'
  ]));

-- Índice de Planejamento = minMoves/movesUsed, extraído do context (JSON em
-- texto livre) do evento activity_complete de cada problema resolvido.
-- Gate n>=3 (Cestas é 1 problema por sessão, não múltiplas rodadas - volume
-- de dado por criança é menor que outros jogos).
--
-- NOTA: esta versão usa `context` pra guardar o JSON - corrigido na migration
-- seguinte (fix_cestas_views_use_target_not_context) pra usar `target`, já
-- que `context` tem CHECK constraint restrito a valores fixos e um INSERT de
-- teste real revelou isso antes de qualquer dado de produção ser afetado.
CREATE VIEW public.v_cestas_planning_index
WITH (security_invoker = true) AS
SELECT profile_id, avg_efficiency, n
FROM (
  SELECT
    game_events.profile_id,
    avg(
      (game_events.context::jsonb ->> 'minMoves')::numeric
      / NULLIF((game_events.context::jsonb ->> 'movesUsed')::numeric, 0)
    ) AS avg_efficiency,
    count(*) AS n
  FROM game_events
  WHERE game_events.game_key = 'cestas'
    AND game_events.event_type = 'activity_complete'
    AND game_events.context IS NOT NULL
  GROUP BY game_events.profile_id
  HAVING count(*) >= 3
) t
WHERE has_premium_access(profile_id);

COMMENT ON VIEW public.v_cestas_planning_index IS 'Eficiência média de planejamento (minMoves/movesUsed, 1.0=plano ótimo) em Cestas da Ilha. Extrai os dois números do context (JSON em texto) do evento activity_complete. Gate n>=3 problemas resolvidos.';

-- Tempo médio de deliberação inicial (da meta aparecer até o primeiro toque)
-- - proxy de impulsividade "pura", sem pressão de tempo externa (diferente
-- do Semáforo, que mede inibição sob pressão).
CREATE VIEW public.v_cestas_deliberation_time
WITH (security_invoker = true) AS
SELECT profile_id, avg_response_ms, n
FROM (
  SELECT
    game_events.profile_id,
    avg(game_events.response_time_ms) AS avg_response_ms,
    count(*) AS n
  FROM game_events
  WHERE game_events.game_key = 'cestas'
    AND game_events.event_type = 'answer'
    AND game_events.target_type = 'move'
    AND game_events.target = 'deliberation'
    AND game_events.response_time_ms IS NOT NULL
  GROUP BY game_events.profile_id
) t
WHERE has_premium_access(profile_id);

COMMENT ON VIEW public.v_cestas_deliberation_time IS 'Tempo médio (ms) entre a meta aparecer e o primeiro toque em Cestas da Ilha - sem timer no jogo, então é deliberação genuína, não reação sob pressão.';

-- Reinícios voluntários (botão sempre visível, não é punição - a criança
-- pediu pra recomeçar o mesmo problema).
--
-- NOTA: esta versão usa `context='voluntary'` - corrigido na migration
-- seguinte pra usar `target='voluntary'`, mesmo motivo acima.
CREATE VIEW public.v_cestas_voluntary_restarts
WITH (security_invoker = true) AS
SELECT profile_id, restarts
FROM (
  SELECT
    game_events.profile_id,
    count(*) AS restarts
  FROM game_events
  WHERE game_events.game_key = 'cestas'
    AND game_events.event_type = 'retry'
    AND game_events.context = 'voluntary'
  GROUP BY game_events.profile_id
) t
WHERE has_premium_access(profile_id);

COMMENT ON VIEW public.v_cestas_voluntary_restarts IS 'Contagem de reinícios voluntários (botão "recomeçar" sempre visível durante o jogo) em Cestas da Ilha, distintos do replanejamento automático ao bater o teto de movimentos.';

SELECT 'ok' AS status;

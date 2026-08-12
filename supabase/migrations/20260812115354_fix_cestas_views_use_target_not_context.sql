-- Corrige um erro na migration anterior (add_cestas_game_events_and_views):
-- desenhei o marcador de deliberação/reinício voluntário/eficiência usando
-- context='first_touch'/'voluntary' e um JSON em context para o
-- activity_complete - mas `context` tem CHECK constraint restrito a
-- ('after_error','after_wait','after_loss','general'), confirmado agora com
-- um INSERT de teste real que falhou (mesma classe de erro do Termômetro:
-- assumir que uma coluna text é livre sem checar o CHECK primeiro). `target`
-- não tem CHECK - usa esse campo em vez de context pros marcadores/JSON.
CREATE OR REPLACE VIEW public.v_cestas_planning_index
WITH (security_invoker = true) AS
SELECT profile_id, avg_efficiency, n
FROM (
  SELECT
    game_events.profile_id,
    avg(
      (game_events.target::jsonb ->> 'minMoves')::numeric
      / NULLIF((game_events.target::jsonb ->> 'movesUsed')::numeric, 0)
    ) AS avg_efficiency,
    count(*) AS n
  FROM game_events
  WHERE game_events.game_key = 'cestas'
    AND game_events.event_type = 'activity_complete'
    AND game_events.target IS NOT NULL
  GROUP BY game_events.profile_id
  HAVING count(*) >= 3
) t
WHERE has_premium_access(profile_id);

CREATE OR REPLACE VIEW public.v_cestas_voluntary_restarts
WITH (security_invoker = true) AS
SELECT profile_id, restarts
FROM (
  SELECT
    game_events.profile_id,
    count(*) AS restarts
  FROM game_events
  WHERE game_events.game_key = 'cestas'
    AND game_events.event_type = 'retry'
    AND game_events.target = 'voluntary'
  GROUP BY game_events.profile_id
) t
WHERE has_premium_access(profile_id);

SELECT 'ok' AS status;

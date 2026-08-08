-- Adds intra-individual response-time variability (coefficient of
-- variation = SD/mean) to the existing avg/best response-time trend.
-- Per clinical review: CV (not raw SD) so it's comparable across children/
-- sessions with different average speeds; computed strictly per game
-- (never pooled across games, which have different pacing/motor demands);
-- gated at n_trials >= 15 (set NULL below that) since it's gameplay-derived,
-- not a standardized CPT, and noisy with too few trials.
CREATE OR REPLACE VIEW public.v_response_time_trend
WITH (security_invoker = true) AS
SELECT
  profile_id,
  game_key,
  month,
  avg_response_time_ms,
  best_response_time_ms,
  n_trials,
  CASE
    WHEN n_trials >= 15 AND avg_response_time_ms > 0
    THEN round((stddev_response_time_ms / avg_response_time_ms)::numeric, 3)
    ELSE NULL
  END AS cv_response_time
FROM (
  SELECT
    game_events.profile_id,
    game_events.game_key,
    date_trunc('month'::text, game_events.occurred_at) AS month,
    avg(game_events.response_time_ms) AS avg_response_time_ms,
    min(game_events.response_time_ms) AS best_response_time_ms,
    stddev_samp(game_events.response_time_ms) AS stddev_response_time_ms,
    count(*) AS n_trials
  FROM game_events
  WHERE game_events.event_type = 'answer'::text AND game_events.response_time_ms IS NOT NULL
  GROUP BY game_events.profile_id, game_events.game_key, (date_trunc('month'::text, game_events.occurred_at))
) t
WHERE has_premium_access(profile_id);

COMMENT ON VIEW public.v_response_time_trend IS 'Tendência mensal de tempo de resposta por jogo (média, melhor tempo, e variabilidade via coeficiente de variação = DP/média). cv_response_time é NULL com menos de 15 respostas no mês - medida derivada de gameplay, não equivalente a um CPT padronizado; ver Metodologia no painel profissional.';

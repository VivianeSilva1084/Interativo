CREATE OR REPLACE VIEW v_rule_adaptation AS
SELECT profile_id, game_key, rule_changed_at, time_to_adapt_ms
FROM (
  SELECT
    ge1.profile_id,
    ge1.game_key,
    ge1.occurred_at AS rule_changed_at,
    (
      SELECT ge2.response_time_ms
      FROM game_events ge2
      WHERE ge2.profile_id = ge1.profile_id
        AND ge2.event_type = 'answer'
        AND ge2.correct = true
        AND ge2.occurred_at > ge1.occurred_at
      ORDER BY ge2.occurred_at ASC
      LIMIT 1
    ) AS time_to_adapt_ms
  FROM game_events ge1
  WHERE ge1.event_type = 'rule_change'
) t
WHERE has_premium_access(profile_id);
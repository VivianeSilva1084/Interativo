CREATE VIEW v_perseverative_errors AS
SELECT profile_id, game_key, count(*) AS perseverative_count
FROM game_events
WHERE error_type = 'perseverativa'
GROUP BY profile_id, game_key
HAVING has_premium_access(profile_id);
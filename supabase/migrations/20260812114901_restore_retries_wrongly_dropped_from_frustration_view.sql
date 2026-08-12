-- Corrige um erro real cometido na migration anterior
-- (drop_dead_retries_from_frustration_view, 20260812102233): eu tinha
-- concluído que event_type='retry' nunca era emitido por nenhum jogo, mas o
-- grep que embasou essa conclusão só cobriu src/ - os botões "Jogar de novo"
-- de História e Caça ao Alvo disparam
-- onclick="logGameEvent({eventType:'retry'}); ..." INLINE em index.html
-- (fora de src/), então não apareceram na busca. Confirmado com dado real:
-- 81 eventos retry em game_key='historia' e 23 em 'cacaalvo' já existem na
-- tabela. Não era dado morto - era um sinal real e coerente com a intenção
-- original ("tentando novamente após um desempenho imperfeito"), só que
-- restrito a esses 2 jogos (os únicos com botão "jogar de novo" nesse
-- padrão), nunca universal como os outros 6/7 jogos.
--
-- Restaura a coluna. abandons/help_requests continuam como estavam.
DROP VIEW public.v_frustration_raw;

CREATE VIEW public.v_frustration_raw
WITH (security_invoker = true) AS
SELECT profile_id, game_key, abandons, help_requests, retries
FROM (
  SELECT
    game_events.profile_id,
    game_events.game_key,
    count(*) FILTER (WHERE game_events.event_type = 'abandon'::text) AS abandons,
    count(*) FILTER (WHERE game_events.event_type = 'help_request'::text) AS help_requests,
    count(*) FILTER (WHERE game_events.event_type = 'retry'::text) AS retries
  FROM game_events
  WHERE game_events.event_type = ANY (ARRAY['abandon'::text, 'help_request'::text, 'retry'::text])
  GROUP BY game_events.profile_id, game_events.game_key
) t
WHERE has_premium_access(profile_id);

COMMENT ON VIEW public.v_frustration_raw IS 'Abandonos, pedidos de ajuda e reinícios voluntários por jogo (ingredientes brutos do relatório "Tolerância à frustração"). retries só é emitido hoje pelos botões "Jogar de novo" de História e Caça ao Alvo (onclick inline em index.html) - não é universal aos 7 jogos, mas é real, não dado morto (corrige um engano da migration 20260812102233, que removeu esta coluna com base numa busca incompleta).';

SELECT 'ok' AS status;

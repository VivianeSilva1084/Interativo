-- Documentação retroativa: aplicada via MCP apply_migration sem espelho local
-- na hora (corrigido nesta migration de reconciliação). Conteúdo idêntico ao
-- que rodou em produção.
--
-- v_frustration_raw.retries contava event_type='retry', mas nenhum jogo em
-- nenhum dos dois apps (Ilha do Foco, Aventura das Letras) jamais emitiu esse
-- evento - grep confirmou 0 ocorrências nos dois codebases. É dado morto desde
-- que a view foi criada: sempre 0 pra toda criança, em todo relatório
-- ("Tentativas de novo" no painel profissional, e o ramo positivo de
-- persistenceGood() no Resumo Clínico, que por causa disso nunca disparava).
-- Mesma classe de bug do attention_index/distraction já corrigido em
-- 20260812081234_unify_child_metrics_daily_formulas.sql.
--
-- abandons e help_requests continuam - ambos são reais (confirmados em
-- src/lib/game-shared.js e src/hooks/useGameSession.ts + várias telas de jogo).
--
-- CREATE OR REPLACE VIEW não permite remover coluna - precisa DROP + CREATE.
DROP VIEW public.v_frustration_raw;

CREATE VIEW public.v_frustration_raw
WITH (security_invoker = true) AS
SELECT profile_id, game_key, abandons, help_requests
FROM (
  SELECT
    game_events.profile_id,
    game_events.game_key,
    count(*) FILTER (WHERE game_events.event_type = 'abandon'::text) AS abandons,
    count(*) FILTER (WHERE game_events.event_type = 'help_request'::text) AS help_requests
  FROM game_events
  WHERE game_events.event_type = ANY (ARRAY['abandon'::text, 'help_request'::text])
  GROUP BY game_events.profile_id, game_events.game_key
) t
WHERE has_premium_access(profile_id);

COMMENT ON VIEW public.v_frustration_raw IS 'Abandonos e pedidos de ajuda por jogo (ingredientes brutos do relatório "Tolerância à frustração"). Coluna retries removida - nenhum jogo usava event_type=retry pra popular ESTA view especificamente (era sempre 0 aqui, mesmo que retry já existisse no schema/CHECK e fosse usado por outros botões de "jogar de novo" não capturados por este agregado).';

SELECT 'ok' AS status;

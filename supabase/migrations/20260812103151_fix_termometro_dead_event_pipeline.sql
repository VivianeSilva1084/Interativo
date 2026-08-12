-- Documentação retroativa: aplicada via MCP apply_migration sem espelho local
-- na hora (corrigido nesta migration de reconciliação). Conteúdo idêntico ao
-- que rodou em produção.
--
-- O Termômetro das Emoções (src/games/termometro.js) tenta gravar 3 eventos
-- por rodada, e os 3 sempre falhavam por violação de CHECK constraint - não
-- era dado morto (coluna nunca preenchida), era INSERT que sempre falhou
-- desde que o jogo existe: target_type='emotion'/'strategy' nunca esteve na
-- lista permitida, e emotion=opt.label (ex: 'Bravo') não bate com o
-- vocabulário de game_events.emotion ('tranquilo'/'neutro'/'irritado'/
-- 'chorou' - um conceito diferente, de check-in de humor observado, que
-- nenhum jogo usa corretamente hoje). logGameEvent() só faz console.error no
-- erro, nunca propaga - por isso ninguém percebeu.
--
-- Amplia só target_type (emotion/strategy são rótulos legítimos do que está
-- sendo respondido). Não mexe em emotion/context - a chamada que usava esse
-- vocabulário errado foi removida do jogo em vez de forçada a caber.
ALTER TABLE public.game_events DROP CONSTRAINT game_events_target_type_check;
ALTER TABLE public.game_events ADD CONSTRAINT game_events_target_type_check
  CHECK (target_type IS NULL OR target_type = ANY (ARRAY[
    'letter','syllable','word','instruction','sequence','image','rule',
    'grid','light','deletion','emotion','strategy'
  ]));

-- v_emotion_log (20260716125813_create_game_events_and_clinical_views.sql)
-- também depende desse vocabulário emotion/context e nunca teve produtor
-- válido em nenhum jogo nem consumidor em nenhum dashboard - documentando
-- como reservada, não removendo (pode ter uso futuro genuíno fora do escopo
-- desta correção).
COMMENT ON VIEW public.v_emotion_log IS 'Reservada para um futuro check-in de humor observado (emotion/context) - hoje nenhum jogo grava esses valores corretamente e nenhum dashboard lê esta view. Não confundir com o Termômetro das Emoções, que usa target_type=emotion/strategy em vez disso (ver v_thermo_response_time/v_thermo_strategy_diversity).';

-- Tempo médio de decisão ao identificar uma emoção e ao escolher uma
-- estratégia de acalmar - sinal descritivo, não normativo (não existe
-- "resposta certa" em nenhuma das duas escolhas). Gate de n>=8 (~2 sessões)
-- para não mostrar número instável de uma única sessão de 2-4 rodadas
-- (DIFF.termometro em src/lib/game-progress.js) - mesmo princípio do gate
-- n>=15 em v_response_time_trend.cv_response_time.
CREATE VIEW public.v_thermo_response_time
WITH (security_invoker = true) AS
SELECT profile_id, target_type, avg_response_ms, n
FROM (
  SELECT
    game_events.profile_id,
    game_events.target_type,
    avg(game_events.response_time_ms) AS avg_response_ms,
    count(*) AS n
  FROM game_events
  WHERE game_events.game_key = 'termometro'
    AND game_events.event_type = 'answer'
    AND game_events.target_type IN ('emotion', 'strategy')
    AND game_events.response_time_ms IS NOT NULL
  GROUP BY game_events.profile_id, game_events.target_type
  HAVING count(*) >= 8
) t
WHERE has_premium_access(profile_id);

-- Quantas das 4 estratégias de acalmar (respirar/contar/abraço/água) a
-- criança já usou - repertório/flexibilidade, não "estratégia certa". Exige
-- target=opt.id no evento (adicionado em termometro.js nesta mesma correção -
-- antes o target desse evento ficava sempre null).
CREATE VIEW public.v_thermo_strategy_diversity
WITH (security_invoker = true) AS
SELECT profile_id, strategies_used, total_rounds
FROM (
  SELECT
    game_events.profile_id,
    count(DISTINCT game_events.target) AS strategies_used,
    count(*) AS total_rounds
  FROM game_events
  WHERE game_events.game_key = 'termometro'
    AND game_events.event_type = 'answer'
    AND game_events.target_type = 'strategy'
    AND game_events.target IS NOT NULL
  GROUP BY game_events.profile_id
  HAVING count(*) >= 8
) t
WHERE has_premium_access(profile_id);

SELECT 'ok' AS status;

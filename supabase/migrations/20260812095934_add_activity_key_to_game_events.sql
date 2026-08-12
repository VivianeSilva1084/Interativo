-- Documentação retroativa: aplicada via MCP apply_migration sem espelho local
-- na hora (corrigido nesta migration de reconciliação). Conteúdo idêntico ao
-- que rodou em produção.
--
-- Aventura das Letras tem 8 minijogos (Mundo das Sílabas, Sílabas Camufladas,
-- Captura de Sílabas, Som e Sílabas, Monte a Palavra, Floresta das Palavras,
-- Castelo das Frases, Sílaba Escondida), mas todos gravam game_events com o
-- MESMO game_key='aventura_das_letras' - hoje é impossível saber qual dos 8
-- minijogos tem mais dificuldade pra uma criança (mesmo target_type='syllable'
-- é compartilhado por 4 deles).
--
-- Em vez de trocar o game_key por minijogo (o que reiniciaria a dificuldade
-- adaptativa hoje compartilhada entre os 8, já que getRecommendedDifficulty/
-- getLastGameDifficulty são escopadas por game_key - regressão real pra
-- crianças com progresso), adiciona uma coluna aditiva e opcional só para
-- granularidade de relatório. game_key/sessão/dificuldade adaptativa continuam
-- exatamente como estão.
ALTER TABLE public.game_events ADD COLUMN IF NOT EXISTS activity_key text;

COMMENT ON COLUMN public.game_events.activity_key IS 'Slug opcional do minijogo específico dentro de um game_key compartilhado (hoje só usado por Aventura das Letras, que tem 8 minijogos sob game_key=aventura_das_letras). NULL para eventos que não precisam dessa granularidade. Não afeta game_key/sessão/dificuldade adaptativa.';

CREATE INDEX IF NOT EXISTS idx_game_events_activity ON public.game_events (profile_id, game_key, activity_key) WHERE activity_key IS NOT NULL;

-- Mesmo padrão de v_syllable_difficulty (filtra event_type='answer', agrupa,
-- calcula accuracy_pct, gate has_premium_access) - só que por atividade em vez
-- de por sílaba, pra responder "quais atividades têm mais dificuldade".
CREATE OR REPLACE VIEW public.v_activity_difficulty AS
SELECT profile_id, game_key, activity_key, attempts, correct_count, accuracy_pct
FROM (
  SELECT
    game_events.profile_id,
    game_events.game_key,
    game_events.activity_key,
    count(*) AS attempts,
    count(*) FILTER (WHERE game_events.correct = true) AS correct_count,
    round(100.0 * count(*) FILTER (WHERE game_events.correct = true)::numeric / NULLIF(count(*), 0)::numeric, 1) AS accuracy_pct
  FROM game_events
  WHERE game_events.event_type = 'answer' AND game_events.activity_key IS NOT NULL
  GROUP BY game_events.profile_id, game_events.game_key, game_events.activity_key
) t
WHERE has_premium_access(profile_id);

COMMENT ON VIEW public.v_activity_difficulty IS 'Dificuldade (accuracy_pct) por minijogo específico (activity_key), pra distinguir atividades que hoje compartilham game_key (ex: os 8 minijogos de Aventura das Letras). Vazio até os apps começarem a popular activity_key.';

SELECT 'ok' AS status;

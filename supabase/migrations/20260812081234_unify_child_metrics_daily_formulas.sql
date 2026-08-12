-- Unifica as fórmulas de child_metrics_daily (Módulo 6, calculado via
-- pg_cron mas nunca consumido pelo frontend até agora) com a lógica já em
-- produção nas views clínicas "Camada A" (v_impulsivity_index, v_working_memory,
-- v_response_time_trend), para que o novo "Relatório de Indicadores" do painel
-- profissional não divirja do que os relatórios existentes já mostram.
--
-- Também corrige um bug real: attention_index dependia de event_type='distraction',
-- mas nenhum jogo (src/games/*.js) emite esse evento — focus_ratio sempre computava
-- 1 (100%) artificialmente. Substituído por consistência de tempo de resposta
-- (coeficiente de variação, mesmo princípio de v_response_time_trend.cv_response_time
-- em 20260808081542_add_response_time_variability.sql), calculada por jogo numa
-- janela de 7 dias.
--
-- memory_score deixa de ser acurácia de resposta e passa a ser a maior sequência
-- correta do dia dividida pelo teto de dificuldade atual da criança no jogo
-- 'memoria' (startLen + maxLevel - 1, espelhando DIFF.memoria em
-- src/lib/game-progress.js:16 — se esses números mudarem lá, precisam mudar aqui
-- também, não há fonte única compartilhada entre JS e SQL).

CREATE OR REPLACE FUNCTION public.compute_child_metrics_daily(p_target_date date DEFAULT (current_date - 1))
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_child record;
  v_sessions_completed integer;
  v_sessions_abandoned integer;
  v_total_usage_seconds integer;
  v_avg_response_time_ms numeric;
  v_completion_ratio numeric;
  v_consistency_score numeric;
  v_attention_index numeric;

  v_cliques_antecipados integer;
  v_respostas_impulsivas integer;
  v_abandonos integer;
  v_toques_repetitivos integer;
  v_esperas_corretas integer;
  v_atividades_concluidas integer;
  v_acertos_apos_reflexao integer;
  v_erros_precipitados integer;
  v_total_scored_events integer;
  v_impulsivity_index numeric;

  v_memory_best_len integer;
  v_memoria_difficulty text;
  v_memory_ceiling numeric;
  v_memory_score numeric;

  v_goal_sessions_per_week integer;
  v_actual_sessions_7d integer;
  v_persistence_score numeric;
  v_mastered_syllables_count integer;
  v_read_words_count integer;
  v_challenges_completed integer;
BEGIN
  FOR v_child IN SELECT id FROM public.child_profiles LOOP

    -- Sessões do dia (inalterado)
    SELECT
      count(*) FILTER (WHERE status = 'completed'),
      count(*) FILTER (WHERE status = 'abandoned'),
      coalesce(sum(extract(epoch FROM (end_time - start_time))) FILTER (WHERE end_time IS NOT NULL), 0)::integer
    INTO v_sessions_completed, v_sessions_abandoned, v_total_usage_seconds
    FROM public.game_sessions
    WHERE profile_id = v_child.id
      AND start_time::date = p_target_date;

    -- Tempo médio de resposta do dia (inalterado, só perdeu as colunas de distraction/impulsive)
    SELECT avg(response_time_ms) FILTER (WHERE response_time_ms IS NOT NULL)
    INTO v_avg_response_time_ms
    FROM public.game_events
    WHERE profile_id = v_child.id
      AND occurred_at::date = p_target_date
      AND event_type = 'answer';

    v_completion_ratio := CASE WHEN (v_sessions_completed + v_sessions_abandoned) > 0
      THEN v_sessions_completed::numeric / (v_sessions_completed + v_sessions_abandoned) ELSE NULL END;

    -- Consistência de tempo de resposta (proxy de atenção) por jogo, janela de 7
    -- dias terminando em p_target_date, só entra com >= 10 respostas naquele jogo
    -- naquela janela. Normalizado 0-100 por jogo antes de combinar entre jogos
    -- (CV é adimensional; ms bruto não pode ser somado entre jogos com ritmos diferentes).
    WITH cv_por_jogo AS (
      SELECT
        game_key,
        stddev_samp(response_time_ms) AS sd,
        avg(response_time_ms) AS media,
        count(*) AS n
      FROM public.game_events
      WHERE profile_id = v_child.id
        AND event_type = 'answer'
        AND response_time_ms IS NOT NULL
        AND occurred_at::date BETWEEN (p_target_date - 6) AND p_target_date
      GROUP BY game_key
      HAVING count(*) >= 10
    ),
    score_por_jogo AS (
      SELECT greatest(0, least(100, (1 - least(sd / nullif(media, 0), 1)) * 100)) AS score
      FROM cv_por_jogo
    )
    SELECT avg(score) INTO v_consistency_score FROM score_por_jogo;

    v_attention_index := CASE
      WHEN v_completion_ratio IS NOT NULL AND v_consistency_score IS NOT NULL
        THEN ((v_completion_ratio * 100) + v_consistency_score) / 2
      WHEN v_completion_ratio IS NOT NULL THEN v_completion_ratio * 100
      WHEN v_consistency_score IS NOT NULL THEN v_consistency_score
      ELSE NULL
    END;

    -- Controle inibitório / impulsividade: mesma fórmula ponderada de
    -- v_impulsivity_index (20260716130419_create_impulsivity_index_views_v2.sql),
    -- escopada ao dia-alvo. Baseline de "tempo típico de resposta" (usado para
    -- detectar erros precipitados) olha 30 dias pra trás, não só o próprio dia
    -- (senão a comparação seria circular - o dia se compararia consigo mesmo).
    WITH dia AS (
      SELECT *
      FROM public.game_events
      WHERE profile_id = v_child.id AND occurred_at::date = p_target_date
    ),
    baseline_30d AS (
      SELECT target_type, avg(response_time_ms) AS avg_target_response_ms
      FROM public.game_events
      WHERE profile_id = v_child.id
        AND event_type = 'answer'
        AND occurred_at::date BETWEEN (p_target_date - 29) AND p_target_date
      GROUP BY target_type
    ),
    erros_precipitados_calc AS (
      SELECT count(*) AS erros_precipitados
      FROM dia d
      JOIN baseline_30d b ON b.target_type = d.target_type
      WHERE d.event_type = 'answer'
        AND d.correct = false
        AND coalesce(d.error_type, '') <> 'impulsiva'
        AND d.response_time_ms IS NOT NULL
        AND b.avg_target_response_ms IS NOT NULL
        AND d.response_time_ms < 0.5 * b.avg_target_response_ms
    )
    SELECT
      count(*) FILTER (WHERE event_type = 'premature_click'),
      count(*) FILTER (WHERE event_type = 'answer' AND error_type = 'impulsiva'),
      count(*) FILTER (WHERE event_type = 'abandon'),
      count(*) FILTER (WHERE event_type = 'repeated_tap'),
      count(*) FILTER (WHERE event_type = 'wait_task' AND correct = true),
      count(*) FILTER (WHERE event_type = 'activity_complete'),
      count(*) FILTER (WHERE event_type = 'answer' AND correct = true),
      coalesce((SELECT erros_precipitados FROM erros_precipitados_calc), 0)
    INTO
      v_cliques_antecipados, v_respostas_impulsivas, v_abandonos, v_toques_repetitivos,
      v_esperas_corretas, v_atividades_concluidas, v_acertos_apos_reflexao, v_erros_precipitados
    FROM dia;

    v_total_scored_events := v_cliques_antecipados + v_respostas_impulsivas + v_abandonos
      + v_toques_repetitivos + v_esperas_corretas + v_atividades_concluidas
      + v_acertos_apos_reflexao + v_erros_precipitados;

    v_impulsivity_index := CASE WHEN v_total_scored_events = 0 THEN NULL ELSE
      greatest(0, least(100,
        50
        + (v_esperas_corretas * 3 + v_atividades_concluidas * 5 + v_acertos_apos_reflexao * 4)
        - (v_cliques_antecipados * 4 + v_respostas_impulsivas * 5 + v_abandonos * 8
           + v_toques_repetitivos * 2 + v_erros_precipitados * 3)
      ))
    END;

    -- Memória de trabalho: maior sequência correta do dia / teto de dificuldade atual
    SELECT max(length(target)) FILTER (WHERE correct = true)
    INTO v_memory_best_len
    FROM public.game_events
    WHERE profile_id = v_child.id
      AND occurred_at::date = p_target_date
      AND game_key = 'memoria'
      AND target_type = 'sequence';

    SELECT coalesce(difficulty_by_game ->> 'memoria', 'medio') INTO v_memoria_difficulty
    FROM public.child_profiles WHERE id = v_child.id;

    v_memory_ceiling := CASE v_memoria_difficulty
      WHEN 'facil' THEN 5    -- startLen 2 + maxLevel 4 - 1
      WHEN 'dificil' THEN 10 -- startLen 3 + maxLevel 8 - 1
      ELSE 7                 -- 'medio' (e qualquer valor não reconhecido) - startLen 2 + maxLevel 6 - 1
    END;

    v_memory_score := CASE WHEN v_memory_best_len IS NOT NULL
      THEN least(100, (v_memory_best_len::numeric / v_memory_ceiling) * 100)
      ELSE NULL END;

    -- Persistência / adesão (inalterado)
    SELECT coalesce(sum(sessions_per_week), 0) INTO v_goal_sessions_per_week
    FROM public.adherence_goals
    WHERE child_profile_id = v_child.id;

    SELECT count(*) INTO v_actual_sessions_7d
    FROM public.game_sessions
    WHERE profile_id = v_child.id
      AND start_time::date BETWEEN (p_target_date - 6) AND p_target_date
      AND status = 'completed';

    v_persistence_score := CASE WHEN v_goal_sessions_per_week > 0
      THEN least(100, (v_actual_sessions_7d::numeric / v_goal_sessions_per_week) * 100) ELSE NULL END;

    -- Leitura (inalterado)
    SELECT
      jsonb_array_length(coalesce(mastered_syllables, '[]'::jsonb)),
      jsonb_array_length(coalesce(read_words, '[]'::jsonb)),
      challenges_completed
    INTO v_mastered_syllables_count, v_read_words_count, v_challenges_completed
    FROM public.reading_progress
    WHERE child_profile_id = v_child.id;

    INSERT INTO public.child_metrics_daily (
      child_profile_id, metric_date,
      attention_index, impulsivity_index, memory_score, avg_response_time_ms, persistence_score,
      mastered_syllables_count, read_words_count, challenges_completed,
      sessions_completed, sessions_abandoned, total_usage_seconds
    ) VALUES (
      v_child.id, p_target_date,
      v_attention_index, v_impulsivity_index, v_memory_score, v_avg_response_time_ms, v_persistence_score,
      v_mastered_syllables_count, v_read_words_count, v_challenges_completed,
      v_sessions_completed, v_sessions_abandoned, v_total_usage_seconds
    )
    ON CONFLICT (child_profile_id, metric_date) DO UPDATE SET
      attention_index = EXCLUDED.attention_index,
      impulsivity_index = EXCLUDED.impulsivity_index,
      memory_score = EXCLUDED.memory_score,
      avg_response_time_ms = EXCLUDED.avg_response_time_ms,
      persistence_score = EXCLUDED.persistence_score,
      mastered_syllables_count = EXCLUDED.mastered_syllables_count,
      read_words_count = EXCLUDED.read_words_count,
      challenges_completed = EXCLUDED.challenges_completed,
      sessions_completed = EXCLUDED.sessions_completed,
      sessions_abandoned = EXCLUDED.sessions_abandoned,
      total_usage_seconds = EXCLUDED.total_usage_seconds;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.compute_child_metrics_daily(date) FROM PUBLIC, anon, authenticated;

COMMENT ON COLUMN public.child_metrics_daily.attention_index IS 'Combinação (0-100) entre taxa de sessões completadas (vs abandonadas) no dia e consistência do tempo de resposta por jogo numa janela de 7 dias (coeficiente de variação, só com >=10 respostas no jogo na janela). NULL = dado insuficiente. Não depende mais de event_type=distraction (nunca emitido por nenhum jogo).';
COMMENT ON COLUMN public.child_metrics_daily.impulsivity_index IS 'Controle inibitório (0-100) - mesma fórmula ponderada de v_impulsivity_index (esperas corretas/atividades concluídas/acertos após reflexão somam, cliques antecipados/respostas impulsivas/abandonos/toques repetitivos/erros precipitados subtraem, ancorado em 50), escopada ao dia-alvo. NULL = nenhum evento pontuável no dia.';
COMMENT ON COLUMN public.child_metrics_daily.memory_score IS 'Maior sequência correta do dia no jogo memoria, dividida pelo teto de dificuldade atual da criança (facil=5, medio=7, dificil=10 - espelha DIFF.memoria em src/lib/game-progress.js), em %. NULL = jogo memoria não jogado no dia.';

SELECT 'ok' AS status;

CREATE TABLE public.child_metrics_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_profile_id uuid NOT NULL REFERENCES public.child_profiles(id),
  metric_date date NOT NULL,
  attention_index numeric,
  impulsivity_index numeric,
  memory_score numeric,
  avg_response_time_ms numeric,
  persistence_score numeric,
  mastered_syllables_count integer,
  read_words_count integer,
  challenges_completed integer,
  sessions_completed integer NOT NULL DEFAULT 0,
  sessions_abandoned integer NOT NULL DEFAULT 0,
  total_usage_seconds integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (child_profile_id, metric_date)
);

CREATE INDEX child_metrics_daily_child_profile_id_idx ON public.child_metrics_daily(child_profile_id);

ALTER TABLE public.child_metrics_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "families read own child metrics" ON public.child_metrics_daily
  FOR SELECT TO authenticated USING (is_own_child_profile(child_profile_id));

CREATE POLICY "professional reads linked child metrics" ON public.child_metrics_daily
  FOR SELECT TO authenticated USING (is_linked_professional_for_child(child_profile_id));

COMMENT ON TABLE public.child_metrics_daily IS 'Indicadores agregados por criança/dia (Módulo 6) — escrito só por compute_child_metrics_daily() via pg_cron, nunca pelo client.';
COMMENT ON COLUMN public.child_metrics_daily.attention_index IS 'Média (0-100) entre taxa de sessões completadas (vs abandonadas) e taxa de eventos sem distração no dia. NULL = dado insuficiente (nenhuma sessão/evento no dia).';
COMMENT ON COLUMN public.child_metrics_daily.impulsivity_index IS 'Frequência (0-100) de eventos impulsivos (premature_click/repeated_tap/error_type=impulsiva) sobre o total de respostas do dia. NULL = sem respostas no dia.';
COMMENT ON COLUMN public.child_metrics_daily.memory_score IS 'Acurácia (0-100) nos eventos do jogo game_key=memoria no dia. NULL = jogo memoria não jogado no dia.';
COMMENT ON COLUMN public.child_metrics_daily.persistence_score IS 'Sessões completadas nos últimos 7 dias vs soma de adherence_goals.sessions_per_week da criança (capado em 100). NULL = sem meta de adesão cadastrada.';
COMMENT ON COLUMN public.child_metrics_daily.mastered_syllables_count IS 'Snapshot cumulativo (não é delta do dia) de reading_progress.mastered_syllables no momento do cálculo.';

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
  v_total_answer_events integer;
  v_distraction_events integer;
  v_impulsive_events integer;
  v_avg_response_time_ms numeric;
  v_memory_correct integer;
  v_memory_total integer;
  v_memory_score numeric;
  v_completion_ratio numeric;
  v_focus_ratio numeric;
  v_attention_index numeric;
  v_impulsivity_index numeric;
  v_goal_sessions_per_week integer;
  v_actual_sessions_7d integer;
  v_persistence_score numeric;
  v_mastered_syllables_count integer;
  v_read_words_count integer;
  v_challenges_completed integer;
BEGIN
  FOR v_child IN SELECT id FROM public.child_profiles LOOP
    SELECT
      count(*) FILTER (WHERE status = 'completed'),
      count(*) FILTER (WHERE status = 'abandoned'),
      coalesce(sum(extract(epoch FROM (end_time - start_time))) FILTER (WHERE end_time IS NOT NULL), 0)::integer
    INTO v_sessions_completed, v_sessions_abandoned, v_total_usage_seconds
    FROM public.game_sessions
    WHERE profile_id = v_child.id
      AND start_time::date = p_target_date;

    SELECT
      count(*) FILTER (WHERE event_type = 'answer'),
      count(*) FILTER (WHERE event_type = 'distraction'),
      count(*) FILTER (WHERE event_type IN ('premature_click', 'repeated_tap') OR error_type = 'impulsiva'),
      avg(response_time_ms) FILTER (WHERE response_time_ms IS NOT NULL)
    INTO v_total_answer_events, v_distraction_events, v_impulsive_events, v_avg_response_time_ms
    FROM public.game_events
    WHERE profile_id = v_child.id
      AND occurred_at::date = p_target_date;

    SELECT
      count(*) FILTER (WHERE correct = true),
      count(*)
    INTO v_memory_correct, v_memory_total
    FROM public.game_events
    WHERE profile_id = v_child.id
      AND occurred_at::date = p_target_date
      AND game_key = 'memoria'
      AND event_type = 'answer';

    v_memory_score := CASE WHEN v_memory_total > 0 THEN (v_memory_correct::numeric / v_memory_total) * 100 ELSE NULL END;

    v_completion_ratio := CASE WHEN (v_sessions_completed + v_sessions_abandoned) > 0
      THEN v_sessions_completed::numeric / (v_sessions_completed + v_sessions_abandoned) ELSE NULL END;
    v_focus_ratio := CASE WHEN (v_total_answer_events + v_distraction_events) > 0
      THEN 1 - (v_distraction_events::numeric / (v_total_answer_events + v_distraction_events)) ELSE NULL END;
    v_attention_index := CASE
      WHEN v_completion_ratio IS NOT NULL AND v_focus_ratio IS NOT NULL THEN ((v_completion_ratio + v_focus_ratio) / 2) * 100
      WHEN v_completion_ratio IS NOT NULL THEN v_completion_ratio * 100
      WHEN v_focus_ratio IS NOT NULL THEN v_focus_ratio * 100
      ELSE NULL
    END;

    v_impulsivity_index := CASE WHEN v_total_answer_events > 0
      THEN (v_impulsive_events::numeric / v_total_answer_events) * 100 ELSE NULL END;

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

SELECT cron.schedule(
  'compute-child-metrics-daily',
  '0 3 * * *',
  $$SELECT public.compute_child_metrics_daily();$$
);
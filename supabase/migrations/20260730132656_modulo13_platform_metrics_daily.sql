CREATE TABLE public.platform_metrics_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_date date NOT NULL UNIQUE,
  new_families integer NOT NULL DEFAULT 0,
  new_children integer NOT NULL DEFAULT 0,
  active_families_7d integer NOT NULL DEFAULT 0,
  active_families_30d integer NOT NULL DEFAULT 0,
  sessions_completed integer NOT NULL DEFAULT 0,
  sessions_abandoned integer NOT NULL DEFAULT 0,
  mrr numeric,
  mrr_unpriced_count integer NOT NULL DEFAULT 0,
  new_subscriptions integer NOT NULL DEFAULT 0,
  canceled_subscriptions_snapshot integer NOT NULL DEFAULT 0,
  avg_evolution_score numeric,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.platform_metrics_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_can_select_platform_metrics" ON public.platform_metrics_daily
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.admins WHERE lower(admins.email) = lower((select auth.jwt() ->> 'email'::text)))
  );

COMMENT ON TABLE public.platform_metrics_daily IS 'Indicadores agregados da plataforma inteira por dia (Módulo 13) — escrito só por compute_platform_metrics_daily() via pg_cron. Audiência fundador/equipe interna, nunca família/profissional individual.';
COMMENT ON COLUMN public.platform_metrics_daily.mrr IS 'Soma de plans.price para assinaturas ativas recorrentes com preço real conhecido. NULL/incompleto quando não há preço cadastrado para o provedor — ver mrr_unpriced_count.';
COMMENT ON COLUMN public.platform_metrics_daily.mrr_unpriced_count IS 'Quantidade de assinaturas ativas recorrentes cujo preço real ainda não está no catálogo plans (ex: Stripe, até o admin confirmar) — não entram no cálculo de mrr para não estimar.';
COMMENT ON COLUMN public.platform_metrics_daily.canceled_subscriptions_snapshot IS 'Contagem total de assinaturas hoje canceladas/inadimplentes (snapshot do dia do cálculo, não um delta) — subscriptions não tem updated_at, então não é possível saber a data exata do churn, só o estado atual.';

CREATE OR REPLACE FUNCTION public.compute_platform_metrics_daily(p_target_date date DEFAULT (current_date - 1))
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_new_families integer;
  v_new_children integer;
  v_active_7d integer;
  v_active_30d integer;
  v_sessions_completed integer;
  v_sessions_abandoned integer;
  v_mrr numeric;
  v_mrr_unpriced_count integer;
  v_new_subscriptions integer;
  v_canceled_snapshot integer;
  v_avg_evolution numeric;
BEGIN
  SELECT count(*) INTO v_new_families FROM public.families WHERE created_at::date = p_target_date;
  SELECT count(*) INTO v_new_children FROM public.child_profiles WHERE created_at::date = p_target_date;

  SELECT count(DISTINCT family_id) INTO v_active_7d
  FROM public.game_sessions
  WHERE start_time::date BETWEEN (p_target_date - 6) AND p_target_date;

  SELECT count(DISTINCT family_id) INTO v_active_30d
  FROM public.game_sessions
  WHERE start_time::date BETWEEN (p_target_date - 29) AND p_target_date;

  SELECT
    count(*) FILTER (WHERE status = 'completed'),
    count(*) FILTER (WHERE status = 'abandoned')
  INTO v_sessions_completed, v_sessions_abandoned
  FROM public.game_sessions
  WHERE start_time::date = p_target_date;

  SELECT
    coalesce(sum(p.price) FILTER (WHERE p.price IS NOT NULL), 0),
    count(*) FILTER (WHERE p.price IS NULL)
  INTO v_mrr, v_mrr_unpriced_count
  FROM public.subscriptions s
  JOIN public.plans p ON p.provider = s.provider AND p.billing_type = 'recurring'
  WHERE s.status = 'active'
    AND s.plan = 'premium'
    AND s.provider_subscription_id IS NOT NULL;

  SELECT count(*) INTO v_new_subscriptions
  FROM public.subscriptions
  WHERE created_at::date = p_target_date;

  SELECT count(*) INTO v_canceled_snapshot
  FROM public.subscriptions
  WHERE status IN ('canceled', 'past_due', 'unpaid');

  SELECT avg(attention_index) INTO v_avg_evolution
  FROM public.child_metrics_daily
  WHERE metric_date = p_target_date;

  INSERT INTO public.platform_metrics_daily (
    metric_date, new_families, new_children, active_families_7d, active_families_30d,
    sessions_completed, sessions_abandoned, mrr, mrr_unpriced_count, new_subscriptions,
    canceled_subscriptions_snapshot, avg_evolution_score
  ) VALUES (
    p_target_date, v_new_families, v_new_children, v_active_7d, v_active_30d,
    v_sessions_completed, v_sessions_abandoned, v_mrr, v_mrr_unpriced_count, v_new_subscriptions,
    v_canceled_snapshot, v_avg_evolution
  )
  ON CONFLICT (metric_date) DO UPDATE SET
    new_families = EXCLUDED.new_families,
    new_children = EXCLUDED.new_children,
    active_families_7d = EXCLUDED.active_families_7d,
    active_families_30d = EXCLUDED.active_families_30d,
    sessions_completed = EXCLUDED.sessions_completed,
    sessions_abandoned = EXCLUDED.sessions_abandoned,
    mrr = EXCLUDED.mrr,
    mrr_unpriced_count = EXCLUDED.mrr_unpriced_count,
    new_subscriptions = EXCLUDED.new_subscriptions,
    canceled_subscriptions_snapshot = EXCLUDED.canceled_subscriptions_snapshot,
    avg_evolution_score = EXCLUDED.avg_evolution_score;
END;
$$;

REVOKE ALL ON FUNCTION public.compute_platform_metrics_daily(date) FROM PUBLIC, anon, authenticated;

SELECT cron.schedule(
  'compute-platform-metrics-daily',
  '15 3 * * *',
  $$SELECT public.compute_platform_metrics_daily();$$
);
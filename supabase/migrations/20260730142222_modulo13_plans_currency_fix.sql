ALTER TABLE public.subscriptions
  ADD COLUMN currency text CHECK (currency IS NULL OR currency IN ('BRL', 'EUR'));

UPDATE public.subscriptions SET currency = 'BRL' WHERE provider = 'asaas' AND currency IS NULL;

ALTER TABLE public.plans DROP CONSTRAINT plans_provider_billing_type_key;
ALTER TABLE public.plans ADD CONSTRAINT plans_provider_billing_type_currency_key UNIQUE (provider, billing_type, currency);

UPDATE public.plans SET price = 4.99 WHERE provider = 'stripe' AND billing_type = 'recurring' AND currency = 'EUR';
UPDATE public.plans SET price = 9.90 WHERE provider = 'stripe' AND billing_type = 'one_time' AND currency = 'EUR';

INSERT INTO public.plans (provider, billing_type, price, currency) VALUES
  ('stripe', 'recurring', 24.90, 'BRL'),
  ('stripe', 'one_time', 34.90, 'BRL');

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
  LEFT JOIN public.plans p
    ON p.provider = s.provider AND p.billing_type = 'recurring' AND p.currency = s.currency
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
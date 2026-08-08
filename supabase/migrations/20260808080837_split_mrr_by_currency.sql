-- compute_platform_metrics_daily summed subscriptions.price across all
-- currencies into a single `mrr` column (sum(p.price) with no currency
-- grouping) - harmless while mrr was 0, but would silently mix BRL and EUR
-- into one meaningless number the moment both have active recurring
-- subscribers. Split into mrr_brl/mrr_eur instead of guessing an exchange
-- rate to collapse them into one figure.
ALTER TABLE public.platform_metrics_daily
  ADD COLUMN mrr_brl numeric DEFAULT 0,
  ADD COLUMN mrr_eur numeric DEFAULT 0;

UPDATE public.platform_metrics_daily SET mrr_brl = 0, mrr_eur = 0;

ALTER TABLE public.platform_metrics_daily DROP COLUMN mrr;

CREATE OR REPLACE FUNCTION public.compute_platform_metrics_daily(p_target_date date DEFAULT (CURRENT_DATE - 1))
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_new_families integer;
  v_new_children integer;
  v_active_7d integer;
  v_active_30d integer;
  v_sessions_completed integer;
  v_sessions_abandoned integer;
  v_mrr_brl numeric;
  v_mrr_eur numeric;
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

  -- p.currency = s.currency in the join already keeps each row's price in
  -- its own currency; the FILTER on s.currency just routes each row's price
  -- into the matching mrr_brl/mrr_eur bucket instead of one shared sum.
  SELECT
    coalesce(sum(p.price) FILTER (WHERE p.price IS NOT NULL AND s.currency = 'BRL'), 0),
    coalesce(sum(p.price) FILTER (WHERE p.price IS NOT NULL AND s.currency = 'EUR'), 0),
    count(*) FILTER (WHERE p.price IS NULL)
  INTO v_mrr_brl, v_mrr_eur, v_mrr_unpriced_count
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
    sessions_completed, sessions_abandoned, mrr_brl, mrr_eur, mrr_unpriced_count, new_subscriptions,
    canceled_subscriptions_snapshot, avg_evolution_score
  ) VALUES (
    p_target_date, v_new_families, v_new_children, v_active_7d, v_active_30d,
    v_sessions_completed, v_sessions_abandoned, v_mrr_brl, v_mrr_eur, v_mrr_unpriced_count, v_new_subscriptions,
    v_canceled_snapshot, v_avg_evolution
  )
  ON CONFLICT (metric_date) DO UPDATE SET
    new_families = EXCLUDED.new_families,
    new_children = EXCLUDED.new_children,
    active_families_7d = EXCLUDED.active_families_7d,
    active_families_30d = EXCLUDED.active_families_30d,
    sessions_completed = EXCLUDED.sessions_completed,
    sessions_abandoned = EXCLUDED.sessions_abandoned,
    mrr_brl = EXCLUDED.mrr_brl,
    mrr_eur = EXCLUDED.mrr_eur,
    mrr_unpriced_count = EXCLUDED.mrr_unpriced_count,
    new_subscriptions = EXCLUDED.new_subscriptions,
    canceled_subscriptions_snapshot = EXCLUDED.canceled_subscriptions_snapshot,
    avg_evolution_score = EXCLUDED.avg_evolution_score;
END;
$function$;

COMMENT ON COLUMN public.platform_metrics_daily.mrr_brl IS 'Soma de plans.price (BRL) para assinaturas ativas recorrentes com preço real conhecido. NULL/incompleto quando não há preço cadastrado para o provedor - ver mrr_unpriced_count.';
COMMENT ON COLUMN public.platform_metrics_daily.mrr_eur IS 'Soma de plans.price (EUR) para assinaturas ativas recorrentes com preço real conhecido. NULL/incompleto quando não há preço cadastrado para o provedor - ver mrr_unpriced_count.';

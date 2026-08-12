-- Backfill dos últimos 28 dias de child_metrics_daily com as fórmulas
-- unificadas de 20260812140000_unify_child_metrics_daily_formulas.sql.
-- Sem isso, o card "Evolução (4 semanas)" do novo Relatório de Indicadores
-- compararia, no primeiro mês pós-deploy, dias calculados com a fórmula
-- antiga (attention_index inflado por distraction nunca disparado) contra
-- dias com a fórmula nova - o delta ficaria sem sentido.
--
-- compute_child_metrics_daily() é idempotente (ON CONFLICT DO UPDATE por
-- child_profile_id/metric_date), então é seguro rodar mais de uma vez.
-- Se o volume de crianças for grande, prefira rodar este loop manualmente
-- pelo SQL editor do Supabase em vez de dentro do fluxo de migration.

DO $$
DECLARE d date;
BEGIN
  FOR d IN SELECT generate_series((current_date - 28), (current_date - 1), interval '1 day')::date LOOP
    PERFORM public.compute_child_metrics_daily(d);
  END LOOP;
END $$;

SELECT 'ok' AS status;

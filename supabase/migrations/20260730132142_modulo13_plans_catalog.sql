CREATE TABLE public.plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('stripe', 'asaas')),
  billing_type text NOT NULL CHECK (billing_type IN ('recurring', 'one_time')),
  price numeric,
  currency text NOT NULL DEFAULT 'BRL',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (provider, billing_type)
);

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_read_plans" ON public.plans
  FOR SELECT TO authenticated USING (true);

COMMENT ON TABLE public.plans IS 'Catálogo de preços reais por provedor/ciclo (Módulo 13) — preenche o gap de MRR/receita. price NULL = preço real ainda não confirmado (não usar para estimar, excluir do cálculo de MRR até ser preenchido via admin-operations).';
COMMENT ON COLUMN public.plans.billing_type IS 'Inferido na prática de subscriptions.provider_subscription_id: NOT NULL = recurring, NULL = one_time.';

INSERT INTO public.plans (provider, billing_type, price, currency) VALUES
  ('asaas', 'recurring', 24.90, 'BRL'),
  ('asaas', 'one_time', 34.90, 'BRL'),
  ('stripe', 'recurring', NULL, 'EUR'),
  ('stripe', 'one_time', NULL, 'EUR');
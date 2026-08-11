-- Módulo 14 — adiciona preço em BRL pro plano de capacidade do profissional
-- (só existia EUR até aqui). Mesmo padrão de preço "próprio pro mercado"
-- já usado no plano de família (BRL não é conversão direta do EUR) - ver
-- create-professional-checkout-session/index.ts, que agora seleciona a
-- price_id certa via country ('BR'|'INT') igual create-checkout-session já
-- faz pra família.

insert into public.plans (provider, billing_type, currency, audience, price, active) values
  ('stripe', 'one_time', 'BRL', 'professional', 58.00, true),
  ('stripe', 'recurring', 'BRL', 'professional', 58.00, true)
on conflict (provider, billing_type, currency, audience) do nothing;

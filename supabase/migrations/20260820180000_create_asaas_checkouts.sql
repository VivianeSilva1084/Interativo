-- Módulo do funil de pagamento BR (2026-08-20): assinatura mensal paga com
-- cartão via Asaas usa /v3/checkouts (chargeTypes RECURRENT), não a chamada
-- direta a /v3/subscriptions usada pro Pix - e, diferente da chamada direta,
-- o externalReference do Checkout NÃO propaga pro pagamento/assinatura
-- gerados (confirmado com uma transação real de teste, 2026-08-20: veio
-- null). Essa tabela é o mapeamento que substitui o externalReference nesse
-- caso: create-public-asaas-checkout grava a linha na criação do checkout,
-- asaas-webhook lê de volta por payment.checkoutSession quando o pagamento
-- confirma. Só usada por essas duas Edge Functions (service role) - nunca
-- pelo cliente, por isso RLS habilitado sem nenhuma policy.
create table public.asaas_checkouts (
  id text primary key,
  pending_email text,
  lead_id uuid references public.leads(id),
  fbc text,
  fbp text,
  created_at timestamptz not null default now()
);

alter table public.asaas_checkouts enable row level security;

comment on table public.asaas_checkouts is
  'Mapeamento checkoutSession -> dados do comprador pra assinatura mensal via cartão (Asaas Checkout recorrente). Ver create-public-asaas-checkout e asaas-webhook.';

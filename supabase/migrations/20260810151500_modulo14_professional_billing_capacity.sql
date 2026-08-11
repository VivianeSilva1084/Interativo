-- Módulo 14, Parte 3 — capacidade paga do profissional (grátis até 3, pago
-- até 8 + excedente a €3/criança) e a carência de 15 dias antes de
-- desativar excedente automaticamente. Depende das Partes 1 e 2.
--
-- RASCUNHO — NÃO APLICADO em nenhum ambiente ainda. Mesmas ressalvas dos
-- arquivos anteriores.
--
-- FORA DESTE ARQUIVO (próximos passos, não-SQL):
--   - Edge functions de checkout do profissional (mirror de
--     create-checkout-session/stripe-webhook, hoje 100% family-keyed —
--     precisa resolver professional_subscriptions em vez de subscriptions
--     a partir de metadata.professional_id no lugar de supabase_user_id).
--   - E-mail de lembrete 1 dia antes do vencimento (Resend, mesmo padrão
--     de sendMagicLinkEmail em stripe-webhook/index.ts) — o cron job abaixo
--     só cobre a desativação automática ao FIM da carência de 15 dias, não
--     o lembrete prévio. Precisa de uma segunda function agendada chamando
--     uma Edge Function via net.http_post (checar se a extensão pg_net já
--     está habilitada no projeto antes de escrever isso).
--   - Coleta de contato do responsável no formulário de criação de perfil
--     próprio (gap de produto sinalizado no plano — sem isso não tem quem
--     avisar quando um perfil próprio for desativado por falta de capacidade).

-- =====================================================================
-- 1. plans: distinguir preço de família vs. preço de profissional
-- =====================================================================

alter table public.plans
  add column audience text not null default 'family' check (audience in ('family', 'professional'));

alter table public.plans drop constraint plans_provider_billing_type_currency_key;
alter table public.plans add constraint plans_provider_billing_type_currency_audience_key
  unique (provider, billing_type, currency, audience);

-- ATENÇÃO: admin-operations/index.ts faz upsert em `plans` com
-- `onConflict: 'provider,billing_type,currency'` — precisa virar
-- `'provider,billing_type,currency,audience'` quando essa migração for
-- aplicada, senão o upsert de preço passa a falhar silenciosamente pro
-- conflito errado.

insert into public.plans (provider, billing_type, currency, audience, price, active) values
  ('stripe', 'one_time', 'EUR', 'professional', 9.90, true),
  ('stripe', 'recurring', 'EUR', 'professional', 9.90, true)
on conflict (provider, billing_type, currency, audience) do nothing;
-- preço único pass-avulso/mensal, conforme decidido (ver Termos de Uso
-- seção 4) — ajustar se/quando confirmarem valor diferente pro mensal.

-- =====================================================================
-- 2. professional_subscriptions
-- =====================================================================

create table public.professional_subscriptions (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null unique references public.professionals(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'capacity')),
  status text not null default 'active' check (status in ('active', 'past_due', 'canceled', 'incomplete', 'incomplete_expired', 'trialing', 'unpaid', 'paused')),
  provider text check (provider in ('stripe', 'asaas', 'admin')),
  provider_customer_id text,
  provider_subscription_id text,
  current_period_end timestamptz,
  admin_granted_until timestamptz,
  currency text check (currency in ('BRL', 'EUR')),
  extra_capacity int not null default 0,
  grace_period_started_at timestamptz, -- setado quando a capacidade paga vence, limpo se renovar; usado pelo cron de expiração abaixo
  created_at timestamptz not null default now()
);
comment on table public.professional_subscriptions is
  'Assinatura de capacidade do profissional — mesmo padrão de subscriptions (famílias), mas keyed por professional_id. extra_capacity = crianças compradas acima das 8 incluídas no plano pago (€3/criança, ver Termos de Uso seção 4).';

alter table public.professional_subscriptions enable row level security;

create policy "professional reads own subscription"
on public.professional_subscriptions for select
using (professional_id in (select id from public.professionals where auth_user_id = auth.uid()));
-- sem insert/update/delete pelo client — só Edge Function com service role
-- (mesmo padrão de `subscriptions`, que também não tem policy de escrita
-- pro usuário comum).

-- =====================================================================
-- 3. Capacidade efetiva (com carência de 15 dias embutida)
-- =====================================================================

create or replace function public.professional_capacity_limit(p_professional_id uuid)
returns int
language sql
stable security definer
set search_path to 'public'
as $function$
  select case
    when exists (
      select 1 from professional_subscriptions ps
      where ps.professional_id = p_professional_id
        and ps.plan = 'capacity'
        and (
          -- assinatura em dia
          (ps.current_period_end is null or ps.current_period_end > now())
          -- OU dentro da carência de 15 dias após o vencimento (Termos de
          -- Uso seção 4): capacidade fica congelada no valor pago, só
          -- bloqueia vínculo/perfil NOVO além do que já existe — a
          -- desativação de fato do excedente só acontece no cron da
          -- seção 5, ao fim da carência
          or (ps.current_period_end is not null and ps.current_period_end > now() - interval '15 days')
          or (ps.admin_granted_until is not null and ps.admin_granted_until > now())
        )
    )
    then 8 + coalesce((select extra_capacity from professional_subscriptions where professional_id = p_professional_id), 0)
    else 3
  end;
$function$;

comment on function public.professional_capacity_limit is
  'Limite atual de crianças (vínculos ativos + perfis próprios) que o profissional pode ter. 3 = grátis. 8+extra_capacity = pago, incluindo os 15 dias de carência pós-vencimento (congela o limite, não deixa crescer, mas não derruba nada ainda — isso é o cron da seção 5).';

-- =====================================================================
-- 4. Gate de capacidade nos dois pontos de criação (defesa em profundidade
--    — não confia só na UI: um insert/update direto também é barrado)
-- =====================================================================

create or replace function public.enforce_professional_capacity()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_professional_id uuid;
  v_used int;
  v_limit int;
  v_verification professional_verification_status;
begin
  if tg_table_name = 'child_profiles' then
    if new.professional_id is null then
      return new; -- perfil de família, não passa por aqui
    end if;
    v_professional_id := new.professional_id;

    -- Defesa em profundidade: create_owned_child_profile já checa isso, mas
    -- um insert direto em child_profiles (bypassando a RPC) não pode escapar
    -- da exigência de verificação - só a modalidade perfil-próprio exige
    -- isso, o vínculo por convite (branch abaixo) não.
    select verification_status into v_verification from professionals where id = v_professional_id;
    if v_verification is distinct from 'verified' then
      raise exception 'professional_not_verified';
    end if;
  elsif tg_table_name = 'professional_child_links' then
    if new.status is distinct from 'active' or old.status = 'active' then
      return new; -- só interessa a TRANSIÇÃO para active
    end if;
    v_professional_id := new.professional_id;
  end if;

  v_used := public.professional_capacity_used(v_professional_id);
  v_limit := public.professional_capacity_limit(v_professional_id);

  if v_used >= v_limit then
    raise exception 'professional_capacity_exceeded'
      using detail = format('used=%s limit=%s professional_id=%s', v_used, v_limit, v_professional_id);
  end if;

  return new;
end;
$function$;

create trigger trg_enforce_capacity_owned_profile
  before insert on public.child_profiles
  for each row execute function public.enforce_professional_capacity();

create trigger trg_enforce_capacity_link_activation
  before update on public.professional_child_links
  for each row execute function public.enforce_professional_capacity();

-- =====================================================================
-- 5. Cron: ao fim da carência de 15 dias, desativa automaticamente os
--    vínculos/perfis MAIS RECENTES até caber na capacidade grátis (3),
--    se o profissional não tiver escolhido manualmente o que desativar
--    nem renovado. Roda 1x/dia — não precisa de mais frequência, a janela
--    é de dias, não minutos.
-- =====================================================================

create or replace function public.expire_lapsed_professional_capacity()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_prof record;
  v_target int;
  v_link record;
  v_profile record;
begin
  for v_prof in
    select ps.professional_id
    from professional_subscriptions ps
    where ps.plan = 'capacity'
      and ps.current_period_end is not null
      and ps.current_period_end <= now() - interval '15 days'
      and (ps.admin_granted_until is null or ps.admin_granted_until <= now())
  loop
    v_target := 3; -- capacidade grátis, carência esgotada

    -- Desativa vínculos ativos mais recentes primeiro (mantém os mais antigos)
    for v_link in
      select id from professional_child_links
      where professional_id = v_prof.professional_id and status = 'active'
      order by linked_at desc
    loop
      exit when public.professional_capacity_used(v_prof.professional_id) <= v_target;
      update professional_child_links set status = 'revoked', revoked_at = now() where id = v_link.id;
      -- TODO(próxima sessão): disparar notificação ao profissional e ao
      -- responsável da criança afetada (Termos de Uso seção 4 promete isso)
    end loop;

    -- Perfis próprios não têm "revoked" — desativar aqui significa suspender
    -- acesso sem apagar dado (Termos de Uso seção 5) - ainda não existe uma
    -- coluna de status em child_profiles para representar isso; PRECISA ser
    -- adicionada antes deste bloco funcionar de verdade. Deixado como TODO
    -- explícito em vez de um código que pareceria funcionar mas não teria
    -- onde gravar o estado "suspenso":
    -- TODO(próxima sessão): adicionar child_profiles.access_suspended_at,
    -- fazer has_code_access() negar quando setado, e completar este loop.
  end loop;
end;
$function$;

select cron.schedule(
  'expire-lapsed-professional-capacity',
  '0 6 * * *', -- diariamente às 06:00 UTC
  $$select public.expire_lapsed_professional_capacity();$$
);

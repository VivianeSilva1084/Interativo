-- Módulo 14, Parte 4 — fecha a lacuna deixada na Parte 3: estado de
-- "suspenso" pra perfil próprio (não existia coluna nenhuma pra isso),
-- reativação quando o profissional paga de novo, e uma fila de eventos que
-- uma Edge Function (notify-professional-capacity-change, arquivo .ts
-- separado) consome pra mandar e-mail/WhatsApp — pg_cron não fala com
-- Resend/WhatsApp diretamente, só com outras Edge Functions via pg_net.
--
-- RASCUNHO — NÃO APLICADO em nenhum ambiente ainda. Mesmas ressalvas dos
-- arquivos anteriores. pg_net e pg_cron já confirmados habilitados no
-- projeto (checado ao vivo nesta sessão).

-- =====================================================================
-- 1. Estado de suspensão em child_profiles (só existia em
--    professional_child_links.status='revoked' — perfil próprio não tinha
--    onde gravar isso)
-- =====================================================================

alter table public.child_profiles
  add column access_suspended_at timestamptz;

comment on column public.child_profiles.access_suspended_at is
  'Preenchido quando o acesso ao JOGO (não ao cadastro) é suspenso por falta de capacidade paga do profissional dono (ver Termos de Uso seção 4/5) — nunca apaga dado, só bloqueia has_code_access(). NULL = acesso normal. O profissional continua enxergando/gerenciando o perfil no próprio painel mesmo suspenso (RLS de dono não é afetada por esta coluna).';

-- has_code_access() passa a negar quando suspenso — dono continua acessando
-- normalmente via is_own_child_profile (não tocado aqui)
create or replace function public.has_code_access(p_child_profile_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from child_access_sessions cas
    join child_profiles cp on cp.id = cas.child_profile_id
    where cas.auth_user_id = auth.uid()
      and cas.child_profile_id = p_child_profile_id
      and cp.access_suspended_at is null
  );
$function$;

-- =====================================================================
-- 2. Fila de eventos de capacidade — a Edge Function
--    notify-professional-capacity-change lê daqui (status='pending') e
--    manda e-mail/WhatsApp, marcando processed_at ao terminar
-- =====================================================================

create table public.professional_capacity_events (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professionals(id) on delete cascade,
  event_type text not null check (event_type in (
    'reminder_1_day_before_expiry',
    'link_deactivated_lapsed_capacity',
    'profile_suspended_lapsed_capacity',
    'profiles_reactivated'
  )),
  -- child_profile_id OU professional_child_link_id, conforme o evento —
  -- ambos nullable, nunca os dois juntos preenchidos
  child_profile_id uuid references public.child_profiles(id) on delete set null,
  professional_child_link_id uuid references public.professional_child_links(id) on delete set null,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
comment on table public.professional_capacity_events is
  'Fila simples (sem exactly-once forte — a Edge Function precisa ser idempotente, ex: checar processed_at antes de reenviar) de eventos que geram notificação por e-mail/WhatsApp ao profissional e/ou à família afetada.';

create index idx_professional_capacity_events_pending on public.professional_capacity_events(professional_id) where processed_at is null;

alter table public.professional_capacity_events enable row level security;
create policy "professional reads own capacity events"
on public.professional_capacity_events for select
using (professional_id in (select id from public.professionals where auth_user_id = auth.uid()));
-- escrita só via service role (cron/Edge Function), sem policy de insert/update pro client

-- =====================================================================
-- 3. Reativação — quando o profissional paga de novo (webhook do Stripe,
--    Parte 5, ainda não escrita), chama isto pra destravar perfis/vínculos
--    até a capacidade atual, mais antigos primeiro (espelha a ordem
--    "mais antigos ficam" usada na desativação)
-- =====================================================================

create or replace function public.reactivate_professional_profiles(p_professional_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_limit int;
  v_row record;
begin
  v_limit := public.professional_capacity_limit(p_professional_id);

  for v_row in
    select id from child_profiles
    where professional_id = p_professional_id and access_suspended_at is not null
    order by created_at asc
  loop
    exit when public.professional_capacity_used(p_professional_id) >= v_limit;
    update child_profiles set access_suspended_at = null where id = v_row.id;
  end loop;

  for v_row in
    select id from professional_child_links
    where professional_id = p_professional_id and status = 'revoked'
    order by linked_at asc
  loop
    exit when public.professional_capacity_used(p_professional_id) >= v_limit;
    update professional_child_links set status = 'active' where id = v_row.id;
  end loop;

  insert into professional_capacity_events (professional_id, event_type)
  values (p_professional_id, 'profiles_reactivated');
end;
$function$;

comment on function public.reactivate_professional_profiles is
  'Chamada pela Edge Function do webhook de pagamento quando professional_subscriptions volta a active/current_period_end futuro. Reativa só até a nova capacidade, mais antigos primeiro — se o profissional pagou menos do que tinha antes, parte fica suspensa/revogada mesmo assim.';

-- =====================================================================
-- 4. Completa o cron da Parte 3: agora grava access_suspended_at (perfil
--    próprio) e enfileira os eventos de notificação
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
    v_target := 3;

    for v_link in
      select id from professional_child_links
      where professional_id = v_prof.professional_id and status = 'active'
      order by linked_at desc
    loop
      exit when public.professional_capacity_used(v_prof.professional_id) <= v_target;
      update professional_child_links set status = 'revoked', revoked_at = now() where id = v_link.id;
      insert into professional_capacity_events (professional_id, event_type, professional_child_link_id)
      values (v_prof.professional_id, 'link_deactivated_lapsed_capacity', v_link.id);
    end loop;

    for v_profile in
      select id from child_profiles
      where professional_id = v_prof.professional_id and access_suspended_at is null
      order by created_at desc
    loop
      exit when public.professional_capacity_used(v_prof.professional_id) <= v_target;
      update child_profiles set access_suspended_at = now() where id = v_profile.id;
      insert into professional_capacity_events (professional_id, event_type, child_profile_id)
      values (v_prof.professional_id, 'profile_suspended_lapsed_capacity', v_profile.id);
    end loop;
  end loop;
end;
$function$;

-- =====================================================================
-- 4b. Enfileira o lembrete de 1 dia antes do vencimento (nada fazia isso
--     até agora — a Edge Function da seção 2 só CONSOME a fila)
-- =====================================================================

create or replace function public.enqueue_professional_expiry_reminders()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into professional_capacity_events (professional_id, event_type)
  select ps.professional_id, 'reminder_1_day_before_expiry'
  from professional_subscriptions ps
  where ps.plan = 'capacity'
    and ps.status = 'active'
    and ps.current_period_end is not null
    and ps.current_period_end between now() and now() + interval '1 day'
    -- não duplicar se o cron já rodou hoje pra este profissional
    and not exists (
      select 1 from professional_capacity_events pce
      where pce.professional_id = ps.professional_id
        and pce.event_type = 'reminder_1_day_before_expiry'
        and pce.created_at > now() - interval '20 hours'
    );
end;
$function$;

select cron.schedule(
  'enqueue-professional-expiry-reminders',
  '0 8 * * *', -- diariamente às 08:00 UTC — horário fixo evita reprocessar a mesma janela de 24h duas vezes por acidente
  $$select public.enqueue_professional_expiry_reminders();$$
);

-- =====================================================================
-- 5. Cron: dispara a Edge Function de notificação sempre que houver evento
--    pendente (a cada 15 min é suficiente — nenhum destes eventos é
--    latência-sensível) + o job diário de expiração da Parte 3 continua
--    valendo sem mudança (não recriado aqui).
-- =====================================================================

-- ATENÇÃO — NÃO aplicar este bloco cron.schedule() como está. Confirmado ao
-- vivo nesta sessão: este projeto NÃO usa Supabase Vault para o CRON_SECRET
-- — o job real existente (process-funnel-sequence-every-10min) tem o valor
-- do secret embutido em texto direto no comando SQL armazenado em
-- `cron.job.command` (é assim que pg_cron funciona: o comando completo fica
-- na tabela, visível a quem tiver acesso SQL ao projeto — não é um segredo
-- de aplicação isolado). A migração `20260806121118_remove_duplicate_funnel_cron.sql`
-- existe justamente porque uma tentativa anterior de commitar esse cron
-- job com o valor errado do secret precisou ser desfeita — então o valor
-- real nunca deve entrar num arquivo versionado no git.
--
-- Ação manual necessária (fora desta migração): depois de criar a Edge
-- Function notify-professional-capacity-change e confirmar o valor real de
-- CRON_SECRET nos secrets do projeto, registrar este cron job diretamente
-- via SQL Editor do painel Supabase (nunca num arquivo de migração), no
-- mesmo padrão do job já existente:
--
--   select cron.schedule(
--     'notify-professional-capacity-events',
--     '*/15 * * * *',
--     $$
--     select net.http_post(
--       url := 'https://pswmbqlafywaxphsrloe.supabase.co/functions/v1/notify-professional-capacity-change',
--       headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET real, colado só no painel>'),
--       body := '{}'::jsonb
--     )
--     where exists (select 1 from public.professional_capacity_events where processed_at is null);
--     $$
--   );

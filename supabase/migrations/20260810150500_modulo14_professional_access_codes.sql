-- Módulo 14, Parte 2 — login por código pra perfis próprios de profissional
-- (sem e-mail/senha), suporte a múltiplos dispositivos simultâneos (clínica +
-- casa), e capacidade paga unificada (vínculo por convite + perfil próprio).
-- Depende da Parte 1 (modulo14_professional_owned_profiles_ownership.sql).
--
-- RASCUNHO — NÃO APLICADO em nenhum ambiente ainda. Mesmas ressalvas do
-- arquivo anterior: revisar, testar em branch de preview, get_advisors ao
-- final.
--
-- PRÉ-REQUISITO MANUAL (fora desta migração): habilitar "Anonymous Sign-Ins"
-- no painel do Supabase (Authentication → Settings) — não existe API/migração
-- pra isso. Sessão anônima recebe role=authenticated com claim is_anonymous=
-- true, então TODA policy "to authenticated" sem restrição adicional do
-- projeto vira alcançável por qualquer visitante sem conta real assim que
-- isso for ligado — auditar isso manualmente antes de habilitar em produção.

-- pgcrypto já habilitado no projeto (confirmado via pg_extension) — usado
-- abaixo só pra gen_random_bytes/digest do código de acesso.

-- =====================================================================
-- 1. Tabelas
-- =====================================================================

create table public.child_access_codes (
  id uuid primary key default gen_random_uuid(),
  child_profile_id uuid not null references public.child_profiles(id) on delete cascade,
  code_hash text not null,             -- sha256(code), nunca o código em texto puro — mesmo espírito de families.parent_pin_hash
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_by_professional_id uuid not null references public.professionals(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
comment on table public.child_access_codes is
  'Código de acesso ao jogo para um perfil de criança criado por profissional (modalidade "perfil próprio", sem conta de família). Um perfil pode ter mais de um código ao longo do tempo (rotação); só o "active" mais recente vale. O texto puro do código nunca é armazenado — só o hash.';

create index idx_child_access_codes_profile on public.child_access_codes(child_profile_id) where status = 'active';

create table public.child_access_sessions (
  auth_user_id uuid primary key,       -- auth.uid() da sessão anônima (1 linha = 1 dispositivo/navegador logado)
  child_profile_id uuid not null references public.child_profiles(id) on delete cascade,
  code_id uuid not null references public.child_access_codes(id) on delete cascade,
  device_label text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
comment on table public.child_access_sessions is
  'Vínculo entre uma sessão anônima do Supabase Auth (auth.uid()) e o perfil de criança que ela pode acessar, resgatado via redeem_profile_access_code(). Suporta N dispositivos simultâneos por criança (clínica + casa) — a chave é o dispositivo (auth_user_id), não a criança.';

create index idx_child_access_sessions_profile on public.child_access_sessions(child_profile_id);

alter table public.child_access_codes enable row level security;
alter table public.child_access_sessions enable row level security;

-- Só o profissional dono do perfil gerencia os códigos (criar/rotacionar/revogar)
create policy "professional manages own codes"
on public.child_access_codes for all
using (created_by_professional_id in (select id from public.professionals where auth_user_id = auth.uid()))
with check (created_by_professional_id in (select id from public.professionals where auth_user_id = auth.uid()));

-- Profissional vê (e pode encerrar) os dispositivos conectados aos próprios perfis;
-- a própria sessão anônima nunca lê/escreve esta tabela diretamente (só via RPC)
create policy "professional manages sessions of own profiles"
on public.child_access_sessions for all
using (child_profile_id in (
  select id from public.child_profiles
  where professional_id in (select id from public.professionals where auth_user_id = auth.uid())
))
with check (false); -- inserts só via redeem_profile_access_code() (SECURITY DEFINER, bypassa RLS)

-- =====================================================================
-- 2. has_code_access(): sessão anônima resgatada dá acesso de JOGO (não de
--    gestão) a um perfil específico
-- =====================================================================

create or replace function public.has_code_access(p_child_profile_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from child_access_sessions cas
    where cas.auth_user_id = auth.uid()
      and cas.child_profile_id = p_child_profile_id
  );
$function$;

-- =====================================================================
-- 3. RPC de resgate do código
-- =====================================================================

create or replace function public.redeem_profile_access_code(p_code text, p_device_label text default null)
returns uuid -- child_profile_id resgatado
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_code_row child_access_codes%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated'; -- cliente precisa ter chamado signInAnonymously() antes
  end if;

  select * into v_code_row
  from child_access_codes
  where code_hash = encode(extensions.digest(p_code, 'sha256'), 'hex')
    and status = 'active'
  limit 1;

  if v_code_row.id is null then
    raise exception 'invalid_or_revoked_code';
  end if;

  insert into child_access_sessions (auth_user_id, child_profile_id, code_id, device_label)
  values (auth.uid(), v_code_row.child_profile_id, v_code_row.id, p_device_label)
  on conflict (auth_user_id) do update
    set child_profile_id = excluded.child_profile_id,
        code_id = excluded.code_id,
        device_label = coalesce(excluded.device_label, child_access_sessions.device_label),
        last_seen_at = now();

  return v_code_row.child_profile_id;
end;
$function$;

comment on function public.redeem_profile_access_code is
  'Chamada pelo cliente logo após supabase.auth.signInAnonymously(). Valida o código contra o hash, vincula o auth.uid() da sessão anônima ao child_profile_id. Um dispositivo (auth_user_id) só pode estar vinculado a 1 criança por vez — resgatar um novo código no mesmo dispositivo substitui o vínculo anterior (on conflict).';

-- Função auxiliar simples pra gerar o código em texto puro no momento da
-- criação (client/edge function chama isto OU gera no client e manda o hash
-- pronto — a decidir na implementação da UI; deixado como helper opcional)
create or replace function public.generate_access_code()
returns text
language sql
volatile
as $function$
  -- encode() só suporta hex/base64/escape (não base32) - hex de 5 bytes dá
  -- um código de 10 caracteres [0-9A-F], curto o bastante pra digitar e sem
  -- caracteres ambíguos de maiúscula/minúscula ou símbolos como o base64 teria.
  select upper(encode(extensions.gen_random_bytes(5), 'hex'));
$function$;

-- =====================================================================
-- 4. Estender RLS de dados de jogo para aceitar acesso por código — só
--    leitura/escrita de JOGO (não gestão: sem delete, sem alterar cadastro
--    do perfil). Reescreve as policies "owners ..." da Parte 1 acrescentando
--    o caminho por código como alternativa, e cria uma policy nova para
--    child_profiles (que hoje só tem a policy "for all" dos donos).
-- =====================================================================

create policy "code session reads own child profile"
on public.child_profiles for select
using (has_code_access(id));

drop policy if exists "owners read own game events" on public.game_events;
create policy "owners or code session read own game events"
on public.game_events for select
using (is_own_child_profile(profile_id) or has_code_access(profile_id));

drop policy if exists "owners insert own game events" on public.game_events;
create policy "owners or code session insert own game events"
on public.game_events for insert
with check (is_own_child_profile(profile_id) or has_code_access(profile_id));
-- delete permanece só para o dono (reset_child_progress é chamado pelo
-- profissional/família autenticados, nunca pela sessão de código)

-- Sem delete aqui de propósito — sessão de código pode jogar (ler/criar/
-- atualizar sessão em andamento), mas não apagar histórico; isso fica só
-- para o dono (política "owners manage own game sessions" da Parte 1)
create policy "code session reads own game sessions"
on public.game_sessions for select
using (has_code_access(profile_id));

create policy "code session inserts own game sessions"
on public.game_sessions for insert
with check (has_code_access(profile_id));

create policy "code session updates own game sessions"
on public.game_sessions for update
using (has_code_access(profile_id));

drop policy if exists "owners read own reading progress" on public.reading_progress;
create policy "owners or code session read own reading progress"
on public.reading_progress for select
using (is_own_child_profile(child_profile_id) or has_code_access(child_profile_id));

drop policy if exists "owners update own reading progress" on public.reading_progress;
create policy "owners or code session update own reading progress"
on public.reading_progress for update
using (is_own_child_profile(child_profile_id) or has_code_access(child_profile_id));
-- insert de reading_progress continua só para o dono (linha é criada junto
-- com o perfil, pela professional-dashboard.js/app.js, não pela sessão de jogo)

-- =====================================================================
-- 5. Capacidade unificada (vínculo por convite + perfil próprio), com peso
--    configurável por tipo (default 1 cada) — usada tanto por
--    redeem_invite_code/aprovação de vínculo quanto por uma futura
--    create_owned_child_profile(...)
-- =====================================================================

create table public.professional_capacity_weights (
  registration_type text primary key check (registration_type in ('linked_child', 'owned_profile')),
  weight int not null default 1
);
insert into public.professional_capacity_weights (registration_type, weight) values
  ('linked_child', 1),
  ('owned_profile', 1)
on conflict do nothing;
comment on table public.professional_capacity_weights is
  'Peso de cada tipo de registro no cálculo de capacidade paga do profissional (ver professional_capacity_used()). Ajustável sem migração — ex: se decidirem que perfil próprio deve pesar mais que vínculo de leitura, basta um UPDATE aqui.';

-- Sem policy nenhuma de propósito: tabela de configuração interna, lida só
-- pelas funções SECURITY DEFINER (que rodam com o dono da função, fora do
-- RLS) - nunca deveria ser legível/gravável via API por anon ou
-- authenticated. Sem isto, qualquer usuário autenticado conseguiria zerar o
-- próprio peso e furar o limite de capacidade pago.
alter table public.professional_capacity_weights enable row level security;

create or replace function public.professional_capacity_used(p_professional_id uuid)
returns int
language sql
stable security definer
set search_path to 'public'
as $function$
  select
    coalesce((select count(*) from professional_child_links where professional_id = p_professional_id and status = 'active'), 0)
      * (select weight from professional_capacity_weights where registration_type = 'linked_child')
    +
    coalesce((select count(*) from child_profiles where professional_id = p_professional_id), 0)
      * (select weight from professional_capacity_weights where registration_type = 'owned_profile');
$function$;

comment on function public.professional_capacity_used is
  'Soma ponderada de vínculos ativos (professional_child_links.status=active) + perfis próprios (child_profiles.professional_id) — usada para bloquear novo vínculo/perfil quando capacidade contratada (grátis=3 ou paga=8+excedente, ver Termos de Uso seção 4) já foi atingida. A tabela/mecanismo de assinatura do profissional (plano pago, Stripe) ainda não existe neste schema — entra em módulo separado de billing.';

-- NOTA: falta ainda, fora do escopo deste arquivo (billing, não schema de
-- acesso): tabela de assinatura do profissional, checagem de capacidade nos
-- pontos de criação (redeem_invite_code / uma futura create_owned_child_profile),
-- carência de 15 dias + desativação automática dos mais recentes, lembrete
-- por e-mail 1 dia antes do vencimento, coleta de contato do responsável
-- para notificação de continuidade (gap sinalizado no plano técnico).

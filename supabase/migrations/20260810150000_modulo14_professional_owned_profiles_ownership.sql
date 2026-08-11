-- Módulo 14, Parte 1 — permite que child_profiles pertençam a um PROFISSIONAL
-- em vez de a uma família (autonomia total: criar/excluir/zerar, sem que a
-- família precise ter conta na Plataforma). Ver plano técnico da sessão:
-- "nível pago para profissionais (capacidade + perfis próprios com login por
-- código)". Base legal: profissional atesta consentimento do responsável
-- fora da Plataforma (ver termos-de-uso.html seção 5 / politica-privacidade.html
-- seção 2.4/3/5.1/8).
--
-- RASCUNHO — NÃO APLICADO em nenhum ambiente ainda. Antes de rodar:
--   1. Revisar cada policy reescrita abaixo contra o `pg_policies` ao vivo
--      (este arquivo foi escrito a partir de uma leitura live em 2026-08-10,
--      mas pode haver mudanças posteriores).
--   2. Aplicar primeiro numa branch de preview do Supabase, nunca direto em
--      produção (mexe em RLS de tabelas com dado de criança).
--   3. Rodar get_advisors ao final.
--
-- Parte 2 (child_access_codes/child_access_sessions/login por código/
-- capacidade) está no arquivo seguinte, modulo14_professional_access_codes.sql.

-- =====================================================================
-- 1. child_profiles: ownership polimórfico (família OU profissional)
-- =====================================================================

alter table public.child_profiles
  alter column family_id drop not null;

alter table public.child_profiles
  add column professional_id uuid references public.professionals(id) on delete cascade;

alter table public.child_profiles
  add constraint child_profiles_exactly_one_owner
  check (
    (family_id is not null and professional_id is null)
    or (family_id is null and professional_id is not null)
  );

comment on column public.child_profiles.professional_id is
  'Preenchido quando o perfil foi criado diretamente por um profissional (modalidade "perfil próprio", sem conta de família) — mutuamente exclusivo com family_id via child_profiles_exactly_one_owner. Ver Termos de Uso seção 5.';

-- =====================================================================
-- 2. is_own_child_profile(): passa a reconhecer os dois caminhos de posse
--    (a maioria das RLS policies do projeto já delega para esta função —
--    corrigi-la aqui já resolve invite_codes, professional_child_links
--    (lado pai) e child_metrics_daily de graça, sem precisar tocá-las)
-- =====================================================================

create or replace function public.is_own_child_profile(p_child_profile_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from child_profiles cp
    left join families f on f.id = cp.family_id
    left join professionals p on p.id = cp.professional_id
    where cp.id = p_child_profile_id
      and (
        (cp.family_id is not null and f.auth_user_id = auth.uid())
        or (cp.professional_id is not null and p.auth_user_id = auth.uid())
      )
  );
$function$;

-- =====================================================================
-- 3. child_profiles: policy própria (não pode usar is_own_child_profile
--    aqui — em INSERT a linha ainda não existe na tabela quando o WITH
--    CHECK avalia, então o check tem que ser contra as colunas da própria
--    linha nova, não uma subquery em child_profiles)
-- =====================================================================

drop policy if exists "Acesso exclusivo aos perfis da própria família" on public.child_profiles;

create policy "Acesso exclusivo aos próprios perfis (família ou profissional)"
on public.child_profiles
for all
using (
  (family_id is not null and family_id in (select id from families where auth_user_id = auth.uid()))
  or (professional_id is not null and professional_id in (select id from professionals where auth_user_id = auth.uid()))
)
with check (
  (family_id is not null and family_id in (select id from families where auth_user_id = auth.uid()))
  or (professional_id is not null and professional_id in (select id from professionals where auth_user_id = auth.uid()))
);

-- Mantida sem alteração: "professional reads linked child profile" (usa
-- is_linked_professional_for_child, caminho do convite família→profissional,
-- não afetado por esta migração).

-- =====================================================================
-- 4. Tabelas cujas policies inlinam family_id diretamente (não passavam
--    por is_own_child_profile) — reescritas para delegar à função, que
--    agora cobre os dois caminhos de posse
-- =====================================================================

-- game_events
drop policy if exists "families read own game events" on public.game_events;
create policy "owners read own game events"
on public.game_events for select
using (is_own_child_profile(profile_id));

drop policy if exists "families insert own game events" on public.game_events;
create policy "owners insert own game events"
on public.game_events for insert
with check (is_own_child_profile(profile_id));

drop policy if exists "families delete own game events" on public.game_events;
create policy "owners delete own game events"
on public.game_events for delete
using (is_own_child_profile(profile_id));

-- game_sessions
drop policy if exists "families manage own game sessions" on public.game_sessions;
create policy "owners manage own game sessions"
on public.game_sessions for all
using (is_own_child_profile(profile_id))
with check (is_own_child_profile(profile_id));

-- reading_progress
drop policy if exists "families read own reading progress" on public.reading_progress;
create policy "owners read own reading progress"
on public.reading_progress for select
using (is_own_child_profile(child_profile_id));

drop policy if exists "families insert own reading progress" on public.reading_progress;
create policy "owners insert own reading progress"
on public.reading_progress for insert
with check (is_own_child_profile(child_profile_id));

drop policy if exists "families update own reading progress" on public.reading_progress;
create policy "owners update own reading progress"
on public.reading_progress for update
using (is_own_child_profile(child_profile_id));

-- adherence_goals
drop policy if exists "families manage own adherence goals" on public.adherence_goals;
create policy "owners manage own adherence goals"
on public.adherence_goals for all
using (is_own_child_profile(child_profile_id))
with check (is_own_child_profile(child_profile_id));

-- professional_access_log (leitura pelo "responsável" — para perfil próprio
-- não existe conta de responsável; mantém-se restrita a family_id, que fica
-- NULL para esses casos e portanto simplesmente não retorna linhas — não
-- precisa de policy nova aqui. Ver gap sinalizado no plano: perfis próprios
-- não têm ninguém do lado família pra auditar; o próprio profissional já
-- pode ver seu histórico via "professional inserts own access log", que
-- não foi tocada).

-- =====================================================================
-- 5. parental_consents: family_id nullable + distinção de origem do
--    consentimento (colhido no app vs. atestado pelo profissional)
-- =====================================================================

alter table public.parental_consents
  alter column family_id drop not null;

alter table public.parental_consents
  add column consent_source text not null default 'parent_in_app'
    check (consent_source in ('parent_in_app', 'professional_attested')),
  add column attested_by_professional_id uuid references public.professionals(id);

comment on column public.parental_consents.consent_source is
  'parent_in_app = responsável consentiu dentro da Plataforma (fluxo família, hoje). professional_attested = profissional declarou ter obtido consentimento fora da Plataforma, ao criar perfil próprio (ver Termos de Uso seção 5) — evidência de força jurídica diferente, nunca misturar sem essa marcação.';

drop policy if exists "families insert own consents" on public.parental_consents;
create policy "owners insert own consents"
on public.parental_consents for insert
with check (
  (family_id is not null and family_id in (select id from families where auth_user_id = auth.uid()))
  or (attested_by_professional_id is not null and attested_by_professional_id in (select id from professionals where auth_user_id = auth.uid()))
);

drop policy if exists "families read own consents" on public.parental_consents;
create policy "owners read own consents"
on public.parental_consents for select
using (
  (family_id is not null and family_id in (select id from families where auth_user_id = auth.uid()))
  or (attested_by_professional_id is not null and attested_by_professional_id in (select id from professionals where auth_user_id = auth.uid()))
);

-- =====================================================================
-- 6. Trigger de game_sessions: preencher também professional_id, não só
--    family_id (senão métricas de admin/BI que agrupam por família contam
--    errado os perfis de profissional, que ficam com family_id NULL)
-- =====================================================================

alter table public.game_sessions
  alter column family_id drop not null,
  add column professional_id uuid references public.professionals(id);

create or replace function public.fill_game_session_ownership()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.family_id is null and new.professional_id is null then
    select cp.family_id, cp.professional_id
      into new.family_id, new.professional_id
    from public.child_profiles cp
    where cp.id = new.profile_id;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_fill_game_session_family_id on public.game_sessions;
create trigger trg_fill_game_session_ownership
  before insert on public.game_sessions
  for each row execute function public.fill_game_session_ownership();

drop function if exists public.fill_game_session_family_id();

-- =====================================================================
-- 7. has_premium_access: perfil de profissional sempre tem acesso "premium"
--    (a capacidade paga do profissional já cobre features completas — não
--    existe um nível "família free" equivalente para perfis próprios)
-- =====================================================================

create or replace function public.has_premium_access(p_child_profile_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select coalesce(
    (
      select case
        when cp.professional_id is not null then true
        else public.family_has_access(cp.family_id)
      end
      from public.child_profiles cp
      where cp.id = p_child_profile_id
    ),
    false
  );
$function$;

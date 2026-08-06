-- Módulo 2, Fase 3 — correções reais identificadas no Advisor do Supabase
-- (docs/architecture/02-banco-de-dados.md, Parte D). Testado localmente
-- (Supabase CLI + Docker) antes de aplicar em produção, conforme Módulo 12.

-- A) Revogar EXECUTE de `anon` (e PUBLIC) em funções sensíveis
revoke execute on function public.delete_my_account() from public, anon;
revoke execute on function public.family_has_access(uuid) from public, anon;
revoke execute on function public.has_premium_access(uuid) from public, anon;
revoke execute on function public.is_own_child_profile(uuid) from public, anon;
revoke execute on function public.is_linked_professional_for_child(uuid) from public, anon;
revoke execute on function public.redeem_invite_code(text) from public, anon;

grant execute on function public.delete_my_account() to authenticated;
grant execute on function public.family_has_access(uuid) to authenticated;
grant execute on function public.has_premium_access(uuid) to authenticated;
grant execute on function public.is_own_child_profile(uuid) to authenticated;
grant execute on function public.is_linked_professional_for_child(uuid) to authenticated;
grant execute on function public.redeem_invite_code(text) to authenticated;

-- B) auth_rls_initplan — troca auth.uid()/auth.jwt() por (select ...)
alter policy "families manage own adherence goals" on public.adherence_goals
  using (child_profile_id in (
    select cp.id from child_profiles cp join families f on f.id = cp.family_id
    where f.auth_user_id = (select auth.uid())
  ));

alter policy "authenticated_can_check_own_admin_row" on public.admins
  using (lower(email) = lower(((select auth.jwt()) ->> 'email'::text)));

alter policy "Acesso exclusivo aos perfis da própria família" on public.child_profiles
  using (family_id in (select families.id from families where families.auth_user_id = (select auth.uid())))
  with check (family_id in (select families.id from families where families.auth_user_id = (select auth.uid())));

alter policy "families read own usage logs" on public.daily_usage_logs
  using (profile_id in (
    select cp.id from child_profiles cp join families f on f.id = cp.family_id
    where f.auth_user_id = (select auth.uid())
  ));

alter policy "Acesso exclusivo do dono na tabela families" on public.families
  using (auth_user_id = (select auth.uid()))
  with check (auth_user_id = (select auth.uid()));

alter policy "families delete own game events" on public.game_events
  using (profile_id in (
    select cp.id from child_profiles cp join families f on f.id = cp.family_id
    where f.auth_user_id = (select auth.uid())
  ));

alter policy "families insert own game events" on public.game_events
  with check (profile_id in (
    select cp.id from child_profiles cp join families f on f.id = cp.family_id
    where f.auth_user_id = (select auth.uid())
  ));

alter policy "families read own game events" on public.game_events
  using (profile_id in (
    select cp.id from child_profiles cp join families f on f.id = cp.family_id
    where f.auth_user_id = (select auth.uid())
  ));

alter policy "professional reads linked game events" on public.game_events
  using (profile_id in (
    select pcl.child_profile_id from professional_child_links pcl
    join professionals p on p.id = pcl.professional_id
    where p.auth_user_id = (select auth.uid()) and pcl.status = 'active'
  ));

alter policy "families manage own game sessions" on public.game_sessions
  using (family_id in (select families.id from families where families.auth_user_id = (select auth.uid())))
  with check (family_id in (select families.id from families where families.auth_user_id = (select auth.uid())));

alter policy "professional reads linked child sessions" on public.game_sessions
  using (profile_id in (
    select pcl.child_profile_id from professional_child_links pcl
    join professionals p on p.id = pcl.professional_id
    where p.auth_user_id = (select auth.uid()) and pcl.status = 'active'
  ));

alter policy "admins_can_select_lead_events" on public.lead_events
  using (exists (select 1 from admins where lower(admins.email) = lower(((select auth.jwt()) ->> 'email'::text))));

alter policy "admins_can_select_leads" on public.leads
  using (exists (select 1 from admins where lower(admins.email) = lower(((select auth.jwt()) ->> 'email'::text))));

alter policy "admins_can_update_leads" on public.leads
  using (exists (select 1 from admins where lower(admins.email) = lower(((select auth.jwt()) ->> 'email'::text))))
  with check (exists (select 1 from admins where lower(admins.email) = lower(((select auth.jwt()) ->> 'email'::text))));

alter policy "families insert own consents" on public.parental_consents
  with check (family_id in (select families.id from families where families.auth_user_id = (select auth.uid())));

alter policy "families read own consents" on public.parental_consents
  using (family_id in (select families.id from families where families.auth_user_id = (select auth.uid())));

alter policy "parent reads access log of own children" on public.professional_access_log
  using (child_profile_id in (
    select cp.id from child_profiles cp join families f on f.id = cp.family_id
    where f.auth_user_id = (select auth.uid())
  ));

alter policy "professional inserts own access log" on public.professional_access_log
  with check (professional_id in (select professionals.id from professionals where professionals.auth_user_id = (select auth.uid())));

alter policy "professional creates pending link" on public.professional_child_links
  with check (
    professional_id in (select professionals.id from professionals where professionals.auth_user_id = (select auth.uid()))
    and status = 'pending' and invited_by = 'professional'
  );

alter policy "professional reads own links" on public.professional_child_links
  using (professional_id in (select professionals.id from professionals where professionals.auth_user_id = (select auth.uid())));

alter policy "professionals manage own record" on public.professionals
  using (auth_user_id = (select auth.uid()))
  with check (auth_user_id = (select auth.uid()));

alter policy "families insert own reading progress" on public.reading_progress
  with check (child_profile_id in (
    select cp.id from child_profiles cp join families f on f.id = cp.family_id
    where f.auth_user_id = (select auth.uid())
  ));

alter policy "families read own reading progress" on public.reading_progress
  using (child_profile_id in (
    select cp.id from child_profiles cp join families f on f.id = cp.family_id
    where f.auth_user_id = (select auth.uid())
  ));

alter policy "families update own reading progress" on public.reading_progress
  using (child_profile_id in (
    select cp.id from child_profiles cp join families f on f.id = cp.family_id
    where f.auth_user_id = (select auth.uid())
  ));

alter policy "professional reads linked reading progress" on public.reading_progress
  using (child_profile_id in (
    select pcl.child_profile_id from professional_child_links pcl
    join professionals p on p.id = pcl.professional_id
    where p.auth_user_id = (select auth.uid()) and pcl.status = 'active'
  ));

alter policy "families read own subscription" on public.subscriptions
  using (family_id in (select families.id from families where families.auth_user_id = (select auth.uid())));

-- C) Índices faltantes em foreign keys
create index if not exists idx_child_profiles_family_id on public.child_profiles(family_id);
create index if not exists idx_game_sessions_family_id on public.game_sessions(family_id);
create index if not exists idx_invite_codes_child_profile_id on public.invite_codes(child_profile_id);
create index if not exists idx_invite_codes_used_by_professional_id on public.invite_codes(used_by_professional_id);
create index if not exists idx_leads_converted_family_id on public.leads(converted_family_id);
create index if not exists idx_leads_signup_family_id on public.leads(signup_family_id);
create index if not exists idx_parental_consents_child_profile_id on public.parental_consents(child_profile_id);
create index if not exists idx_parental_consents_family_id on public.parental_consents(family_id);
create index if not exists idx_professional_access_log_child_profile_id on public.professional_access_log(child_profile_id);
create index if not exists idx_professional_access_log_professional_id on public.professional_access_log(professional_id);
create index if not exists idx_professional_child_links_child_profile_id on public.professional_child_links(child_profile_id);

-- D) Remover constraint UNIQUE duplicada em professionals
alter table public.professionals drop constraint professionals_auth_user_unique;
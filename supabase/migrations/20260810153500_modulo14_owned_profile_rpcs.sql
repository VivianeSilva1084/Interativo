-- Módulo 14, Parte 5 — RPCs que a UI "Meus perfis" do professional-dashboard.js
-- precisa: criar perfil próprio (perfil + atestação de consentimento + código
-- em uma transação), rotacionar código, excluir perfil (explícito em vez de
-- confiar em ON DELETE CASCADE não confirmado em todas as tabelas relacionadas).
-- Depende das Partes 1-3. RASCUNHO — não aplicado.

create or replace function public.create_owned_child_profile(
  p_name text, p_avatar text, p_lang text, p_terms_version text
)
returns json -- { child_profile_id, access_code }
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_professional_id uuid;
  v_verification professional_verification_status;
  v_child_id uuid;
  v_code text;
begin
  select id, verification_status into v_professional_id, v_verification
  from professionals where auth_user_id = auth.uid();
  if v_professional_id is null then
    raise exception 'not_a_professional';
  end if;

  -- Só a modalidade "perfil próprio" exige verificação - o vínculo por
  -- convite (professional_child_links) continua sem essa exigência, porque
  -- ali quem aprova o acesso ao dado é sempre o responsável (ver plano
  -- técnico da sessão, seção 1: risco de responsabilidade solidária é maior
  -- aqui porque não há verificação independente do consentimento).
  if v_verification is distinct from 'verified' then
    raise exception 'professional_not_verified';
  end if;

  if public.professional_capacity_used(v_professional_id) >= public.professional_capacity_limit(v_professional_id) then
    raise exception 'professional_capacity_exceeded';
  end if;

  -- stars_by_game/difficulty_by_game precisam ser preenchidos exatamente como
  -- defaultProfileData() já faz no client pro fluxo de família (src/lib/game-progress.js)
  -- - GAME_KEYS todos com dificuldade 'medio' e 0 estrelas - senão o hub quebra
  -- na primeira leitura de profile.difficulty_by_game[gameKey] (fica null).
  insert into child_profiles (professional_id, name, avatar, lang, stars_by_game, difficulty_by_game)
  values (
    v_professional_id, p_name, p_avatar, p_lang,
    '{"semaforo":0,"memoria":0,"historia":0,"minhavez":0,"cacaalvo":0,"termometro":0}'::jsonb,
    '{"semaforo":"medio","memoria":"medio","historia":"medio","minhavez":"medio","cacaalvo":"medio","termometro":"medio"}'::jsonb
  )
  returning id into v_child_id;
  -- dispara trg_enforce_capacity_owned_profile também (redundante com o
  -- check acima de propósito - defesa em profundidade contra insert direto
  -- fora desta RPC).

  insert into parental_consents (child_profile_id, terms_version, consent_source, attested_by_professional_id)
  values (v_child_id, p_terms_version, 'professional_attested', v_professional_id);

  v_code := public.generate_access_code();
  insert into child_access_codes (child_profile_id, code_hash, created_by_professional_id)
  values (v_child_id, encode(extensions.digest(v_code, 'sha256'), 'hex'), v_professional_id);

  return json_build_object('child_profile_id', v_child_id, 'access_code', v_code);
end;
$function$;

comment on function public.create_owned_child_profile is
  'p_terms_version deve ser o texto/versão exata da declaração de atestação de consentimento (Termos de Uso seção 5) que o profissional aceitou na UI - grava em parental_consents.terms_version, mesma coluna já usada pelo fluxo de família, para manter uma única trilha de auditoria de consentimento.';

create or replace function public.rotate_access_code(p_child_profile_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_professional_id uuid;
  v_code text;
begin
  select id into v_professional_id from professionals where auth_user_id = auth.uid();
  if v_professional_id is null or not exists (
    select 1 from child_profiles where id = p_child_profile_id and professional_id = v_professional_id
  ) then
    raise exception 'not_authorized';
  end if;

  update child_access_codes set status = 'revoked', revoked_at = now()
  where child_profile_id = p_child_profile_id and status = 'active';
  -- Não derruba sessões já resgatadas (child_access_sessions) - só bloqueia
  -- resgates NOVOS com o código antigo. Desconectar um dispositivo já
  -- logado é uma ação separada (delete direto em child_access_sessions,
  -- já coberto pela policy "professional manages sessions of own profiles").

  v_code := public.generate_access_code();
  insert into child_access_codes (child_profile_id, code_hash, created_by_professional_id)
  values (p_child_profile_id, encode(extensions.digest(v_code, 'sha256'), 'hex'), v_professional_id);

  return v_code;
end;
$function$;

create or replace function public.delete_owned_child_profile(p_child_profile_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_professional_id uuid;
begin
  select id into v_professional_id from professionals where auth_user_id = auth.uid();
  if v_professional_id is null or not exists (
    select 1 from child_profiles where id = p_child_profile_id and professional_id = v_professional_id
  ) then
    raise exception 'not_authorized';
  end if;

  -- Explícito em vez de confiar em ON DELETE CASCADE em todas as FKs (não
  -- confirmado ao vivo pra cada tabela nesta sessão) - ordem: filhas antes
  -- da linha pai.
  delete from game_events where profile_id = p_child_profile_id;
  delete from game_sessions where profile_id = p_child_profile_id;
  delete from reading_progress where child_profile_id = p_child_profile_id;
  delete from adherence_goals where child_profile_id = p_child_profile_id;
  delete from parental_consents where child_profile_id = p_child_profile_id;
  delete from child_access_sessions where child_profile_id = p_child_profile_id;
  delete from child_access_codes where child_profile_id = p_child_profile_id;
  delete from child_profiles where id = p_child_profile_id;
end;
$function$;

comment on function public.delete_owned_child_profile is
  'Exclusão real e irreversível, distinta de "desativar por falta de capacidade" (access_suspended_at) - usada quando o PRÓPRIO profissional escolhe apagar, conforme o poder de "excluir" descrito no Termos de Uso seção 5. Não usar pra desativação por capacidade, que nunca apaga dado.';

-- Migration: Área dos Pais (parental PIN gate + game session history) + SECURITY HARDENING
-- Run this in the Supabase SQL editor for project pswmbqlafywaxphsrloe.

-- ==============================================================================
-- 0) SECURITY HARDENING (Proteção contra Ciberataques e Vazamento de Dados)
-- Substitui as políticas fracas (using true) por políticas estritas ligadas ao usuário logado.
-- ==============================================================================
drop policy if exists "Permitir tudo para usuários autenticados nas famílias" on families;
create policy "Acesso exclusivo do dono na tabela families"
  on families for all to authenticated 
  using (auth_user_id = auth.uid()) 
  with check (auth_user_id = auth.uid());

drop policy if exists "Permitir tudo para usuários autenticados nos perfis" on child_profiles;
create policy "Acesso exclusivo aos perfis da própria família"
  on child_profiles for all to authenticated
  using (family_id in (select id from families where auth_user_id = auth.uid()))
  with check (family_id in (select id from families where auth_user_id = auth.uid()));


-- ==============================================================================
-- 1) PIN gate: store a salted hash of the 4-digit parent PIN on the family row.
--    The client hashes "ilhadofoco:<family_id>:<pin>" with SHA-256 before sending it,
--    so the raw PIN never touches the network or the database.
-- ==============================================================================
alter table families add column if not exists parent_pin_hash text;

-- ==============================================================================
-- 2) One row per finished play visit, used to chart each child's evolution over time.
-- ==============================================================================
create table if not exists game_sessions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  profile_id uuid not null references child_profiles(id) on delete cascade,
  game_key text not null,
  difficulty text not null,
  stars smallint not null default 0,
  seeds_earned integer not null default 0,
  played_at timestamptz not null default now()
);

create index if not exists game_sessions_profile_played_idx
  on game_sessions (profile_id, played_at);

alter table game_sessions enable row level security;

drop policy if exists "families manage own game sessions" on game_sessions;
create policy "families manage own game sessions"
  on game_sessions
  for all to authenticated
  using (family_id in (select id from families where auth_user_id = auth.uid()))
  with check (family_id in (select id from families where auth_user_id = auth.uid()));


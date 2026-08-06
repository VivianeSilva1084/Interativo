alter table public.game_sessions
  add column if not exists start_time timestamptz not null default now();

alter table public.game_sessions
  add column if not exists status text not null default 'in_progress'
  check (status in ('in_progress', 'completed', 'abandoned'));

comment on column public.game_sessions.start_time is 'Momento em que a sessão foi criada (início da partida) — permite session_id existir desde o começo para game_events referenciar.';
comment on column public.game_sessions.status is 'in_progress = ainda jogando, completed = terminou normalmente, abandoned = saiu no meio (não recebeu UPDATE final).';

select 'ok' as status;
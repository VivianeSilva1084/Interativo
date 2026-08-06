alter table public.game_sessions
  add column if not exists end_time timestamptz;

comment on column public.game_sessions.end_time is 'Momento em que a sessão foi finalizada (status passou para completed ou abandoned).';

select 'ok' as status;
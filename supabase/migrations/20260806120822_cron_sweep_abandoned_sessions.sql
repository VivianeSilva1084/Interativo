-- Safety net for game_sessions stuck at status='in_progress' forever: the
-- client-side checkpoint (visibilitychange/pagehide) covers the common case,
-- but a hard crash or force-quit never fires any browser event at all. Any
-- session still in_progress 30+ minutes after it started is unambiguously
-- over (activities are a few minutes long) - close it out here regardless.
select cron.schedule(
  'sweep-abandoned-game-sessions',
  '*/30 * * * *',
  $$
  update public.game_sessions
  set status = 'abandoned', end_time = coalesce(end_time, now())
  where status = 'in_progress'
    and start_time < now() - interval '30 minutes';
  $$
);
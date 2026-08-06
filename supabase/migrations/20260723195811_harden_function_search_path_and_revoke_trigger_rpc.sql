-- Fixes "Function Search Path Mutable" warnings: pins search_path so these
-- functions can't be tricked by a session-level search_path change into
-- resolving unqualified table names to attacker-controlled objects.
alter function public.set_updated_at() set search_path = 'public';
alter function public.create_invite_code(uuid) set search_path = 'public';
alter function public.reset_child_progress(uuid) set search_path = 'public';

-- fill_game_session_family_id() only ever runs as a BEFORE INSERT trigger on
-- game_sessions - trigger firing doesn't require EXECUTE on the function, so
-- this only closes an unintended direct /rest/v1/rpc/... call surface.
revoke execute on function public.fill_game_session_family_id() from anon, authenticated;
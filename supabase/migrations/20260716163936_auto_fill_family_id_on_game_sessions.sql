create or replace function public.fill_game_session_family_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.family_id is null then
    select cp.family_id into new.family_id
    from public.child_profiles cp
    where cp.id = new.profile_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_fill_game_session_family_id on public.game_sessions;
create trigger trg_fill_game_session_family_id
  before insert on public.game_sessions
  for each row
  execute function public.fill_game_session_family_id();

select 'ok' as status;
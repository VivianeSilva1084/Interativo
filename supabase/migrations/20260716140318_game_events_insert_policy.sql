drop policy if exists "families insert own game events" on game_events;
create policy "families insert own game events"
  on game_events
  for insert
  to authenticated
  with check (
    profile_id in (
      select cp.id
      from child_profiles cp
      join families f on f.id = cp.family_id
      where f.auth_user_id = auth.uid()
    )
  );
-- Migration: allow families to insert their own children's game_events.
-- Run this in the Supabase SQL editor for project pswmbqlafywaxphsrloe.
--
-- game_events has RLS enabled with SELECT-only policies ("families read own
-- game events", "professional reads linked game events"). There is no INSERT
-- policy, so every insert from the client-side telemetry (logGameEvent in
-- index.html) is denied with 403, even for the family that owns the profile.

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

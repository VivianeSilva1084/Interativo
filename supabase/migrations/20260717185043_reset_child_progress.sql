drop policy if exists "families delete own game events" on game_events;
create policy "families delete own game events"
  on game_events
  for delete
  to authenticated
  using (
    profile_id in (
      select cp.id
      from child_profiles cp
      join families f on f.id = cp.family_id
      where f.auth_user_id = auth.uid()
    )
  );

create or replace function public.reset_child_progress(p_child_profile_id uuid)
returns void
language plpgsql
security invoker
as $$
begin
  delete from game_events where profile_id = p_child_profile_id;
  delete from game_sessions where profile_id = p_child_profile_id;

  update child_profiles
  set stars_by_game = '{"semaforo":0,"memoria":0,"historia":0,"minhavez":0,"cacaalvo":0,"termometro":0}'::jsonb,
      seeds = 0,
      unlocked_stickers = '[]'::jsonb
  where id = p_child_profile_id;

  update reading_progress
  set learned_letters = '[]'::jsonb,
      mastered_syllables = '[]'::jsonb,
      read_words = '[]'::jsonb,
      unlocked_clothing = '[]'::jsonb,
      equipped_clothing = null,
      challenges_completed = 0,
      daily_usage_seconds = '{}'::jsonb
  where child_profile_id = p_child_profile_id;
end;
$$;
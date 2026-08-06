create or replace view public.v_letter_difficulty
with (security_invoker = true) as
select * from (
  select
    profile_id,
    target as letter,
    count(*) as attempts,
    count(*) filter (where correct = true) as correct_count,
    round(100.0 * count(*) filter (where correct = true) / nullif(count(*), 0), 1) as accuracy_pct
  from public.game_events
  where event_type = 'answer' and target_type = 'letter'
  group by profile_id, target
) t where public.has_premium_access(t.profile_id);

create or replace view public.v_syllable_difficulty
with (security_invoker = true) as
select * from (
  select
    profile_id,
    target as syllable,
    count(*) as attempts,
    count(*) filter (where correct = true) as correct_count,
    round(100.0 * count(*) filter (where correct = true) / nullif(count(*), 0), 1) as accuracy_pct
  from public.game_events
  where event_type = 'answer' and target_type = 'syllable'
  group by profile_id, target
) t where public.has_premium_access(t.profile_id);

create or replace view public.v_word_difficulty
with (security_invoker = true) as
select * from (
  select
    profile_id,
    target as word,
    count(*) as attempts,
    count(*) filter (where correct = true) as correct_count,
    round(100.0 * count(*) filter (where correct = true) / nullif(count(*), 0), 1) as accuracy_pct
  from public.game_events
  where event_type = 'answer' and target_type = 'word'
  group by profile_id, target
  having count(*) > 0
) t where public.has_premium_access(t.profile_id)
order by accuracy_pct asc nulls last;

create or replace view public.v_phonological_swaps
with (security_invoker = true) as
select * from (
  select
    profile_id,
    target as expected,
    response_value as answered,
    count(*) as occurrences
  from public.game_events
  where event_type = 'answer'
    and correct = false
    and error_type = 'substituicao'
    and target_type in ('letter', 'syllable')
  group by profile_id, target, response_value
) t where public.has_premium_access(t.profile_id)
order by occurrences desc;

create or replace view public.v_error_type_summary
with (security_invoker = true) as
select * from (
  select
    profile_id,
    game_key,
    error_type,
    count(*) as occurrences
  from public.game_events
  where event_type = 'answer' and correct = false and error_type is not null
  group by profile_id, game_key, error_type
) t where public.has_premium_access(t.profile_id);

create or replace view public.v_reading_evolution
with (security_invoker = true) as
select * from (
  select
    profile_id,
    date_trunc('week', occurred_at) as week_start,
    avg(response_time_ms) as avg_response_time_ms,
    round(100.0 * count(*) filter (where correct = true) / nullif(count(*), 0), 1) as accuracy_pct,
    count(*) filter (where correct = false) as error_count
  from public.game_events
  where event_type = 'answer' and target_type in ('word', 'syllable')
  group by profile_id, date_trunc('week', occurred_at)
) t where public.has_premium_access(t.profile_id);

select 'ok' as status_parte_2;
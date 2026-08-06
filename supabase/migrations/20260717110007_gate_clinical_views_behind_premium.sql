create or replace view public.v_session_focus_duration
with (security_invoker = true) as
select * from (
  select
    ge.session_id,
    ge.profile_id,
    ge.game_key,
    min(ge.occurred_at) as started_at,
    max(ge.occurred_at) as ended_at,
    extract(epoch from (max(ge.occurred_at) - min(ge.occurred_at))) as duration_seconds,
    count(*) filter (where ge.event_type = 'distraction') as distractions
  from public.game_events ge
  where ge.event_type in ('answer', 'distraction')
  group by ge.session_id, ge.profile_id, ge.game_key
) t where public.has_premium_access(t.profile_id);

create or replace view public.v_weekly_focus_evolution
with (security_invoker = true) as
select * from (
  select
    profile_id,
    game_key,
    date_trunc('week', started_at) as week_start,
    avg(duration_seconds) as avg_duration_seconds,
    max(duration_seconds) as max_duration_seconds,
    min(duration_seconds) as min_duration_seconds,
    avg(distractions) as avg_distractions
  from public.v_session_focus_duration
  group by profile_id, game_key, date_trunc('week', started_at)
) t where public.has_premium_access(t.profile_id);

create or replace view public.v_response_time_trend
with (security_invoker = true) as
select * from (
  select
    profile_id,
    game_key,
    date_trunc('month', occurred_at) as month,
    avg(response_time_ms) as avg_response_time_ms,
    min(response_time_ms) as best_response_time_ms
  from public.game_events
  where event_type = 'answer' and response_time_ms is not null
  group by profile_id, game_key, date_trunc('month', occurred_at)
) t where public.has_premium_access(t.profile_id);

create or replace view public.v_impulsivity_raw
with (security_invoker = true) as
select * from (
  select
    profile_id,
    game_key,
    count(*) filter (where error_type = 'impulsiva') as impulsive_answers,
    count(*) filter (where correct = false) as wrong_answers,
    count(*) as total_answers
  from public.game_events
  where event_type = 'answer'
  group by profile_id, game_key
) t where public.has_premium_access(t.profile_id);

create or replace view public.v_working_memory
with (security_invoker = true) as
select * from (
  select
    profile_id,
    game_key,
    target_type,
    max((response_value is not null and correct = true)::int * length(target)) as longest_correct_sequence,
    avg(case when correct then length(target) else null end) as avg_correct_length
  from public.game_events
  where target_type = 'sequence'
  group by profile_id, game_key, target_type
) t where public.has_premium_access(t.profile_id);

create or replace view public.v_rule_adaptation
with (security_invoker = true) as
select * from (
  select
    profile_id,
    game_key,
    occurred_at as rule_changed_at,
    (
      select min(ge2.response_time_ms)
      from public.game_events ge2
      where ge2.profile_id = ge1.profile_id
        and ge2.event_type = 'answer'
        and ge2.occurred_at > ge1.occurred_at
      limit 1
    ) as time_to_adapt_ms
  from public.game_events ge1
  where event_type = 'rule_change'
) t where public.has_premium_access(t.profile_id);

create or replace view public.v_frustration_raw
with (security_invoker = true) as
select * from (
  select
    profile_id,
    game_key,
    count(*) filter (where event_type = 'abandon') as abandons,
    count(*) filter (where event_type = 'help_request') as help_requests,
    count(*) filter (where event_type = 'retry') as retries
  from public.game_events
  where event_type in ('abandon', 'help_request', 'retry')
  group by profile_id, game_key
) t where public.has_premium_access(t.profile_id);

create or replace view public.v_emotion_log
with (security_invoker = true) as
select * from (
  select
    profile_id,
    game_key,
    context,
    emotion,
    count(*) as occurrences,
    occurred_at
  from public.game_events
  where event_type = 'emotion_check'
  group by profile_id, game_key, context, emotion, occurred_at
) t where public.has_premium_access(t.profile_id);

create or replace view public.v_wait_task_compliance
with (security_invoker = true) as
select * from (
  select
    profile_id,
    game_key,
    count(*) filter (where correct = true) as waited_correctly,
    count(*) filter (where correct = false) as clicked_early,
    count(*) as total_attempts
  from public.game_events
  where event_type = 'wait_task'
  group by profile_id, game_key
) t where public.has_premium_access(t.profile_id);

create or replace view public.v_instruction_following
with (security_invoker = true) as
select * from (
  select
    profile_id,
    game_key,
    count(*) filter (where correct = true) as followed_correctly,
    count(*) as total_instructions,
    round(100.0 * count(*) filter (where correct = true) / nullif(count(*), 0), 1) as accuracy_pct
  from public.game_events
  where event_type = 'answer' and target_type = 'instruction'
  group by profile_id, game_key
) t where public.has_premium_access(t.profile_id);

select 'ok' as status_parte_1;
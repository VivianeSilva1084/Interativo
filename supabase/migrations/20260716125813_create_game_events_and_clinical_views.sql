-- ============================================================
-- Tabela de eventos granulares (fundação dos relatórios clínicos)
-- ============================================================

create table if not exists public.game_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.game_sessions(id) on delete cascade,
  profile_id uuid not null references public.child_profiles(id) on delete cascade,
  game_key text not null,
  event_type text not null check (event_type in (
    'answer', 'distraction', 'wait_task', 'rule_change',
    'emotion_check', 'abandon', 'help_request', 'retry'
  )),
  target text,                    -- ex: a letra/sílaba/palavra/instrução testada
  target_type text check (target_type in (
    'letter', 'syllable', 'word', 'instruction', 'sequence', 'image', 'rule', null
  )),
  response_value text,            -- o que a criança de fato respondeu/clicou
  correct boolean,
  response_time_ms integer,
  error_type text check (error_type in (
    'omissao', 'substituicao', 'inversao', 'acrescimo', 'impulsiva', null
  )),
  emotion text check (emotion in ('tranquilo', 'neutro', 'irritado', 'chorou', null)),
  context text check (context in ('after_error', 'after_wait', 'after_loss', 'general', null)),
  occurred_at timestamptz not null default now()
);

create index if not exists idx_game_events_profile on public.game_events (profile_id, occurred_at);
create index if not exists idx_game_events_session on public.game_events (session_id);
create index if not exists idx_game_events_target on public.game_events (game_key, target_type, target);

comment on table public.game_events is 'Eventos granulares por interação, usados para gerar os relatórios clínicos (atenção, impulsividade, consciência fonológica etc). Precisa ser populado pelo código dos jogos.';

alter table public.game_events enable row level security;

create policy "families read own game events"
  on public.game_events for select
  using (profile_id in (
    select cp.id from public.child_profiles cp
    join public.families f on f.id = cp.family_id
    where f.auth_user_id = auth.uid()
  ));

create policy "professional reads linked game events"
  on public.game_events for select
  using (
    profile_id in (
      select pcl.child_profile_id from public.professional_child_links pcl
      join public.professionals p on p.id = pcl.professional_id
      where p.auth_user_id = auth.uid() and pcl.status = 'active'
    )
  );

-- ============================================================
-- Views: relatórios gerais (psicólogo / função executiva)
-- ============================================================

-- 1. Duração de sessão (proxy de atenção sustentada)
create or replace view public.v_session_focus_duration as
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
group by ge.session_id, ge.profile_id, ge.game_key;

-- 2. Evolução semanal de atenção
create or replace view public.v_weekly_focus_evolution as
select
  profile_id,
  game_key,
  date_trunc('week', started_at) as week_start,
  avg(duration_seconds) as avg_duration_seconds,
  max(duration_seconds) as max_duration_seconds,
  min(duration_seconds) as min_duration_seconds,
  avg(distractions) as avg_distractions
from public.v_session_focus_duration
group by profile_id, game_key, date_trunc('week', started_at);

-- 3. Tempo de resposta (evolução)
create or replace view public.v_response_time_trend as
select
  profile_id,
  game_key,
  date_trunc('month', occurred_at) as month,
  avg(response_time_ms) as avg_response_time_ms,
  min(response_time_ms) as best_response_time_ms
from public.game_events
where event_type = 'answer' and response_time_ms is not null
group by profile_id, game_key, date_trunc('month', occurred_at);

-- 4. Respostas impulsivas (ingrediente bruto do índice de impulsividade)
create or replace view public.v_impulsivity_raw as
select
  profile_id,
  game_key,
  count(*) filter (where error_type = 'impulsiva') as impulsive_answers,
  count(*) filter (where correct = false) as wrong_answers,
  count(*) as total_answers
from public.game_events
where event_type = 'answer'
group by profile_id, game_key;

-- 5. Memória de trabalho (sequências)
create or replace view public.v_working_memory as
select
  profile_id,
  game_key,
  target_type,
  max((response_value is not null and correct = true)::int * length(target)) as longest_correct_sequence,
  avg(case when correct then length(target) else null end) as avg_correct_length
from public.game_events
where target_type = 'sequence'
group by profile_id, game_key, target_type;

-- 6. Adaptação a mudança de regra (flexibilidade cognitiva)
create or replace view public.v_rule_adaptation as
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
where event_type = 'rule_change';

-- 7. Tolerância à frustração (ingredientes brutos)
create or replace view public.v_frustration_raw as
select
  profile_id,
  game_key,
  count(*) filter (where event_type = 'abandon') as abandons,
  count(*) filter (where event_type = 'help_request') as help_requests,
  count(*) filter (where event_type = 'retry') as retries
from public.game_events
where event_type in ('abandon', 'help_request', 'retry')
group by profile_id, game_key;

-- 8. Regulação emocional
create or replace view public.v_emotion_log as
select
  profile_id,
  game_key,
  context,
  emotion,
  count(*) as occurrences,
  occurred_at
from public.game_events
where event_type = 'emotion_check'
group by profile_id, game_key, context, emotion, occurred_at;

-- 9. Tempo de espera
create or replace view public.v_wait_task_compliance as
select
  profile_id,
  game_key,
  count(*) filter (where correct = true) as waited_correctly,
  count(*) filter (where correct = false) as clicked_early,
  count(*) as total_attempts
from public.game_events
where event_type = 'wait_task'
group by profile_id, game_key;

-- 10. Seguir instruções
create or replace view public.v_instruction_following as
select
  profile_id,
  game_key,
  count(*) filter (where correct = true) as followed_correctly,
  count(*) as total_instructions,
  round(100.0 * count(*) filter (where correct = true) / nullif(count(*), 0), 1) as accuracy_pct
from public.game_events
where event_type = 'answer' and target_type = 'instruction'
group by profile_id, game_key;

-- ============================================================
-- Views: relatórios de fonoaudiologia
-- ============================================================

-- 11. Dificuldade por letra
create or replace view public.v_letter_difficulty as
select
  profile_id,
  target as letter,
  count(*) as attempts,
  count(*) filter (where correct = true) as correct_count,
  round(100.0 * count(*) filter (where correct = true) / nullif(count(*), 0), 1) as accuracy_pct
from public.game_events
where event_type = 'answer' and target_type = 'letter'
group by profile_id, target;

-- 12. Dificuldade por sílaba
create or replace view public.v_syllable_difficulty as
select
  profile_id,
  target as syllable,
  count(*) as attempts,
  count(*) filter (where correct = true) as correct_count,
  round(100.0 * count(*) filter (where correct = true) / nullif(count(*), 0), 1) as accuracy_pct
from public.game_events
where event_type = 'answer' and target_type = 'syllable'
group by profile_id, target;

-- 13. Palavras mais difíceis
create or replace view public.v_word_difficulty as
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
order by accuracy_pct asc nulls last;

-- 14. Trocas fonológicas (pares de confusão)
create or replace view public.v_phonological_swaps as
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
order by occurrences desc;

-- 15. Tipos de erro mais comuns
create or replace view public.v_error_type_summary as
select
  profile_id,
  game_key,
  error_type,
  count(*) as occurrences
from public.game_events
where event_type = 'answer' and correct = false and error_type is not null
group by profile_id, game_key, error_type;

-- 16. Evolução da leitura (velocidade e precisão ao longo do tempo)
create or replace view public.v_reading_evolution as
select
  profile_id,
  date_trunc('week', occurred_at) as week_start,
  avg(response_time_ms) as avg_response_time_ms,
  round(100.0 * count(*) filter (where correct = true) / nullif(count(*), 0), 1) as accuracy_pct,
  count(*) filter (where correct = false) as error_count
from public.game_events
where event_type = 'answer' and target_type in ('word', 'syllable')
group by profile_id, date_trunc('week', occurred_at);

select 'ok' as status;
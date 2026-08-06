-- Adiciona os tipos de evento que faltavam para medir impulsividade
alter table public.game_events drop constraint if exists game_events_event_type_check;
alter table public.game_events add constraint game_events_event_type_check check (event_type in (
  'answer', 'distraction', 'wait_task', 'rule_change',
  'emotion_check', 'abandon', 'help_request', 'retry',
  'premature_click', 'repeated_tap', 'activity_complete'
));

comment on column public.game_events.event_type is
  'premature_click = clicou antes da instrução/animação terminar. repeated_tap = tocou repetidamente sem necessidade. activity_complete = terminou a atividade sem interromper.';
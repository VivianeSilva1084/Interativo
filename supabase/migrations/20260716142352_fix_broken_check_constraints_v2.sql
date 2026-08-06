alter table public.game_events drop constraint if exists game_events_target_type_check;
alter table public.game_events add constraint game_events_target_type_check check (
  target_type is null or target_type in (
    'letter', 'syllable', 'word', 'instruction', 'sequence', 'image', 'rule', 'grid', 'light'
  )
);

alter table public.game_events drop constraint if exists game_events_error_type_check;
alter table public.game_events add constraint game_events_error_type_check check (
  error_type is null or error_type in (
    'omissao', 'omission', 'substituicao', 'inversao', 'acrescimo', 'impulsiva'
  )
);

alter table public.game_events drop constraint if exists game_events_emotion_check;
alter table public.game_events add constraint game_events_emotion_check check (
  emotion is null or emotion in ('tranquilo', 'neutro', 'irritado', 'chorou')
);

alter table public.game_events drop constraint if exists game_events_context_check;
alter table public.game_events add constraint game_events_context_check check (
  context is null or context in ('after_error', 'after_wait', 'after_loss', 'general')
);

select 'ok' as status;
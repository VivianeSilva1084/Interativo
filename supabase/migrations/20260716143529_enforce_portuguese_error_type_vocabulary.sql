alter table public.game_events drop constraint if exists game_events_error_type_check;
alter table public.game_events add constraint game_events_error_type_check check (
  error_type is null or error_type in (
    'omissao', 'substituicao', 'inversao', 'acrescimo', 'impulsiva'
  )
);

select 'ok' as status;
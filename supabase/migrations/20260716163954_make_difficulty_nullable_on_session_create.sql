alter table public.game_sessions alter column difficulty drop not null;

comment on column public.game_sessions.difficulty is 'Pode ser nulo na criação (início da sessão); preenchido depois via UPDATE quando a dificuldade é determinada durante o jogo.';

select 'ok' as status;
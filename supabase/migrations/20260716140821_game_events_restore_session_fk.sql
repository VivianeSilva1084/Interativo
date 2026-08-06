alter table game_events
  add constraint game_events_session_id_fkey
  foreign key (session_id) references game_sessions(id) on delete cascade;
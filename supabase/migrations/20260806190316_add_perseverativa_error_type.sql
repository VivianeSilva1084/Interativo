ALTER TABLE game_events DROP CONSTRAINT game_events_error_type_check;
ALTER TABLE game_events ADD CONSTRAINT game_events_error_type_check
  CHECK (error_type IS NULL OR error_type = ANY (ARRAY['omissao'::text, 'substituicao'::text, 'inversao'::text, 'acrescimo'::text, 'impulsiva'::text, 'perseverativa'::text]));
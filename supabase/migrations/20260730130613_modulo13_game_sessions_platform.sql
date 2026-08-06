ALTER TABLE public.game_sessions
  ADD COLUMN platform text,
  ADD CONSTRAINT game_sessions_platform_check CHECK (platform IS NULL OR platform IN ('ios', 'android', 'web'));

COMMENT ON COLUMN public.game_sessions.platform IS 'Dispositivo usado na sessão (Módulo 13) — NULL para sessões antigas ou de apps que ainda não enviam esse campo. Nunca usado para identificar usuário individual, só agregado (Módulo 13).';
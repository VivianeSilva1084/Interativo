-- Migration Módulo 5: catálogo de jogos (development_areas + games)
-- Decisão confirmada com o usuário (2026-07-30): game_key em game_sessions/game_events
-- continua texto livre, SEM foreign key para este catálogo — os apps irmãos (Aventura
-- das Letras / Ilha do Foco) inserem diretamente nessas tabelas em produção, e uma FK
-- rígida quebraria a inserção deles se o catálogo ficasse dessincronizado.

CREATE TABLE public.development_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  icon text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE public.games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  development_area_id uuid NOT NULL REFERENCES public.development_areas(id),
  min_age smallint,
  max_age smallint,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX games_development_area_id_idx ON public.games(development_area_id);

ALTER TABLE public.development_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_read_development_areas" ON public.development_areas
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "authenticated_read_games" ON public.games
  FOR SELECT TO authenticated USING (true);

COMMENT ON TABLE public.development_areas IS 'Áreas de Desenvolvimento (Módulo 5) — agrupam jogos por finalidade terapêutica/pedagógica. Escrita só via Edge Function admin-operations.';
COMMENT ON TABLE public.games IS 'Catálogo de jogos (Módulo 5) — game_key aqui é o mesmo valor livre já usado em game_sessions/game_events, sem FK rígida (decisão 2026-07-30).';

INSERT INTO public.development_areas (key, name, description, icon) VALUES
  ('atencao_funcoes_executivas', 'Atenção e Funções Executivas', 'Jogos focados em atenção sustentada, controle de impulsos e autorregulação.', '🏝️'),
  ('alfabetizacao_linguagem', 'Alfabetização e Linguagem', 'Jogos focados em consciência fonológica, sílabas e formação de palavras.', '📚');

INSERT INTO public.games (key, name, development_area_id, active)
SELECT v.key, v.name, da.id, true
FROM (VALUES
  ('semaforo', 'Semáforo', 'atencao_funcoes_executivas'),
  ('memoria', 'Memória', 'atencao_funcoes_executivas'),
  ('historia', 'História', 'atencao_funcoes_executivas'),
  ('minhavez', 'Minha Vez', 'atencao_funcoes_executivas'),
  ('cacaalvo', 'Caça ao Alvo', 'atencao_funcoes_executivas'),
  ('termometro', 'Termômetro', 'atencao_funcoes_executivas'),
  ('aventura_das_letras', 'Aventura das Letras', 'alfabetizacao_linguagem')
) AS v(key, name, area_key)
JOIN public.development_areas da ON da.key = v.area_key;
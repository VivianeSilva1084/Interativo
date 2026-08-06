ALTER TABLE public.games
  ADD COLUMN description text,
  ADD COLUMN skill_tag text,
  ADD COLUMN subactivities jsonb;

COMMENT ON COLUMN public.games.skill_tag IS 'Rótulo curto de habilidade exibido no app (ex: "Autocontrole", "Memória de Trabalho") — copy de produto, não taxonomia clínica formal.';
COMMENT ON COLUMN public.games.subactivities IS 'Array [{key,name,skill_tag,description}] das telas/subatividades internas de um jogo (ex: as 8 do Aventura das Letras) — metadado descritivo apenas. NÃO corresponde 1:1 a game_events.target_type/context; essa correspondência real ainda precisa ser verificada contra o código/dados do jogo antes de ser usada em relatório (Módulo 6/8).';

UPDATE public.games SET
  name = 'Luz da Espera',
  skill_tag = 'Autocontrole',
  description = 'Espera o verde antes de agir. Treina segurar o impulso.'
WHERE key = 'semaforo';

UPDATE public.games SET
  name = 'Memória da Kapi',
  skill_tag = 'Memória de Trabalho',
  description = 'Repete a sequência de folhinhas coloridas.'
WHERE key = 'memoria';

UPDATE public.games SET
  name = 'Monte a História',
  skill_tag = 'Sequenciamento',
  description = 'Coloca as cenas na ordem certa, do começo ao fim.'
WHERE key = 'historia';

UPDATE public.games SET
  name = 'Minha Vez, Sua Vez',
  skill_tag = 'Conversa e Turno',
  description = 'Escolhe a resposta certa e espera sua vez de falar.'
WHERE key = 'minhavez';

UPDATE public.games SET
  name = 'Caça ao Alvo',
  skill_tag = 'Atenção Sustentada',
  description = 'Encontra todas as folhinhas certas no tempo.'
WHERE key = 'cacaalvo';

UPDATE public.games SET
  name = 'Termômetro das Emoções',
  skill_tag = 'Regulação Emocional',
  description = 'Descobre como se sente e uma forma de se acalmar.'
WHERE key = 'termometro';

UPDATE public.games SET
  subactivities = '[
    {"key": "mundo_das_silabas", "name": "Mundo das Sílabas", "skill_tag": "Reconhecimento de Sílabas", "description": "Ouve e escolhe a sílaba certa entre as opções — primeiro contato com o som das letras."},
    {"key": "silabas_camufladas", "name": "Sílabas Camufladas", "skill_tag": "Discriminação Visual", "description": "Encontra a sílaba escondida no meio de outras parecidas."},
    {"key": "captura_de_silabas", "name": "Captura de Sílabas", "skill_tag": "Atenção e Leitura Rápida", "description": "Estoura só as bolhas com a sílaba certa antes que elas escapem."},
    {"key": "som_e_silabas", "name": "Som e Sílabas", "skill_tag": "Consciência Fonológica", "description": "Ouve o som e associa à sílaba que ele representa."},
    {"key": "monte_a_palavra", "name": "Monte a Palavra", "skill_tag": "Formação de Palavras", "description": "Arrasta as sílabas na ordem certa pra formar a palavra."},
    {"key": "floresta_das_palavras", "name": "Floresta das Palavras", "skill_tag": "Reconhecimento de Palavras", "description": "Escolhe a palavra certa pra cada figura, entre opções parecidas."},
    {"key": "castelo_das_frases", "name": "Castelo das Frases", "skill_tag": "Estrutura de Frase", "description": "Coloca as palavras na ordem certa pra formar uma frase com sentido."},
    {"key": "silaba_escondida", "name": "Sílaba Escondida", "skill_tag": "Consciência Fonêmica", "description": "Ouve a instrução e descobre a palavra que sobra sem aquela sílaba."}
  ]'::jsonb
WHERE key = 'aventura_das_letras';
-- Atribuição de qual profissional trouxe a família (link de convite copiável
-- no painel profissional) - só analytics, aditiva e opcional. Não dá ao
-- profissional acesso a nada: nenhuma policy de families lê essa coluna pro
-- profissional, o vínculo de acesso continua exigindo o fluxo normal de
-- código de convite + aprovação da família.
ALTER TABLE public.families ADD COLUMN IF NOT EXISTS referred_by_professional_id uuid REFERENCES public.professionals(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.families.referred_by_professional_id IS 'Atribuição opcional: preenchida quando a família se cadastra pelo link de convite copiável do painel profissional (?prof_ref=<id>). Somente analytics - não concede acesso; o vínculo real ainda exige código de convite + aprovação da família.';

SELECT 'ok' AS status;

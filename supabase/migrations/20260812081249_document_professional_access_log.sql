-- Documenta retroativamente a tabela professional_access_log, que já existe
-- em produção (criada fora do histórico de migrations versionado) e cujas
-- policies já vivem em 20260729192411_modulo2_seguranca_performance.sql
-- (linhas 96-103), mas cujo CREATE TABLE nunca foi salvo no repo.
--
-- politica-privacidade.html promete "todo acesso de um profissional aos
-- dados é registrado (log de auditoria)", mas nenhum código do app grava
-- nessa tabela hoje (grep -rn "professional_access_log" src/ não retorna
-- nada). Esta migration só garante que o schema existe em qualquer ambiente
-- (produção incluída, onde é um no-op); o INSERT de verdade entra em
-- professional-dashboard.js como parte do "Relatório de Indicadores".
--
-- Usa IF NOT EXISTS / DO blocks porque a tabela e as 2 policies já existem
-- em produção - rodar CREATE TABLE ou CREATE POLICY sem guarda falharia lá.

CREATE TABLE IF NOT EXISTS public.professional_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id uuid NOT NULL REFERENCES public.professionals(id) ON DELETE CASCADE,
  child_profile_id uuid NOT NULL REFERENCES public.child_profiles(id) ON DELETE CASCADE,
  accessed_at timestamptz NOT NULL DEFAULT now(),
  action text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_professional_access_log_child
  ON public.professional_access_log (child_profile_id, accessed_at);
CREATE INDEX IF NOT EXISTS idx_professional_access_log_professional
  ON public.professional_access_log (professional_id, accessed_at);

ALTER TABLE public.professional_access_log ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'professional_access_log'
      AND policyname = 'professional inserts own access log'
  ) THEN
    CREATE POLICY "professional inserts own access log" ON public.professional_access_log
      FOR INSERT TO authenticated
      WITH CHECK (professional_id IN (
        SELECT p.id FROM public.professionals p WHERE p.auth_user_id = auth.uid()
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'professional_access_log'
      AND policyname = 'parent reads access log of own children'
  ) THEN
    CREATE POLICY "parent reads access log of own children" ON public.professional_access_log
      FOR SELECT TO authenticated
      USING (child_profile_id IN (
        SELECT cp.id FROM public.child_profiles cp
        JOIN public.families f ON f.id = cp.family_id
        WHERE f.auth_user_id = auth.uid()
      ));
  END IF;
END $$;

COMMENT ON TABLE public.professional_access_log IS 'Log de auditoria de acesso profissional aos dados de uma criança (LGPD art. 11/14) - prometido em politica-privacidade.html secao 5. Inserido pelo próprio profissional autenticado (RLS restringe a INSERT à própria linha); lido pela família da criança. Tabela documentada retroativamente nesta migration - já existia em produção fora do histórico versionado.';

SELECT 'ok' AS status;

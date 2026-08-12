-- Documentação retroativa: aplicada via MCP apply_migration sem espelho local
-- na hora (corrigido nesta migration de reconciliação).
--
-- CREATE OR REPLACE VIEW não herda security_invoker automaticamente - a view
-- v_activity_difficulty (migration anterior) nasceu SECURITY DEFINER (roda
-- com permissão de quem criou, ignorando RLS de quem consulta), sinalizado
-- como ERROR pelo linter de segurança logo após a criação. Corrigido aqui.
ALTER VIEW public.v_activity_difficulty SET (security_invoker = true);

SELECT 'ok' AS status;

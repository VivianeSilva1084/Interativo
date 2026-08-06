CREATE OR REPLACE FUNCTION public.find_family_id_by_email(p_email text)
RETURNS TABLE(family_id uuid, child_names text[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid;
  v_family_id uuid;
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE lower(email) = lower(p_email);
  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  SELECT id INTO v_family_id FROM public.families WHERE auth_user_id = v_user_id;
  IF v_family_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT v_family_id, coalesce(array_agg(cp.name) FILTER (WHERE cp.name IS NOT NULL), ARRAY[]::text[])
  FROM public.child_profiles cp
  WHERE cp.family_id = v_family_id;
END;
$$;

COMMENT ON FUNCTION public.find_family_id_by_email(text) IS 'Resolve family_id a partir do e-mail do responsável (Módulo 9) — só chamável via service role (admin-operations), EXECUTE revogado de public/anon/authenticated.';

REVOKE ALL ON FUNCTION public.find_family_id_by_email(text) FROM PUBLIC, anon, authenticated;
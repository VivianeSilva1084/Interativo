CREATE OR REPLACE FUNCTION public.has_premium_access(p_child_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select coalesce(
    (select public.family_has_access(cp.family_id) from public.child_profiles cp where cp.id = p_child_profile_id),
    false
  );
$function$;

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_plan_check CHECK (plan IN ('free', 'premium')),
  ADD CONSTRAINT subscriptions_status_check CHECK (status IN (
    'active', 'past_due', 'canceled', 'incomplete', 'incomplete_expired', 'trialing', 'unpaid', 'paused'
  )),
  ADD CONSTRAINT subscriptions_provider_check CHECK (provider IS NULL OR provider IN ('stripe', 'asaas', 'admin'));
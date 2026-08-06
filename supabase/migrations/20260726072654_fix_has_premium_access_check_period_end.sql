create or replace function public.has_premium_access(p_child_profile_id uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $function$
  select exists (
    select 1 from child_profiles cp
    join subscriptions s on s.family_id = cp.family_id
    where cp.id = p_child_profile_id
      and (
        (s.plan = 'premium' and (s.current_period_end is null or s.current_period_end > now()))
        or (s.admin_granted_until is not null and s.admin_granted_until > now())
      )
  );
$function$;
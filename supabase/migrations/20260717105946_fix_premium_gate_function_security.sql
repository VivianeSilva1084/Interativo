create or replace function public.has_premium_access(p_child_profile_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from child_profiles cp
    join subscriptions s on s.family_id = cp.family_id
    where cp.id = p_child_profile_id
      and (
        s.plan = 'premium'
        or (s.admin_granted_until is not null and s.admin_granted_until > now())
      )
  );
$$;

select 'ok' as status;
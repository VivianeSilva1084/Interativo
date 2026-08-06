alter table public.families add column legacy_free_access boolean not null default false;
update public.families set legacy_free_access = true;

create or replace function public.family_has_access(p_family_id uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $function$
  select exists (
    select 1 from families f
    left join subscriptions s on s.family_id = f.id
    where f.id = p_family_id
      and (
        f.legacy_free_access = true
        or (s.plan = 'premium' and (s.current_period_end is null or s.current_period_end > now()))
        or (s.admin_granted_until is not null and s.admin_granted_until > now())
      )
  );
$function$;
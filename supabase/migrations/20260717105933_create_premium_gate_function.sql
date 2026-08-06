create or replace function public.has_premium_access(p_child_profile_id uuid)
returns boolean
language sql
security invoker
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

comment on function public.has_premium_access is 'Retorna true se a família da criança tem plano premium ativo (ou liberação administrativa vigente). Usada para travar relatórios clínicos avançados no plano free.';

select 'ok' as status;
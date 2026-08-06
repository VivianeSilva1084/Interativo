-- Funções auxiliares SECURITY DEFINER: quebram o ciclo de recursão,
-- porque rodam com privilégio elevado internamente, sem reacionar o RLS
-- da tabela que consultam por dentro.

create or replace function public.is_own_child_profile(p_child_profile_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from child_profiles cp
    join families f on f.id = cp.family_id
    where cp.id = p_child_profile_id and f.auth_user_id = auth.uid()
  );
$$;

create or replace function public.is_linked_professional_for_child(p_child_profile_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from professional_child_links pcl
    join professionals p on p.id = pcl.professional_id
    where pcl.child_profile_id = p_child_profile_id
      and p.auth_user_id = auth.uid()
      and pcl.status = 'active'
  );
$$;

-- Corrige o lado de child_profiles: usa a função em vez de subquery direta
drop policy if exists "professional reads linked child profile" on public.child_profiles;
create policy "professional reads linked child profile"
  on public.child_profiles for select
  using (public.is_linked_professional_for_child(id));

-- Corrige o lado de professional_child_links: usa a função em vez de subquery direta
drop policy if exists "parent reads links of own children" on public.professional_child_links;
create policy "parent reads links of own children"
  on public.professional_child_links for select
  using (public.is_own_child_profile(child_profile_id));

drop policy if exists "parent updates link status" on public.professional_child_links;
create policy "parent updates link status"
  on public.professional_child_links for update
  using (public.is_own_child_profile(child_profile_id));

drop policy if exists "parent creates pending link" on public.professional_child_links;
create policy "parent creates pending link"
  on public.professional_child_links for insert
  with check (public.is_own_child_profile(child_profile_id) and invited_by = 'parent');

select 'ok' as status;
create or replace function public.delete_my_account()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family_id uuid;
  v_child_id uuid;
  v_professional_id uuid;
  v_deleted_children int := 0;
begin
  -- Lado família
  select id into v_family_id from public.families where auth_user_id = auth.uid();

  if v_family_id is not null then
    for v_child_id in select id from public.child_profiles where family_id = v_family_id loop
      delete from public.game_events where profile_id = v_child_id;
      delete from public.game_sessions where profile_id = v_child_id;
      v_deleted_children := v_deleted_children + 1;
    end loop;

    -- cascata cuida de: reading_progress, adherence_goals,
    -- professional_child_links (lado criança), invite_codes
    delete from public.child_profiles where family_id = v_family_id;

    -- cascata cuida de: subscriptions, parental_consents
    delete from public.families where id = v_family_id;
  end if;

  -- Lado profissional
  select id into v_professional_id from public.professionals where auth_user_id = auth.uid();

  if v_professional_id is not null then
    -- cascata cuida de: professional_child_links (lado profissional),
    -- professional_access_log
    delete from public.professionals where id = v_professional_id;
  end if;

  -- Por fim, a conta de autenticação em si
  delete from auth.users where id = auth.uid();

  return json_build_object(
    'success', true,
    'family_deleted', v_family_id is not null,
    'professional_deleted', v_professional_id is not null,
    'children_deleted', v_deleted_children
  );
end;
$$;

grant execute on function public.delete_my_account() to authenticated;

comment on function public.delete_my_account is 'Exclusão completa e irreversível da conta do usuário autenticado (família e/ou profissional), incluindo todos os dados relacionados (crianças, progresso, eventos, assinatura, vínculos). Usado para atender ao direito de exclusão de dados (LGPD/GDPR).';

select 'ok' as status;
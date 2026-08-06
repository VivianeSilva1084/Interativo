create table if not exists public.invite_codes (
  id uuid primary key default gen_random_uuid(),
  child_profile_id uuid not null references public.child_profiles(id) on delete cascade,
  code text not null unique,
  created_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null default (timezone('utc', now()) + interval '7 days'),
  used_by_professional_id uuid references public.professionals(id),
  used_at timestamptz
);

comment on table public.invite_codes is 'Códigos de convite gerados pelos pais para profissionais solicitarem vínculo com uma criança.';

alter table public.invite_codes enable row level security;

create policy "families manage own invite codes"
  on public.invite_codes for all
  using (public.is_own_child_profile(child_profile_id))
  with check (public.is_own_child_profile(child_profile_id));

-- Gera um código legível (ex: MAYA-7F3K) e cria o registro.
-- SECURITY INVOKER: respeita o RLS acima, então só o próprio pai consegue gerar.
create or replace function public.create_invite_code(p_child_profile_id uuid)
returns text
language plpgsql
security invoker
as $$
declare
  v_name text;
  v_code text;
  v_attempt int := 0;
begin
  select upper(left(regexp_replace(name, '[^a-zA-Z]', '', 'g'), 4))
  into v_name
  from public.child_profiles
  where id = p_child_profile_id;

  if v_name is null or v_name = '' then
    v_name := 'CRIA';
  end if;

  loop
    v_code := v_name || '-' || upper(substr(md5(random()::text), 1, 4));
    exit when not exists (select 1 from public.invite_codes where code = v_code);
    v_attempt := v_attempt + 1;
    if v_attempt > 10 then
      raise exception 'Não foi possível gerar um código único, tente novamente.';
    end if;
  end loop;

  insert into public.invite_codes (child_profile_id, code)
  values (p_child_profile_id, v_code);

  return v_code;
end;
$$;

-- Resgata um código: cria o vínculo pendente. SECURITY DEFINER porque o
-- profissional não tem (nem deve ter) acesso de leitura direto a invite_codes
-- de outras famílias.
create or replace function public.redeem_invite_code(p_code text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite record;
  v_professional_id uuid;
  v_child_name text;
begin
  select id into v_professional_id
  from public.professionals
  where auth_user_id = auth.uid();

  if v_professional_id is null then
    return json_build_object('success', false, 'error', 'not_a_professional');
  end if;

  select * into v_invite
  from public.invite_codes
  where code = upper(p_code)
  for update;

  if v_invite is null then
    return json_build_object('success', false, 'error', 'code_not_found');
  end if;

  if v_invite.used_at is not null then
    return json_build_object('success', false, 'error', 'code_already_used');
  end if;

  if v_invite.expires_at < now() then
    return json_build_object('success', false, 'error', 'code_expired');
  end if;

  select name into v_child_name from public.child_profiles where id = v_invite.child_profile_id;

  insert into public.professional_child_links (professional_id, child_profile_id, status, invited_by)
  values (v_professional_id, v_invite.child_profile_id, 'pending', 'parent')
  on conflict (professional_id, child_profile_id) do nothing;

  update public.invite_codes
  set used_at = now(), used_by_professional_id = v_professional_id
  where id = v_invite.id;

  return json_build_object('success', true, 'child_name', v_child_name);
end;
$$;

select 'ok' as status;
alter table public.families add constraint families_auth_user_id_key unique (auth_user_id);
alter table public.professionals add constraint professionals_auth_user_id_key unique (auth_user_id);
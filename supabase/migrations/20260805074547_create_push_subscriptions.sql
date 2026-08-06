create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  admin_email text not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default timezone('utc'::text, now())
);

comment on table public.push_subscriptions is 'Web Push subscriptions for admins of admin.html (CRM), used to notify confirmed sales. Edge Functions read this via service role, bypassing RLS.';

alter table public.push_subscriptions enable row level security;

create policy admins_can_select_own_push_subscriptions
  on public.push_subscriptions for select
  to authenticated
  using (
    lower(admin_email) = lower(((select auth.jwt()) ->> 'email'::text))
    and exists (select 1 from public.admins where lower(admins.email) = lower(((select auth.jwt()) ->> 'email'::text)))
  );

create policy admins_can_insert_own_push_subscriptions
  on public.push_subscriptions for insert
  to authenticated
  with check (
    lower(admin_email) = lower(((select auth.jwt()) ->> 'email'::text))
    and exists (select 1 from public.admins where lower(admins.email) = lower(((select auth.jwt()) ->> 'email'::text)))
  );

create policy admins_can_update_own_push_subscriptions
  on public.push_subscriptions for update
  to authenticated
  using (
    lower(admin_email) = lower(((select auth.jwt()) ->> 'email'::text))
    and exists (select 1 from public.admins where lower(admins.email) = lower(((select auth.jwt()) ->> 'email'::text)))
  )
  with check (
    lower(admin_email) = lower(((select auth.jwt()) ->> 'email'::text))
    and exists (select 1 from public.admins where lower(admins.email) = lower(((select auth.jwt()) ->> 'email'::text)))
  );

create policy admins_can_delete_own_push_subscriptions
  on public.push_subscriptions for delete
  to authenticated
  using (
    lower(admin_email) = lower(((select auth.jwt()) ->> 'email'::text))
    and exists (select 1 from public.admins where lower(admins.email) = lower(((select auth.jwt()) ->> 'email'::text)))
  );
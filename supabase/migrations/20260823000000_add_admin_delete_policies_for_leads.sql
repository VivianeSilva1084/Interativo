-- admin.html's deleteLead() has always issued DELETE on lead_events then
-- leads, but neither table ever had a DELETE policy - RLS silently denies
-- with 0 rows affected (no error), so the button appeared to do nothing.
-- Mirrors the existing admins_can_update_leads USING clause.
create policy "admins_can_delete_lead_events" on public.lead_events
for delete
to authenticated
using (
  exists (
    select 1 from admins
    where lower(admins.email) = lower((select auth.jwt()) ->> 'email')
  )
);

create policy "admins_can_delete_leads" on public.leads
for delete
to authenticated
using (
  exists (
    select 1 from admins
    where lower(admins.email) = lower((select auth.jwt()) ->> 'email')
  )
);

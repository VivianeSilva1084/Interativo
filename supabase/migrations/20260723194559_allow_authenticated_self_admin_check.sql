create policy authenticated_can_check_own_admin_row on public.admins
for select
to authenticated
using (lower(email) = lower(auth.jwt()->>'email'));
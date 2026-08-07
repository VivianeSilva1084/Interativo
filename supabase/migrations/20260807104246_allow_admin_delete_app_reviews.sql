-- Admin needs to be able to remove a review after approving it by mistake
-- (or later, if it turns out to be spam/fake) - no delete policy existed
-- yet, so even an admin was blocked by RLS's default-deny.
create policy "admins_can_delete_app_reviews"
on public.app_reviews
for delete
to authenticated
using (
  exists (
    select 1 from public.admins
    where lower(admins.email) = lower(auth.jwt() ->> 'email')
  )
);

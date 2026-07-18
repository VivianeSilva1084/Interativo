-- Migration: let a professional delete their own account after having redeemed
-- an invite code. Run this in the Supabase SQL editor for project pswmbqlafywaxphsrloe.
--
-- Found while testing delete_my_account(): invite_codes.used_by_professional_id
-- had ON DELETE NO ACTION, so `delete from professionals` inside
-- delete_my_account() failed with a foreign key violation whenever the
-- professional had redeemed at least one invite code for a family they don't
-- also belong to (the family-side of that same invite_codes row isn't part of
-- the transaction, so it never gets cascaded away first). The invite_codes row
-- itself is a historical record worth keeping - only the now-deleted
-- professional's reference needs to go.

alter table invite_codes drop constraint invite_codes_used_by_professional_id_fkey;
alter table invite_codes
  add constraint invite_codes_used_by_professional_id_fkey
  foreign key (used_by_professional_id) references professionals(id) on delete set null;

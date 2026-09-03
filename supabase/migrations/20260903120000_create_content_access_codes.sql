-- Per-purchase access codes for content that's gated behind a client-side
-- app instead of a plain signed-URL PDF (Pare de Repetir's digital-pack
-- app at /pare-de-repetir) - one code per sale, so a single leaked code can
-- be revoked without touching anyone else's access. Row insert happens
-- server-side only (webhooks, service role) - the public check-access-code
-- function is the only thing allowed to read this table from the outside,
-- so a code can't be enumerated by querying the table directly.
create table public.content_access_codes (
  code text primary key,
  sku text not null,
  email text not null,
  revoked boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.content_access_codes enable row level security;
-- Deliberately no policies: service role (used by webhooks and by
-- check-access-code) bypasses RLS entirely, and no anon/authenticated
-- access is ever needed for this table.

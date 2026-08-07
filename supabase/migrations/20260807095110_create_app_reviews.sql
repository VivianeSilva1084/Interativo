-- Avaliações públicas do app (estrelas + comentário opcional), exibidas como
-- depoimentos em vendas.html só depois de aprovação manual - qualquer
-- visitante pode enviar (sem exigir compra comprovada), a moderação é a
-- única barreira antes de virar conteúdo público.
create table public.app_reviews (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  rating smallint not null check (rating between 1 and 5),
  comment text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  approved_at timestamp with time zone
);

comment on table public.app_reviews is 'Avaliações enviadas via formulário público em vendas.html. status=pending até aprovação manual do admin; só approved aparece publicamente como depoimento.';

create index idx_app_reviews_status on public.app_reviews(status);
create index idx_app_reviews_created_at on public.app_reviews(created_at desc);

alter table public.app_reviews enable row level security;

-- Público pode enviar avaliação, sempre como pending - o check garante isso
-- mesmo que alguém tente manipular o payload pra inserir já como approved.
create policy "public_can_insert_app_reviews"
on public.app_reviews
for insert
to anon
with check (status = 'pending');

-- Público pode ler só as aprovadas (pra exibir como depoimento em vendas.html).
create policy "public_can_select_approved_app_reviews"
on public.app_reviews
for select
to anon
using (status = 'approved');

-- Admin (mesma allowlist de e-mails já usada pro CRM/funil) vê tudo, inclusive pendentes.
create policy "admins_can_select_app_reviews"
on public.app_reviews
for select
to authenticated
using (
  exists (
    select 1 from public.admins
    where lower(admins.email) = lower(auth.jwt() ->> 'email')
  )
);

-- Admin aprova/rejeita (muda status).
create policy "admins_can_update_app_reviews"
on public.app_reviews
for update
to authenticated
using (
  exists (
    select 1 from public.admins
    where lower(admins.email) = lower(auth.jwt() ->> 'email')
  )
)
with check (
  exists (
    select 1 from public.admins
    where lower(admins.email) = lower(auth.jwt() ->> 'email')
  )
);

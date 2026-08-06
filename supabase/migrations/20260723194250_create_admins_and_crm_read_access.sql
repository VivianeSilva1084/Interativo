-- Lista de administradores do negócio (não confundir com `professionals`,
-- que são fonoaudiólogos/psicólogos vinculados a crianças específicas).
-- Admins têm visão do funil de marketing/CRM, não de dados clínicos de crianças.
create table public.admins (
  email text primary key,
  created_at timestamp with time zone not null default timezone('utc'::text, now())
);

comment on table public.admins is 'Allowlist de e-mails com acesso ao painel de CRM/funil. Login via Supabase Auth; RLS confere o e-mail autenticado contra esta tabela.';

insert into public.admins (email) values ('vivianemiriane_21@hotmail.com');

alter table public.admins enable row level security;
-- Ninguém lê/escreve essa tabela via client (nem admin) — só gerenciada por migration/service_role.
-- (Nenhuma policy criada de propósito = acesso negado por padrão a anon/authenticated.)

-- Permite que administradores logados (via Supabase Auth) leiam leads e lead_events.
-- O público (anon) continua podendo só inserir (policies já existentes), nunca ler.
create policy "admins_can_select_leads"
on public.leads
for select
to authenticated
using (
  exists (
    select 1 from public.admins
    where lower(admins.email) = lower(auth.jwt() ->> 'email')
  )
);

create policy "admins_can_select_lead_events"
on public.lead_events
for select
to authenticated
using (
  exists (
    select 1 from public.admins
    where lower(admins.email) = lower(auth.jwt() ->> 'email')
  )
);

-- Também permite ao admin mover leads manualmente entre estágios no kanban
-- (ex: marcar como "perdido", ou "contatado" depois de uma ligação manual).
create policy "admins_can_update_leads"
on public.leads
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
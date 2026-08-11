-- Módulo 14, Parte 6 — a coluna verification_status já existia
-- (20260729193031_modulo3_professional_verification.sql), mas nada nunca
-- disparava 'pending' nem guardava o comprovante em lugar nenhum. Fecha essa
-- lacuna: bucket privado de Storage + coluna do caminho do arquivo + RLS.
-- RASCUNHO — não aplicado.

alter table public.professionals
  add column verification_document_path text;

comment on column public.professionals.verification_document_path is
  'Caminho no bucket privado professional-verification-docs do comprovante de registro profissional enviado (foto/PDF da carteira do conselho). NULL até o primeiro envio.';

insert into storage.buckets (id, name, public)
values ('professional-verification-docs', 'professional-verification-docs', false)
on conflict (id) do nothing;

-- Profissional só enxerga/escreve o próprio arquivo, no caminho
-- <professional_id>/<qualquer-nome> (convenção reforçada pelo client, não
-- pelo banco - a policy só confere o primeiro segmento do path).
create policy "professional manages own verification doc"
on storage.objects for all
using (
  bucket_id = 'professional-verification-docs'
  and (storage.foldername(name))[1] in (select id::text from public.professionals where auth_user_id = auth.uid())
)
with check (
  bucket_id = 'professional-verification-docs'
  and (storage.foldername(name))[1] in (select id::text from public.professionals where auth_user_id = auth.uid())
);

-- Admin lê qualquer comprovante (pra revisar) - mesma allowlist e mesmo
-- padrão (lower() + auth.jwt() envolto em SELECT, pelo fix de performance do
-- Módulo 2) já usado em todas as outras policies de admin do projeto.
create policy "admin reads verification docs"
on storage.objects for select
using (
  bucket_id = 'professional-verification-docs'
  and exists (select 1 from public.admins where lower(admins.email) = lower((select auth.jwt() ->> 'email')))
);

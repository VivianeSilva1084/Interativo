-- Módulo 3, Fase 3 — eleva professionals.license_number a um estado de
-- verificação explícito (docs/architecture/03-seguranca-autenticacao.md, seção 3).
-- Testado localmente antes de aplicar em produção.

create type professional_verification_status as enum ('unverified', 'pending', 'verified', 'rejected');

alter table public.professionals
  add column verification_status professional_verification_status not null default 'unverified';

create index idx_professionals_verification_status on public.professionals(verification_status);

comment on column public.professionals.verification_status is
  'Estado de verificação da licença profissional. "unverified" ao cadastrar; "pending" quando envia comprovante; "verified"/"rejected" após revisão do admin (Módulo 4/9). Camada de confiança — não é o que autoriza acesso a dado de criança, isso continua sendo professional_child_links.status.';
-- Migration Módulo 4: Adição de tier aos admins

-- 1. Adicionar coluna tier à tabela admins com restrição de valor
ALTER TABLE public.admins
ADD COLUMN tier VARCHAR(20) NOT NULL DEFAULT 'admin'
CHECK (tier IN ('super_admin', 'admin'));

-- 2. Atualiza os administradores existentes (apenas o primeiro/fundador) para super_admin
-- No cenário real, assumimos que quem já estava lá antes de ter distinção se torna super_admin
UPDATE public.admins SET tier = 'super_admin';
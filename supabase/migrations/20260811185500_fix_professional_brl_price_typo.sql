-- Correção de valor: a migração anterior (20260811183000) inseriu R$58,00
-- como referência pro plano profissional em BRL, mas o preço real criado
-- no Stripe (e usado de fato no checkout) é R$58,90 - esta coluna é só
-- informativa (create-professional-checkout-session cobra pelo price_id do
-- Stripe direto, não por este valor), mas precisa bater pra não confundir
-- quem olhar a tabela depois.
update public.plans set price = 58.90 where audience = 'professional' and currency = 'BRL';

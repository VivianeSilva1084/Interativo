-- Novo estágio: "cadastrado" = virou usuário do app (conta criada, tier gratuito),
-- mas ainda não pagou por nada. Fica entre "contatado" e "cliente"/"trial".
alter table public.leads drop constraint leads_funnel_stage_check;
alter table public.leads add constraint leads_funnel_stage_check
  check (funnel_stage = any (array['novo','contatado','cadastrado','trial','cliente','perdido']));

-- Coluna separada de converted_family_id: essa aqui é setada assim que a pessoa
-- cria conta (gratuita), independente de pagamento. converted_family_id continua
-- reservado só pra quando vira cliente pagante (não mexer no significado dele).
alter table public.leads add column signup_family_id uuid references public.families(id);

comment on column public.leads.signup_family_id is 'Preenchido quando o lead cria uma conta/família (tier gratuito), independente de ter pago. Diferente de converted_family_id, que só é setado na conversão paga.';

-- Quando o signup acontece, o funnel_stage avança pra "cadastrado" (só se ainda
-- estiver em novo/contatado, nunca regride um lead que já é cliente/trial).
-- Isso vai ser feito via update explícito no fluxo de signup, não via trigger,
-- porque precisa de contexto (qual family foi criada) que só a aplicação tem.;
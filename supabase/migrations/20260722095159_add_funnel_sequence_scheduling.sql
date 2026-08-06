-- Controle de sequência de nutrição (WhatsApp + email) por lead
alter table public.leads
  add column sequence_step integer not null default 0,
  add column next_step_at timestamp with time zone;

comment on column public.leads.sequence_step is 'Quantos passos da sequência de nutrição já foram enviados (0 = nenhum ainda).';
comment on column public.leads.next_step_at is 'Quando a function de despacho deve considerar este lead para o próximo passo. Null = sequência parada (convertido ou perdido).';

-- Assim que o lead entra, ele já fica elegível pro primeiro passo imediatamente
create or replace function public.set_leads_initial_next_step()
returns trigger as $$
begin
  if new.next_step_at is null and new.funnel_stage = 'novo' then
    new.next_step_at = now();
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_leads_initial_next_step
before insert on public.leads
for each row execute function public.set_leads_initial_next_step();

-- Para de agendar automaticamente quando o lead converte ou é perdido
create or replace function public.stop_sequence_on_terminal_stage()
returns trigger as $$
begin
  if new.funnel_stage in ('cliente', 'perdido') then
    new.next_step_at = null;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_leads_stop_sequence
before update on public.leads
for each row execute function public.stop_sequence_on_terminal_stage();

create index idx_leads_next_step_at on public.leads(next_step_at) where next_step_at is not null;
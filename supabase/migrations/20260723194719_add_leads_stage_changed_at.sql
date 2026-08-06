alter table public.leads add column stage_changed_at timestamptz not null default now();
update public.leads set stage_changed_at = created_at;

create or replace function public.set_leads_stage_changed_at() returns trigger as $$
begin
  if new.funnel_stage is distinct from old.funnel_stage then
    new.stage_changed_at = now();
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_leads_stage_changed_at
before update on public.leads
for each row execute function public.set_leads_stage_changed_at();
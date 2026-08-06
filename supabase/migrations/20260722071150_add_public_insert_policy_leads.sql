-- Permite que o site público (anon key) crie novos leads via quiz,
-- mas nunca leia, atualize ou apague — isso continua restrito ao service_role (Edge Functions/dashboard interno).
create policy "public_can_insert_leads"
on public.leads
for insert
to anon
with check (true);

-- Também permite registrar o evento de quiz completo direto do client (ex: instagram_follow_clicked),
-- mas só insert, nunca leitura.
create policy "public_can_insert_lead_events"
on public.lead_events
for insert
to anon
with check (true);
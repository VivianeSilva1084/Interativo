alter table public.lead_events drop constraint lead_events_event_type_check;
alter table public.lead_events add constraint lead_events_event_type_check
  check (event_type = any (array['quiz_completed','whatsapp_sent','whatsapp_replied','email_sent','email_opened','instagram_follow_clicked','instagram_dm_sent','checkout_started','converted','lost','sales_page_visited']));
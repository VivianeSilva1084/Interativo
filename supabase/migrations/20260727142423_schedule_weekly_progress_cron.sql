select cron.schedule(
  'weekly-progress',
  '0 12 * * 1',
  $$
  select net.http_post(
    url := 'https://pswmbqlafywaxphsrloe.supabase.co/functions/v1/send-weekly-progress',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<REDACTED_SEE_CRON_SECRET_IN_SUPABASE>'),
    body := '{}'::jsonb
  );
  $$
);
-- process-funnel-sequence existed and worked but nothing ever called it - no
-- cron, no scheduler - which is why 85% of leads sat stuck at whatever stage
-- they landed on. Delays inside the function are hour-scale (48h between the
-- welcome and last-chance emails), so every 30 minutes is frequent enough
-- that a due lead never waits long, without hammering the function - it's a
-- cheap no-op run whenever nothing is actually due yet.
select cron.schedule(
  'process-funnel-sequence',
  '*/30 * * * *',
  $$
  select net.http_post(
    url := 'https://pswmbqlafywaxphsrloe.supabase.co/functions/v1/process-funnel-sequence',
    headers := '{"Content-Type": "application/json", "x-cron-secret": "<REDACTED_UNUSED_DUPLICATE_SEE_MIGRATION_20260806121118>"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
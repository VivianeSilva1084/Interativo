-- Turns out process-funnel-sequence already had a working cron job
-- ("process-funnel-sequence-every-10min", jobid 2) with the correct
-- CRON_SECRET already configured - invisible to a local-codebase-only audit
-- since the schedule lives in pg_cron, not in any file. This migration's job
-- was an unnecessary duplicate using a different (wrong) secret value.
select cron.unschedule('process-funnel-sequence');
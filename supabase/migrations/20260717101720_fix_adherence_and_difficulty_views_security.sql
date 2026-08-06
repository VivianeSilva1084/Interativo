alter view public.v_adherence_summary set (security_invoker = on);
alter view public.v_weekly_adherence set (security_invoker = on);
alter view public.v_recommended_difficulty set (security_invoker = on);
select 'ok' as status;
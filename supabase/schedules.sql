-- OPT-IN DEPLOYMENT STEP. This is not a migration and is never run by the app.
-- Run manually in the intended Supabase project's SQL Editor after deployment.
-- Do not enable this if Vercel or another service already invokes /api/jobs.
--
-- Prerequisites, configured in the Supabase Dashboard:
--   1. Enable the pg_cron and pg_net extensions, plus Vault.
--   2. Create Vault secret lumen_crm_url with the HTTPS CRM origin (no path).
--   3. Create Vault secret lumen_cron_secret with the exact Vercel CRON_SECRET.
--      Generate at least 32 random bytes; never place the value in source or chat.
--   4. Apply all migrations and configure the Vercel environment in syd1.
--
-- Verified official references, 4 November 2026:
-- https://supabase.com/docs/guides/functions/schedule-functions
-- https://supabase.com/docs/guides/database/extensions/pg_net
-- https://supabase.com/docs/guides/cron/quickstart
-- pg_net is beta; verify the deployed extension supports timeout_milliseconds.
-- Its request queue temporarily holds decrypted headers. Keep net out of the
-- exposed Data API schemas and restrict database LOGIN roles / dashboard access.

begin;

do $checks$
declare crm_origin text; secret_length integer; secret_count integer;
begin
  if not exists(select 1 from pg_extension where extname='pg_cron')
     or not exists(select 1 from pg_extension where extname='pg_net') then
    raise exception 'Enable pg_cron and pg_net in Supabase before running schedules.sql';
  end if;
  if to_regclass('vault.decrypted_secrets') is null then
    raise exception 'Enable Supabase Vault and add the two named secrets first';
  end if;
  select count(*), max(decrypted_secret) into secret_count,crm_origin
    from vault.decrypted_secrets where name='lumen_crm_url';
  if secret_count<>1 or crm_origin !~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?/?$' then
    raise exception 'Set lumen_crm_url to one HTTPS origin without a path, query or credentials';
  end if;
  select count(*), max(length(decrypted_secret)) into secret_count,secret_length
    from vault.decrypted_secrets where name='lumen_cron_secret';
  if secret_count<>1 or coalesce(secret_length,0)<32 or exists(
    select 1 from vault.decrypted_secrets where name='lumen_cron_secret' and decrypted_secret ~ '[[:space:]]'
  ) then
    raise exception 'Set lumen_cron_secret to a strong token matching Vercel CRON_SECRET';
  end if;
end
$checks$;

-- A named schedule is updated on rerun, not duplicated. The command stores only
-- Vault lookups; token rotation in Vault takes effect at the next invocation.
select cron.schedule(
  'lumen-crm-five-minute-jobs',
  '*/5 * * * *',
  $job$
  select net.http_post(
    url := rtrim((select decrypted_secret from vault.decrypted_secrets where name='lumen_crm_url'), '/') || '/api/jobs',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='lumen_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $job$
);

commit;

-- Verify the schedule without printing the HTTP headers or Vault values.
select jobid,jobname,schedule,active from cron.job where jobname='lumen-crm-five-minute-jobs';

-- After the first tick, inspect status only. HTTP 200 means all scheduled work
-- completed or was safely skipped; 503 means inspect the CRM integration health.
-- select id,status_code,timed_out,created from net._http_response order by created desc limit 20;
-- select status,start_time,end_time from cron.job_run_details
--   where jobid=(select jobid from cron.job where jobname='lumen-crm-five-minute-jobs')
--   order by start_time desc limit 20;

-- To stop this scheduler, run deliberately in the same project:
-- select cron.unschedule('lumen-crm-five-minute-jobs');
-- The worker itself handles Adelaide DST, call hours, holidays, daily/weekly
-- deduplication, leases and retries. No client message is sent automatically.

/*
  # Timeout amplio en el cron del sync de Holded

  pg_net corta por defecto a los 5s; el sync completo de Holded tarda más.
  Reprograma el job con timeout_milliseconds := 120000 para que pg_net espere
  a que la edge function termine.
*/

SELECT cron.schedule(
  'holded-sync-daily',
  '0 5 * * *',
  $$
    SELECT net.http_post(
      url := 'https://wfbdxxpegggmbvfoteml.supabase.co/functions/v1/holded-sync',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $$
);

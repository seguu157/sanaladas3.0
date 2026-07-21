/*
  # Cron diario del sync de Holded

  Programa la edge function `holded-sync` para que se ejecute a diario y
  refresque `holded_products` y `holded_contacts` desde la API de Holded.

  Requisitos (los pone el usuario, NO van en el repo):
  - Secreto `HOLDED_API_KEY` en Edge Functions (obligatorio).
  - Secreto `SYNC_SECRET` (opcional). Si se define, añade el header
    x-sync-secret al net.http_post de abajo.
*/

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'holded-sync-daily',
  '0 5 * * *',   -- 05:00 UTC ~ 07:00 España
  $$
    SELECT net.http_post(
      url := 'https://wfbdxxpegggmbvfoteml.supabase.co/functions/v1/holded-sync',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := '{}'::jsonb
    );
  $$
);

/*
  # Habilitar Realtime para pending_pdfs

  El stepper del dashboard se suscribe a UPDATEs de `pending_pdfs` filtrados
  por id, para mostrar en tiempo real los checkpoints que escribe n8n
  (`received_by_llamaindex`, `creating_order`, `completed`).

  Sin esto, los UPDATEs ocurren en BD pero el frontend no recibe eventos y
  el stepper se queda colgado en "Extraer datos con IA" hasta que llega la
  respuesta síncrona del webhook.
*/

-- Añade pending_pdfs a la publicación supabase_realtime si aún no está.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'pending_pdfs'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.pending_pdfs';
  END IF;
END
$$;

-- REPLICA IDENTITY FULL para que el payload del UPDATE incluya todas las
-- columnas (no solo PK), así el frontend ve `status` y `error_message` en
-- payload.new sin tener que hacer un fetch extra.
ALTER TABLE public.pending_pdfs REPLICA IDENTITY FULL;

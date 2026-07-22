/*
  # Generador de presupuestos con IA

  Añade el soporte para el generador conversacional de presupuestos:

  1. `budget_proposals`          — un presupuesto en elaboración. Guarda el brief
     estructurado del evento, el borrador vivo (líneas + extras + totales) y, una
     vez exportado, el id del documento creado en Holded. Se pueden tener varios
     en marcha a la vez (cada uno con su propia conversación).
  2. `budget_proposal_messages`  — la conversación de cada presupuesto (chat con
     la IA). Cada mensaje de la IA guarda además el snapshot del borrador para
     poder volver a versiones anteriores.

  Son datos internos del equipo (no por usuario final): cualquier usuario
  autenticado puede leer/escribir, igual que budget_knowledge.

  Además, restaura los ratios base por persona en budget_knowledge (se perdieron
  en producción). Son un punto de partida EDITABLE; el usuario los ajusta a mano.
*/

-- =========================================================================
-- 1. PRESUPUESTOS (cabecera + brief + borrador vivo)
-- =========================================================================
CREATE TABLE IF NOT EXISTS budget_proposals (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title              text NOT NULL DEFAULT 'Nuevo presupuesto',
  status             text NOT NULL DEFAULT 'draft',   -- draft | ready | exported
  client_name        text,
  client_email       text,
  holded_contact_id  text,                            -- si se casa con un contacto de Holded
  brief              jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {event_type, pax, date, diets, budget, zone, transport, notes}
  draft              jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {items:[{sku,name,units,price,tax,diet,note}], extras:[], notes, totals}
  holded_document_id text,
  holded_document_url text,
  created_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_budget_proposals_status     ON budget_proposals (status);
CREATE INDEX IF NOT EXISTS idx_budget_proposals_created_at ON budget_proposals (created_at DESC);

ALTER TABLE budget_proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuarios autenticados leen presupuestos"
  ON budget_proposals FOR SELECT TO authenticated USING (true);
CREATE POLICY "Usuarios autenticados crean presupuestos"
  ON budget_proposals FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Usuarios autenticados editan presupuestos"
  ON budget_proposals FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Usuarios autenticados borran presupuestos"
  ON budget_proposals FOR DELETE TO authenticated USING (true);

-- =========================================================================
-- 2. MENSAJES DE LA CONVERSACIÓN
-- =========================================================================
CREATE TABLE IF NOT EXISTS budget_proposal_messages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id  uuid NOT NULL REFERENCES budget_proposals(id) ON DELETE CASCADE,
  role         text NOT NULL,             -- user | assistant
  content      text NOT NULL DEFAULT '',
  draft        jsonb,                      -- snapshot del borrador tras este turno (solo assistant)
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_budget_msgs_proposal ON budget_proposal_messages (proposal_id, created_at);

ALTER TABLE budget_proposal_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuarios autenticados leen mensajes"
  ON budget_proposal_messages FOR SELECT TO authenticated USING (true);
CREATE POLICY "Usuarios autenticados crean mensajes"
  ON budget_proposal_messages FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Usuarios autenticados borran mensajes"
  ON budget_proposal_messages FOR DELETE TO authenticated USING (true);

-- Trigger updated_at (reutiliza la función existente si está creada)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
    CREATE TRIGGER trg_budget_proposals_updated_at
      BEFORE UPDATE ON budget_proposals
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- =========================================================================
-- 3. RESTAURAR RATIOS BASE (editables) en budget_knowledge
--    Punto de partida cuantificado; el usuario los ajusta a mano.
-- =========================================================================
INSERT INTO budget_knowledge (type, title, product_name, category, units_per_person, recommended, content, sort_order, tags, active)
SELECT v.type, v.title, v.product_name, v.category, v.units_per_person, v.recommended, v.content, v.sort_order, v.tags, true
FROM (VALUES
  ('ratio','Platos 15cm','Platos 15cm','Material',1.00::numeric,true,'Material base: ~1 plato por persona.',1,ARRAY['ratio','material']),
  ('ratio','Servilletas con logo','Servilletas logo','Material',1.40,true,'~1,4 servilletas por persona.',2,ARRAY['ratio','material']),
  ('ratio','Tenedores','Tenedores','Material',1.00,true,'Cubierto base cuando hay comida que lo requiere.',3,ARRAY['ratio','material']),
  ('ratio','Cuchillos','Cuchillos','Material',1.00,false,'Añadir si el menú lo requiere.',4,ARRAY['ratio','material']),
  ('ratio','Croquetas de cocido','Croquetas de cocido','Croquetas',1.00,true,'Best-seller: ~1 croqueta por persona.',5,ARRAY['ratio','croquetas']),
  ('ratio','Croquetas de setas','Croquetas de setas','Croquetas',1.00,true,'~1 croqueta por persona.',6,ARRAY['ratio','croquetas']),
  ('ratio','Mini hamburguesitas','Mini hamburguesitas','Varios',1.00,true,'~1 por persona.',7,ARRAY['ratio']),
  ('ratio','Agua 33cl','Agua (33cl)','Bebidas',1.00,true,'~1 botella de agua por persona.',8,ARRAY['ratio','bebida']),
  ('ratio','Coca-Cola Zero','Coca-Cola Zero','Bebidas',0.60,true,'~0,6 por persona (repartir con Normal).',9,ARRAY['ratio','bebida']),
  ('ratio','Coca-Cola Normal','Coca-Cola Normal','Bebidas',0.40,false,'~0,4 por persona.',10,ARRAY['ratio','bebida']),
  ('ratio','Wrap de pollo y brie','Wrap de pollo y brie pequeño','Wraps',0.42,true,'Wraps: ~0,4 de cada variante (total ~1,2-1,5/persona).',11,ARRAY['ratio','wraps']),
  ('ratio','Wrap vegetal','Wrap vegetal pequeño','Wraps',0.42,true,'Variante vegetariana de wrap.',12,ARRAY['ratio','wraps']),
  ('ratio','Vasos café con leche','Vasos café con leche','Material',0.90,true,'Eventos con café: ~0,9 por persona.',13,ARRAY['ratio','material','coffee_break']),
  ('regla_extra','Envío','Envío','Servicio',NULL,true,'Añadir envío a todos los pedidos con entrega.',20,ARRAY['extra','envio'])
) AS v(type,title,product_name,category,units_per_person,recommended,content,sort_order,tags)
WHERE NOT EXISTS (
  SELECT 1 FROM budget_knowledge bk WHERE bk.title = v.title AND bk.type = v.type
);

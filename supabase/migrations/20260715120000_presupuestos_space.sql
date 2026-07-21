/*
  # Espacio de Presupuestos

  Tres tablas nuevas que dan soporte al módulo de elaboración de presupuestos:

  1. `holded_products`  — catálogo de productos, sincronizado a diario desde
     Holded vía API (solo lectura para la app; escribe el sync con service_role).
  2. `holded_contacts`  — clientes/contactos, sincronizado a diario desde Holded.
  3. `budget_knowledge` — base de conocimiento EDITABLE (ratios por persona,
     packs por tipo de evento, reglas de extras, notas). La app hace CRUD.

  Notas:
  - Son tablas de referencia compartidas por toda la organización (no por
    usuario), así que las políticas permiten a cualquier usuario autenticado
    leerlas. Solo `budget_knowledge` admite escritura desde la app.
  - `raw jsonb` guarda el objeto completo de Holded por si luego necesitamos
    campos que hoy no mapeamos.
*/

-- =========================================================================
-- 1. PRODUCTOS (sync Holded)
-- =========================================================================
CREATE TABLE IF NOT EXISTS holded_products (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holded_id     text UNIQUE NOT NULL,
  sku           text,
  name          text NOT NULL DEFAULT '',
  description   text,
  price         numeric(12,2) DEFAULT 0,
  tax           numeric(6,2)  DEFAULT 0,
  cost          numeric(12,2) DEFAULT 0,
  category      text,
  kind          text,
  barcode       text,
  stock         numeric(12,2),
  raw           jsonb,
  synced_at     timestamptz DEFAULT now(),
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_holded_products_name     ON holded_products (name);
CREATE INDEX IF NOT EXISTS idx_holded_products_category ON holded_products (category);
CREATE INDEX IF NOT EXISTS idx_holded_products_sku      ON holded_products (sku);

ALTER TABLE holded_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuarios autenticados pueden leer productos"
  ON holded_products FOR SELECT TO authenticated USING (true);

-- =========================================================================
-- 2. CLIENTES / CONTACTOS (sync Holded)
-- =========================================================================
CREATE TABLE IF NOT EXISTS holded_contacts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holded_id     text UNIQUE NOT NULL,
  name          text NOT NULL DEFAULT '',
  code          text,          -- NIF / CIF
  email         text,
  phone         text,
  type          text,          -- client / supplier / lead / debtor / creditor
  is_person     boolean,
  billing_address text,
  city          text,
  province      text,
  postal_code   text,
  country       text,
  raw           jsonb,
  synced_at     timestamptz DEFAULT now(),
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_holded_contacts_name  ON holded_contacts (name);
CREATE INDEX IF NOT EXISTS idx_holded_contacts_email ON holded_contacts (email);

ALTER TABLE holded_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuarios autenticados pueden leer contactos"
  ON holded_contacts FOR SELECT TO authenticated USING (true);

-- =========================================================================
-- 3. CONOCIMIENTO (editable por la app)
-- =========================================================================
-- Tabla flexible: un discriminador `type` distingue el tipo de conocimiento.
--   ratio        → uds por persona de un producto (auto-cálculo de cantidades)
--   pack         → plantilla de menú por tipo de evento
--   regla_extra  → regla de extras (camareros, barra, cubiertos, envío…)
--   nota         → texto libre / directriz
CREATE TABLE IF NOT EXISTS budget_knowledge (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type              text NOT NULL DEFAULT 'nota',
  event_type        text,             -- coffee_break, coctel, almuerzo, cena, desayuno… (null = general)
  title             text NOT NULL DEFAULT '',
  product_name      text,
  category          text,
  units_per_person  numeric(8,3),     -- para type = 'ratio'
  diet_tags         text[] DEFAULT '{}',  -- vegetariano, vegano, sin_lactosa, sin_gluten
  recommended       boolean DEFAULT false,
  content           text,             -- descripción / regla en texto editable
  data              jsonb DEFAULT '{}'::jsonb,  -- campos extra flexibles
  active            boolean DEFAULT true,
  sort_order        int DEFAULT 0,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_budget_knowledge_type       ON budget_knowledge (type);
CREATE INDEX IF NOT EXISTS idx_budget_knowledge_event_type ON budget_knowledge (event_type);

ALTER TABLE budget_knowledge ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuarios autenticados pueden leer conocimiento"
  ON budget_knowledge FOR SELECT TO authenticated USING (true);
CREATE POLICY "Usuarios autenticados pueden crear conocimiento"
  ON budget_knowledge FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Usuarios autenticados pueden editar conocimiento"
  ON budget_knowledge FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Usuarios autenticados pueden borrar conocimiento"
  ON budget_knowledge FOR DELETE TO authenticated USING (true);

-- Trigger updated_at (reutiliza la función existente si está creada)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
    CREATE TRIGGER trg_holded_products_updated_at   BEFORE UPDATE ON holded_products   FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    CREATE TRIGGER trg_holded_contacts_updated_at   BEFORE UPDATE ON holded_contacts   FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    CREATE TRIGGER trg_budget_knowledge_updated_at  BEFORE UPDATE ON budget_knowledge  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- =========================================================================
-- Semilla: ratios por persona derivados del histórico real de pedidos.
-- (Editables desde la app; son el punto de partida "buen hacer" cuantificado.)
-- =========================================================================
INSERT INTO budget_knowledge (type, title, product_name, category, units_per_person, recommended, content, sort_order)
VALUES
  ('ratio', 'Platos 15cm',            'Platos 15cm',            'Material',   1.00, true,  'Material base: ~1 plato por persona.', 1),
  ('ratio', 'Servilletas con logo',   'Servilletas logo',       'Material',   1.40, true,  '~1,4 servilletas por persona.', 2),
  ('ratio', 'Tenedores',              'Tenedores',              'Material',   1.00, true,  'Cubierto base cuando hay comida que lo requiere.', 3),
  ('ratio', 'Cuchillos',              'Cuchillos',              'Material',   1.00, false, 'Añadir si el menú lo requiere.', 4),
  ('ratio', 'Croquetas de cocido',    'Croquetas de cocido',    'Croquetas',  1.00, true,  'Best-seller: ~1 croqueta por persona.', 5),
  ('ratio', 'Croquetas de setas',     'Croquetas de setas',     'Croquetas',  1.00, true,  '~1 croqueta por persona.', 6),
  ('ratio', 'Mini hamburguesitas',    'Mini hamburguesitas',    'Varios',     1.00, true,  '~1 por persona.', 7),
  ('ratio', 'Agua 33cl',              'Agua (33cl)',            'Bebidas',    1.00, true,  '~1 botella de agua por persona.', 8),
  ('ratio', 'Coca-Cola Zero',         'Coca-Cola Zero',         'Bebidas',    0.60, true,  '~0,6 por persona (repartir con Normal).', 9),
  ('ratio', 'Coca-Cola Normal',       'Coca-Cola Normal',       'Bebidas',    0.40, false, '~0,4 por persona.', 10),
  ('ratio', 'Wrap de pollo y brie',   'Wrap de pollo y brie pequeño', 'Wraps', 0.42, true,  'Wraps: ~0,4 de cada variante (total ~1,2-1,5/persona).', 11),
  ('ratio', 'Wrap vegetal',           'Wrap vegetal pequeño',   'Wraps',      0.42, true,  'Variante vegetariana de wrap.', 12),
  ('ratio', 'Vasos café con leche',   'Vasos café con leche',   'Material',   0.90, true,  'Eventos con café: ~0,9 por persona.', 13),
  ('regla_extra', 'Envío',            'Envío',                  'Servicio',   NULL, true,  'Añadir envío a todos los pedidos con entrega.', 20),
  ('nota', 'Variantes dietéticas',    NULL,                     NULL,         NULL, true,  'Por cada comensal vegetariano/sin lactosa/sin gluten, sustituir su ración por la variante correspondiente del pack (no sumar, sustituir).', 30)
ON CONFLICT DO NOTHING;

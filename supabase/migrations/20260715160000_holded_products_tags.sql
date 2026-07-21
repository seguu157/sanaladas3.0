/*
  # Etiquetas de producto de Holded

  Holded no usa categorías (categoryId viene vacío); clasifica los productos
  con `tags`, que incluyen tanto la categoría gastronómica (ensalada,
  croquetas, cremas…) como info dietética/alérgenos (vegetariana, singluten,
  sinlactosa, gluten, lactosa, pescado…). Muy útil para casar necesidades del
  cliente con el catálogo.

  Añade `tags text[]` a holded_products (con índice GIN) y hace backfill desde
  el `raw` ya sincronizado. El sync (edge function) mapea tags en adelante.
*/

ALTER TABLE holded_products ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_holded_products_tags ON holded_products USING gin (tags);

UPDATE holded_products
SET tags = COALESCE(
  (SELECT array_agg(t) FROM jsonb_array_elements_text(raw->'tags') t),
  '{}'
)
WHERE raw ? 'tags';

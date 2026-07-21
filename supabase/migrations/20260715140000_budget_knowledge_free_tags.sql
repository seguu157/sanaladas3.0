/*
  # Etiquetas libres en la base de conocimiento

  Añade `tags text[]` a `budget_knowledge` para que el usuario cree y asigne
  sus propias etiquetas a cada nota (modo libre). Se siembran etiquetas
  iniciales a partir de category/type de las filas existentes.
*/

ALTER TABLE budget_knowledge ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}';

UPDATE budget_knowledge
SET tags = (
  SELECT array_agg(DISTINCT t)
  FROM unnest(array[category, type]) AS t
  WHERE t IS NOT NULL AND t <> ''
)
WHERE (tags IS NULL OR tags = '{}');

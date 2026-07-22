/*
  # Nº de documento de Holded en los presupuestos

  Al exportar un presupuesto a Holded guardamos también su número de documento
  legible (p. ej. "E260702"), además del id interno, para poder mostrarlo en la
  app y localizarlo fácil en Holded (Ventas → Presupuestos).
*/

ALTER TABLE budget_proposals ADD COLUMN IF NOT EXISTS holded_doc_number text;

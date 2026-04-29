/*
  # Edición de comentarios de pedido (rich text)

  Añade `updated_at` a `order_comments`, un trigger que lo refresca al
  hacer UPDATE, y una política RLS que permite a cualquier usuario
  autenticado editar cualquier comentario (coherente con DELETE actual).

  El frontend ahora guarda en `text` HTML restringido (b/u/br) y en
  lectura lo sanea con DOMPurify. Para editores existentes en plano,
  el contenido sigue funcionando sin migración de datos.
*/

ALTER TABLE order_comments
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

CREATE OR REPLACE FUNCTION touch_order_comments_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS order_comments_touch_updated_at ON order_comments;
CREATE TRIGGER order_comments_touch_updated_at
  BEFORE UPDATE ON order_comments
  FOR EACH ROW
  EXECUTE FUNCTION touch_order_comments_updated_at();

DROP POLICY IF EXISTS "Authenticated users can update comments" ON order_comments;
CREATE POLICY "Authenticated users can update comments"
  ON order_comments
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

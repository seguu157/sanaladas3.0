# Rich text para comentarios de pedidos

**Fecha**: 2026-04-29
**Estado**: Aprobado, pendiente de implementación

## Problema

Los comentarios en cada pedido (`order_comments`) hoy son texto plano en `<textarea>`. El usuario necesita:

1. **Editar** comentarios ya creados (hoy solo se puede agregar/borrar).
2. **Negrita** en porciones de texto.
3. **Subrayado** en porciones de texto.
4. **Saltos de línea** con Enter.
5. El formato se debe **conservar** al guardar.

## Alcance

Negrita + subrayado + saltos de línea. Nada más (sin cursiva, listas, colores). Si en el futuro el alcance crece, migrar a TipTap.

## Decisiones clave

- **Storage**: HTML restringido en la columna `text` existente. Allowlist `<b>`, `<u>`, `<br>`. Comentarios antiguos en plano siguen renderizando bien.
- **Editor**: `<div contentEditable>` + `document.execCommand('bold' | 'underline')`. Sin librería de editor.
- **Sanitización**: DOMPurify obligatoria en lectura (defensa en profundidad). El render de HTML va aislado en un componente `SafeHtml` para que el resto del código nunca vea el prop crudo de React.
- **Permisos**: cualquier usuario autenticado puede editar cualquier comentario (coherente con el delete actual).

## Arquitectura

### Componente nuevo `SafeHtml` (helper)
Ubicación: `src/components/SafeHtml.tsx`. Único punto del código que toca el render de HTML directamente; recibe HTML, lo sanea con DOMPurify (allowlist `b`, `u`, `br`, sin atributos) y lo pinta. El resto del código solo importa `<SafeHtml html={...} />`.

### Componente nuevo `RichCommentEditor`
Ubicación: `src/components/RichCommentEditor.tsx`

Props:
```ts
{
  initialHtml?: string;
  placeholder?: string;
  onSubmit: (html: string) => void;
  onCancel: () => void;
  submitLabel?: string;
  autoFocus?: boolean;
}
```

Estructura:
- Toolbar con dos toggles: **B** y **U**, ambos con tooltips y atajos `Ctrl+B`/`Ctrl+U`.
- Área editable (`contentEditable=true`).
- Botones inferiores: `Guardar` (submitLabel) y `Cancelar`.
- Al montar, inserta `initialHtml` saneado.
- Al pulsar Guardar: `innerHTML` saneado → `onSubmit`. Si está vacío (sólo whitespace), el botón está desactivado.

Implementación:
- `useRef<HTMLDivElement>` para el editor.
- Toggles aplican `document.execCommand('bold' | 'underline')`. Sí, está marcado deprecated, pero todos los navegadores lo soportan y para 2 formatos no merece la pena meter un editor framework.
- Sanitización con `DOMPurify.sanitize(html, { ALLOWED_TAGS: ['b','u','br'], ALLOWED_ATTR: [] })`.

### Cambios en `Comments.tsx`
- Reemplazar `<textarea>` del bloque "Agregar" por `<RichCommentEditor onSubmit={...} />`.
- Cada comentario rendered:
  - Texto: `<SafeHtml html={comment.text} />` con clase `whitespace-pre-wrap` para respetar saltos de línea de comentarios viejos en plano.
  - Acciones: ✏️ Editar + 🗑️ Eliminar.
  - Si en estado "editing": swap a `<RichCommentEditor initialHtml={comment.text} onSubmit={handleUpdate(commentId)} onCancel={...} />`.
  - Si `updated_at > created_at`: badge `(editado)` junto al timestamp.

### Cambios en `App.tsx`
- Nuevo handler `handleUpdateComment(orderId, commentId, text)`:
  ```ts
  await supabase.from('order_comments').update({ text }).eq('id', commentId);
  ```
- Pasar `onUpdateComment={handleUpdateComment}` al `<Comments>`.

### Cambios en `types.ts`
```ts
export interface Comment {
  id: string;
  text: string;          // ahora puede contener <b>, <u>, <br>
  created_at: string;
  updated_at?: string;   // nuevo
  user_id: string;
}
```

## Backend (Supabase)

### Migración nueva
Archivo: `supabase/migrations/20260429130000_add_update_to_order_comments.sql`

```sql
-- updated_at + trigger
ALTER TABLE order_comments
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

CREATE OR REPLACE FUNCTION touch_order_comments_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS order_comments_touch_updated_at ON order_comments;
CREATE TRIGGER order_comments_touch_updated_at
  BEFORE UPDATE ON order_comments
  FOR EACH ROW EXECUTE FUNCTION touch_order_comments_updated_at();

-- RLS UPDATE: cualquier autenticado puede editar cualquiera
CREATE POLICY "Authenticated users can update comments"
  ON order_comments
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);
```

### Query del hook
`useOrders` ya hace `order_comments(id, text, created_at)`. Añadir `updated_at`:
```diff
- order_comments(id, text, created_at)
+ order_comments(id, text, created_at, updated_at)
```
Y mapear el nuevo campo en `formatTimestamp`.

## Dependencia nueva

```
npm install dompurify
npm install -D @types/dompurify
```

DOMPurify ~21KB gzipped.

## Compatibilidad hacia atrás

- Comentarios existentes (texto plano): sin cambios en BD. Al renderizar, DOMPurify pasa el texto tal cual. Saltos de línea originales (si los había escritos con `\n`) se respetan vía `whitespace-pre-wrap`.
- Comentarios futuros: HTML con `<b>`, `<u>`, `<br>`. La columna `text` los acepta sin migrar.

## Testing manual

1. Crear comentario nuevo con negrita + subrayado + Enter → verificar que se guarda y se ve igual al recargar.
2. Editar comentario existente: cambiar formato y guardar.
3. Verificar que comentario antiguo (sin formato) se sigue viendo bien.
4. Probar que `Ctrl+B` y `Ctrl+U` funcionan dentro del editor.
5. Intentar inyectar `<script>alert(1)</script>` en el HTML → debe quedar limpio (gracias al sanitizado).
6. Borrar comentario sigue funcionando.

## Lo que NO se cambia

- No tocamos políticas DELETE, INSERT, SELECT existentes.
- No cambiamos schema de la columna `text`.
- No tocamos otros componentes (DataVisualizer, AIConversational, etc.).

// Wrapper para detectar mutaciones de Supabase que se cuelgan silenciosamente
// (sin resolver ni rechazar) — síntoma típico del cliente JS de Supabase
// quedando en estado "zombie" tras la suspensión/throttle del navegador.
//
// Por defecto, si una mutación tarda más de `timeoutMs`, recargamos la página
// entera. Para la tablet de cocina, el reload es 100% fiable y mucho mejor UX
// que un click que parece no hacer nada.
//
// Pero para sesiones de admin que están introduciendo datos en formularios
// largos, un reload se carga todo lo escrito. App.tsx llama a
// `setHangGuardAutoReloadEnabled(false)` cuando el usuario es admin: en ese
// modo, el timeout sigue rechazando la promesa pero NO recarga la página, así
// el caller puede mostrar un error y el admin puede reintentar sin perder lo
// que estaba escribiendo.

const DEFAULT_TIMEOUT_MS = 10_000;

let autoReloadEnabled = true;

export function setHangGuardAutoReloadEnabled(enabled: boolean) {
  autoReloadEnabled = enabled;
}

export async function withHangGuard<T>(
  promise: PromiseLike<T>,
  label: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<T> {
  let timer: number | null = null;

  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => {
      if (autoReloadEnabled) {
        console.error(
          `🚨 [hangGuard] "${label}" colgado tras ${timeoutMs}ms — recargando página`
        );
        window.location.reload();
      } else {
        console.error(
          `🚨 [hangGuard] "${label}" colgado tras ${timeoutMs}ms — auto-reload desactivado (sesión admin), abortando promise`
        );
      }
      reject(new Error(`Hang detected in "${label}"`));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([Promise.resolve(promise), timeout]);
    if (timer !== null) window.clearTimeout(timer);
    (window as any).__lastDataActivityAt = Date.now();
    return result as T;
  } catch (err) {
    if (timer !== null) window.clearTimeout(timer);
    throw err;
  }
}

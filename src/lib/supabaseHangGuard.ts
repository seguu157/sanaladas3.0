// Wrapper para detectar mutaciones de Supabase que se cuelgan silenciosamente
// (sin resolver ni rechazar) — síntoma típico del cliente JS de Supabase
// quedando en estado "zombie" tras la suspensión/throttle del navegador.
//
// Si una mutación tarda más de `timeoutMs`, lanzamos la recuperación de la
// conexión en segundo plano y rechazamos la promesa para que el caller pueda
// mostrar un error y reintentar. NUNCA se recarga la página: un reload a mitad
// de edición destruye el trabajo del usuario.

import { recoverSupabaseConnection } from './supabaseRecovery';

const DEFAULT_TIMEOUT_MS = 10_000;

export async function withHangGuard<T>(
  promise: PromiseLike<T>,
  label: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<T> {
  let timer: number | null = null;

  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => {
      console.error(
        `🚨 [hangGuard] "${label}" colgado tras ${timeoutMs}ms — recuperando conexión (sin reload)`
      );
      // Recuperación en background; el caller decide si reintenta.
      recoverSupabaseConnection();
      reject(new Error(`Hang detected in "${label}"`));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([Promise.resolve(promise), timeout]);
    if (timer !== null) window.clearTimeout(timer);
    (window as any).__lastDataActivityAt = Date.now();
    return result;
  } catch (err) {
    if (timer !== null) window.clearTimeout(timer);
    throw err;
  }
}

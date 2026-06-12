// Recuperación centralizada del cliente de Supabase tras suspensión de la
// pestaña, y escrituras robustas con timeout + reintento.
//
// Filosofía: NUNCA recargar la página. Cuando el cliente queda "zombie"
// (websocket muerto, JWT caducado, fetch colgado) tras un wake del navegador,
// se recupera refrescando la sesión y reciclando el websocket de realtime.
// Los hooks de datos refetchean por su cuenta; las ediciones locales en curso
// están protegidas por los guards de isDirty en los componentes.

import { supabase } from './supabase';

// Evento global que los hooks de datos escuchan para forzar un refetch
// cuando el watchdog detecta que tras un wake no llegó actividad de datos.
export const FORCE_REFETCH_EVENT = 'sanaladas:force-refetch';

const withTimeout = <T,>(p: PromiseLike<T>, ms: number, label: string): Promise<T> =>
  Promise.race([
    Promise.resolve(p),
    new Promise<never>((_, reject) =>
      window.setTimeout(() => reject(new Error(`timeout(${ms}ms): ${label}`)), ms)
    ),
  ]);

let recovering: Promise<void> | null = null;

// Refresca el JWT y recicla el websocket. Idempotente: llamadas concurrentes
// comparten la misma promesa.
export const recoverSupabaseConnection = (): Promise<void> => {
  if (recovering) return recovering;

  recovering = (async () => {
    // getSession primero: lee la sesión en memoria sin forzar petición de
    // red. Solo llamamos a refreshSession si falta o caduca en <60s.
    // refreshSession incondicional retenía el lock interno de auth cuando la
    // red iba lenta y bloqueaba TODAS las peticiones REST en cascada.
    try {
      const { data } = await withTimeout(supabase.auth.getSession(), 5_000, 'getSession');
      const expiresAtMs = (data.session?.expires_at ?? 0) * 1000;
      const needsRefresh = !data.session || expiresAtMs - Date.now() < 60_000;

      if (needsRefresh) {
        await withTimeout(supabase.auth.refreshSession(), 8_000, 'refreshSession');
      } else {
        console.log('✅ [recovery] sesión vigente — sin refresh');
      }
    } catch (e) {
      console.warn('⚠️ [recovery] comprobación/refresh de sesión falló:', e);
    }

    try {
      const realtime: any = (supabase as any).realtime;
      if (typeof realtime?.disconnect === 'function') realtime.disconnect();
      if (typeof realtime?.connect === 'function') realtime.connect();
      console.log('✅ [recovery] websocket de realtime reciclado');
    } catch (e) {
      console.warn('⚠️ [recovery] reset de realtime falló:', e);
    }
  })().finally(() => {
    recovering = null;
  });

  return recovering;
};

// Ejecuta una escritura de Supabase con timeout. Si falla o expira, recupera
// la conexión y reintenta UNA vez. `makeQuery` es una factory porque los
// builders de supabase-js son thenables de un solo uso.
export async function robustWrite<T>(
  makeQuery: () => PromiseLike<T>,
  label: string,
  timeoutMs: number = 10_000
): Promise<T> {
  try {
    const result = await withTimeout(makeQuery(), timeoutMs, label);
    (window as any).__lastDataActivityAt = Date.now();
    return result;
  } catch (firstError) {
    console.warn(`⚠️ [robustWrite] "${label}" falló, recuperando conexión y reintentando…`, firstError);
    await recoverSupabaseConnection();
    const result = await withTimeout(makeQuery(), timeoutMs, `${label} (retry)`);
    (window as any).__lastDataActivityAt = Date.now();
    return result;
  }
}

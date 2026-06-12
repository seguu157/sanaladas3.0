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

// Umbral compartido para los refetch al volver a la pestaña. Con 3s, cada
// alt-tab provocaba una estampida: 8+ componentes refetcheando TODO a la vez
// (290 pedidos x2, conversaciones, logs, categorías…), saturando el ancho de
// banda >10s y haciendo expirar los guardados del usuario. Las ausencias
// cortas las cubre Realtime; solo recargamos tras ausencias largas.
export const WAKE_REFETCH_THRESHOLD_MS = 60_000;

const withTimeout = <T,>(p: PromiseLike<T>, ms: number, label: string): Promise<T> =>
  Promise.race([
    Promise.resolve(p),
    new Promise<never>((_, reject) =>
      window.setTimeout(() => reject(new Error(`timeout(${ms}ms): ${label}`)), ms)
    ),
  ]);

// Margen amplio: refrescamos cuando quedan <10 min de vida al token. Así el
// refresh ocurre SIEMPRE en momentos controlados y en primer plano, nunca en
// el último segundo ni en background. (El auto-refresh de GoTrue está
// desactivado en supabase.ts; ver el comentario allí.)
const REFRESH_IF_EXPIRES_WITHIN_MS = 10 * 60 * 1000;
const KEEPALIVE_INTERVAL_MS = 5 * 60 * 1000;

let refreshing: Promise<void> | null = null;

// Comprueba la sesión en memoria y refresca el token solo si caduca pronto.
// Idempotente y con timeouts: nunca puede colgar la app.
export const ensureFreshSession = (): Promise<void> => {
  if (refreshing) return refreshing;

  refreshing = (async () => {
    try {
      const { data } = await withTimeout(supabase.auth.getSession(), 5_000, 'getSession');
      if (!data.session) return; // sin sesión (logout) — nada que refrescar

      const expiresAtMs = (data.session.expires_at ?? 0) * 1000;
      if (expiresAtMs - Date.now() > REFRESH_IF_EXPIRES_WITHIN_MS) {
        return; // token con vida de sobra
      }

      console.log('🔑 [session] token cerca de caducar — refrescando en primer plano');
      await withTimeout(supabase.auth.refreshSession(), 8_000, 'refreshSession');
      console.log('✅ [session] token refrescado');
    } catch (e) {
      console.warn('⚠️ [session] comprobación/refresh falló:', e);
    }
  })().finally(() => {
    refreshing = null;
  });

  return refreshing;
};

// Keepalive de sesión: cada 5 min, SOLO con la pestaña visible, comprueba y
// refresca el token si va a caducar. Sustituye al auto-refresh de GoTrue sin
// sus problemas de throttling en background.
let keepaliveStarted = false;
export const startSessionKeepalive = () => {
  if (keepaliveStarted) return;
  keepaliveStarted = true;
  window.setInterval(() => {
    if (!document.hidden) {
      ensureFreshSession();
    }
  }, KEEPALIVE_INTERVAL_MS);
};

let recovering: Promise<void> | null = null;

// Refresca el JWT y recicla el websocket. Idempotente: llamadas concurrentes
// comparten la misma promesa.
export const recoverSupabaseConnection = (): Promise<void> => {
  if (recovering) return recovering;

  recovering = (async () => {
    await ensureFreshSession();

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

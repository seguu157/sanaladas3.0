import { useCallback, useRef } from 'react';
import { usePageVisibility } from './usePageVisibility';
import { recoverSupabaseConnection, FORCE_REFETCH_EVENT } from '../lib/supabaseRecovery';

// 30s: para ausencias cortas el websocket sigue vivo y reciclarlo solo
// provoca resuscripciones en cadena. El watchdog cubre el caso raro de un
// socket muerto tras ausencias intermedias.
const SOFT_RESET_THRESHOLD_MS = 30_000;
const WATCHDOG_TIMEOUT_MS = 8_000;

// Estrategia al volver de una ausencia (para TODOS los roles):
//
//   < 3s:   nada (wake muy breve, foco devolviéndose).
//   >= 3s:  soft reset — refresca la sesión + recicla el websocket de
//           Supabase Realtime. Cada hook de datos refetchea por su cuenta
//           (en su propio usePageVisibility) sobre el websocket fresco.
//
// NUNCA se recarga la página: un reload destruye formularios a medio
// escribir. Si tras el soft reset los datos no llegan (watchdog), se
// recupera la conexión otra vez y se emite FORCE_REFETCH_EVENT para que
// los hooks de datos vuelvan a cargar.
export const useGlobalRealtimeReset = () => {
  const watchdogRef = useRef<number | null>(null);

  const cancelWatchdog = () => {
    if (watchdogRef.current !== null) {
      window.clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  };

  usePageVisibility({
    onVisible: useCallback(async (timeHidden: number) => {
      if (timeHidden < SOFT_RESET_THRESHOLD_MS) return;

      console.log(
        `🌐 [global] Soft reset tras ${Math.round(timeHidden / 1000)}s ausente`
      );

      const wakeStartedAt = Date.now();
      (window as any).__lastWakeStartedAt = wakeStartedAt;

      await recoverSupabaseConnection();

      // Watchdog: si tras WATCHDOG_TIMEOUT_MS no hemos visto actividad de
      // datos posterior a este wake (flag __lastDataActivityAt que mantienen
      // los hooks al recibir filas), recuperamos otra vez y pedimos refetch
      // explícito a los hooks. Sin reload.
      cancelWatchdog();
      watchdogRef.current = window.setTimeout(async () => {
        watchdogRef.current = null;
        const lastActivity = (window as any).__lastDataActivityAt || 0;
        if (lastActivity < wakeStartedAt) {
          console.warn(
            '🚨 [global] Watchdog: sin actividad de datos tras el wake — segunda recuperación + refetch forzado'
          );
          await recoverSupabaseConnection();
          window.dispatchEvent(new CustomEvent(FORCE_REFETCH_EVENT));
        } else {
          console.log('✅ [global] Watchdog OK — actividad de datos detectada');
        }
      }, WATCHDOG_TIMEOUT_MS);
    }, [])
  });
};

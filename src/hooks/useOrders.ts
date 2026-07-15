import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { Order, ExtractedData } from '../types';
import { usePageVisibility } from './usePageVisibility';
import { recoverSupabaseConnection, FORCE_REFETCH_EVENT, WAKE_REFETCH_THRESHOLD_MS } from '../lib/supabaseRecovery';

const LOAD_TIMEOUT_MS = 15_000;
const LOAD_RETRIES = 2;

// Convierte una fila de la tabla orders al modelo Order. Para eventos de
// realtime (que no traen el join de order_comments) se conservan los
// comentarios ya conocidos pasándolos como fallback.
const formatOrderRow = (order: any, fallbackComments: Order['comments'] = []): Order => ({
  id: order.id,
  fileName: order.file_name,
  uploadDate: new Date(order.upload_date || order.created_at),
  pdfFilePath: order.pdf_file_path,
  pdfFileSize: order.pdf_file_size,
  pdfOriginalName: order.pdf_original_name,
  orderName: order.order_name,
  orderColor: order.order_color,
  orderColors: order.order_colors || (order.order_color ? [order.order_color] : undefined),
  updatedAt: order.updated_at,
  data: order.extracted_data as ExtractedData,
  completionStatus: order.completion_status || {
    tableware: 0,
    products: 0,
    totalTableware: 0,
    totalProducts: 0
  },
  comments: order.order_comments
    ? order.order_comments.map((comment: any) => ({
        id: comment.id,
        text: comment.text,
        timestamp: new Date(comment.created_at),
        // updatedAt vendrá del Realtime UPDATE cuando la migración esté aplicada;
        // si la columna aún no existe, simplemente queda undefined.
        updatedAt: comment.updated_at ? new Date(comment.updated_at) : undefined,
      }))
    : fallbackComments
});

export const useOrders = (userId: string | undefined) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<any>(null);
  const mountedRef = useRef<boolean>(true);
  // Sufijo incremental para el nombre del canal: evita colisiones cuando se
  // resuscribe rápido (el cliente de Supabase dedupe canales por nombre y la
  // limpieza del canal viejo puede ser asíncrona).
  const channelSeqRef = useRef(0);
  // Coalescencia: una sola carga en vuelo; si llegan más peticiones mientras
  // tanto, se agrupan en UNA recarga extra al terminar.
  const loadInFlightRef = useRef(false);
  const loadQueuedRef = useRef(false);
  const refreshDebounceRef = useRef<number | null>(null);

  const fetchOrdersOnce = useCallback(async () => {
    return supabase
      .from('orders')
      .select(`
        id,
        file_name,
        upload_date,
        created_at,
        extracted_data,
        completion_status,
        pdf_file_path,
        pdf_file_size,
        pdf_original_name,
        order_name,
        order_color,
        order_colors,
        updated_at,
        order_comments(id, text, created_at, updated_at)
      `)
      .order('created_at', { ascending: false })
      .limit(1000)
      .abortSignal(AbortSignal.timeout(LOAD_TIMEOUT_MS));
  }, []);

  const loadOrders = useCallback(async (showLoading = true) => {
    if (!userId || !mountedRef.current) {
      setLoading(false);
      return;
    }

    // Si ya hay una carga en vuelo, marca que hace falta otra al acabar y
    // sal: con 290 pedidos, encolar N refetches paralelos satura la conexión.
    if (loadInFlightRef.current) {
      loadQueuedRef.current = true;
      return;
    }
    loadInFlightRef.current = true;

    try {
      if (showLoading) {
        setLoading(true);
      }
      console.log('📦 Loading orders...');

      // Reintentos: si el primer fetch falla o expira (cliente zombie tras un
      // wake), recuperamos la conexión y volvemos a intentar.
      let ordersData: any = null;
      let lastError: any = null;
      for (let attempt = 0; attempt <= LOAD_RETRIES; attempt++) {
        if (attempt > 0) {
          console.warn(`🔁 Retry ${attempt}/${LOAD_RETRIES} loading orders…`);
          await recoverSupabaseConnection();
        }
        try {
          const { data, error: fetchError } = await fetchOrdersOnce();
          if (fetchError) throw fetchError;
          ordersData = data;
          lastError = null;
          break;
        } catch (e) {
          lastError = e;
        }
        if (!mountedRef.current) return;
      }
      if (lastError) throw lastError;

      if (!mountedRef.current) {
        console.log('⚠️ Component unmounted, aborting order load');
        return;
      }

      console.log(`✅ Loaded ${ordersData?.length || 0} orders`);
      (window as any).__lastDataActivityAt = Date.now();

      const formattedOrders: Order[] = (ordersData || []).map((order: any) =>
        formatOrderRow(order)
      );

      // Merge monotónico: si en memoria tenemos una versión MÁS NUEVA de un
      // pedido (una edición recién guardada que esta query aún no veía por
      // visibilidad/replica lag), la conservamos en vez de revertirla con la
      // fila vieja del refetch. Cuando la BD se ponga al día, el siguiente
      // fetch traerá updated_at >= y se aplicará con normalidad.
      setOrders(prev => {
        if (prev.length === 0) return formattedOrders;
        const prevById = new Map(prev.map(o => [o.id, o]));
        return formattedOrders.map(fresh => {
          const old = prevById.get(fresh.id);
          if (
            old?.updatedAt && fresh.updatedAt &&
            new Date(old.updatedAt).getTime() > new Date(fresh.updatedAt).getTime()
          ) {
            return old;
          }
          return fresh;
        });
      });
      setError(null);
    } catch (err: any) {
      console.error('❌ Error loading orders:', err);
      if (mountedRef.current) {
        setError(err.message || 'Error al cargar los pedidos');
      }
    } finally {
      loadInFlightRef.current = false;
      if (mountedRef.current) {
        setLoading(false);
        if (loadQueuedRef.current) {
          loadQueuedRef.current = false;
          // Recarga única para recoger los eventos llegados durante la carga.
          loadOrders(false);
        }
      }
    }
  }, [userId, fetchOrdersOnce]);

  // Debounce de los refetch disparados por realtime: una ráfaga de UPDATEs
  // (p.ej. otro cliente guardando en bucle) colapsa en UNA recarga.
  const scheduleRealtimeRefresh = useCallback(() => {
    if (!mountedRef.current) return;
    if (refreshDebounceRef.current !== null) {
      window.clearTimeout(refreshDebounceRef.current);
    }
    refreshDebounceRef.current = window.setTimeout(() => {
      refreshDebounceRef.current = null;
      console.log('🔄 Realtime triggered refresh (debounced)');
      loadOrders(false);
    }, 800);
  }, [loadOrders]);

  const setupRealtimeChannel = useCallback(() => {
    if (!userId || !mountedRef.current) return;

    // Eliminar el canal anterior antes de crear uno nuevo (evita dobles
    // suscripciones cuando setup se llama desde varios sitios).
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    channelSeqRef.current += 1;
    const channelName = `orders_and_comments_changes_${channelSeqRef.current}`;
    console.log(`📡 Setting up realtime channel for orders (${channelName})`);

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders'
        },
        (payload) => {
          if (!mountedRef.current) return;
          const row: any = payload.new;
          console.log('🔔 Orders realtime update:', payload.eventType, row?.id || (payload.old as any)?.id);

          // UPDATE trae la fila completa: parcheamos en memoria en vez de
          // refetchear los ~300 pedidos. Crucial cuando otro cliente escribe
          // en ráfaga (cada refetch completo tarda segundos y satura la
          // conexión, colgando nuestros propios writes).
          if (payload.eventType === 'UPDATE' && row?.id) {
            (window as any).__lastDataActivityAt = Date.now();
            setOrders(prev =>
              prev.map(o => {
                if (o.id !== row.id) return o;
                // Guard monotónico: descarta echoes cuyo updated_at NO es más
                // nuevo que el que ya tenemos. Sin esto, un echo rezagado
                // (otra pestaña, la tablet, o una escritura en vuelo) puede
                // revertir una edición recién guardada — el síntoma de "la
                // cantidad cambia sola a otro valor".
                if (
                  o.updatedAt && row.updated_at &&
                  new Date(row.updated_at).getTime() <= new Date(o.updatedAt).getTime()
                ) {
                  console.log('⏭️ Ignorando echo de realtime más antiguo para', row.id);
                  return o;
                }
                return formatOrderRow(row, o.comments);
              })
            );
            return;
          }

          // INSERT/DELETE: recarga completa (debounced).
          scheduleRealtimeRefresh();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'order_comments'
        },
        (payload) => {
          if (!mountedRef.current) return;
          console.log('💬 Comments realtime update:', payload.eventType, (payload.new as any)?.id || (payload.old as any)?.id);
          scheduleRealtimeRefresh();
        }
      )
      .subscribe((status) => {
        console.log('📡 Orders & Comments channel status:', status);
        if (status === 'SUBSCRIBED') {
          (window as any).__lastDataActivityAt = Date.now();
        }
      });

    channelRef.current = channel;
  }, [userId, scheduleRealtimeRefresh]);

  useEffect(() => {
    mountedRef.current = true;

    if (!userId) {
      setLoading(false);
      return;
    }

    loadOrders();
    setupRealtimeChannel();

    // Refetch forzado solicitado por el watchdog global (sin reload).
    const handleForceRefetch = () => {
      if (!mountedRef.current) return;
      console.log('📢 Force refetch event received — reloading orders + channel');
      loadOrders(false);
      setupRealtimeChannel();
    };
    window.addEventListener(FORCE_REFETCH_EVENT, handleForceRefetch);

    return () => {
      console.log('🧹 Cleaning up orders hook');
      mountedRef.current = false;
      window.removeEventListener(FORCE_REFETCH_EVENT, handleForceRefetch);
      if (refreshDebounceRef.current !== null) {
        window.clearTimeout(refreshDebounceRef.current);
        refreshDebounceRef.current = null;
      }
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [userId, loadOrders, setupRealtimeChannel]);

  const deleteOrder = useCallback(async (orderId: string) => {
    const { error: deleteError } = await supabase
      .from('orders')
      .delete()
      .eq('id', orderId)
      .abortSignal(AbortSignal.timeout(LOAD_TIMEOUT_MS));

    if (deleteError) {
      throw deleteError;
    }

    if (mountedRef.current) {
      setOrders(prev => prev.filter(order => order.id !== orderId));
    }
  }, []);

  // Duplica un presupuesto: copia la fila de orders (con su extracted_data,
  // que ya lleva productos/vajilla) como un pedido nuevo. El progreso y los
  // comentarios empiezan de cero — lo esperable para una copia editable.
  const duplicateOrder = useCallback(async (orderId: string): Promise<string | null> => {
    const { data: original, error: fetchError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (fetchError || !original) {
      throw fetchError || new Error('No se encontró el pedido a duplicar');
    }

    // Quitar columnas que debe regenerar la BD, y marcar la copia.
    const {
      id: _id,
      created_at: _createdAt,
      updated_at: _updatedAt,
      upload_date: _uploadDate,
      ...rest
    } = original as any;

    const copy = {
      ...rest,
      file_name: `${original.file_name} (copia)`,
      order_name: original.order_name ? `${original.order_name} (copia)` : null,
      // Progreso a cero; conservamos los totales para el % de completado.
      completion_status: {
        tableware: 0,
        products: 0,
        totalTableware: original.completion_status?.totalTableware ?? 0,
        totalProducts: original.completion_status?.totalProducts ?? 0,
      },
    };

    const { data: inserted, error: insertError } = await supabase
      .from('orders')
      .insert(copy)
      .select('id')
      .single();

    if (insertError) throw insertError;

    await loadOrders(false);
    return inserted?.id ?? null;
  }, [loadOrders]);

  usePageVisibility({
    onVisible: useCallback(async (timeHidden: number) => {
      if (!userId || !mountedRef.current) return;

      if (timeHidden > WAKE_REFETCH_THRESHOLD_MS) {
        console.log('🔄 Reconnecting orders realtime after being hidden...');

        // El reset global (useGlobalRealtimeReset) ya refresca sesión y
        // websocket; aquí solo refetcheamos datos y resuscribimos el canal.
        await loadOrders(false);
        if (!mountedRef.current) return;
        setupRealtimeChannel();

        console.log('✅ Orders realtime reconnected');
      }
    }, [userId, loadOrders, setupRealtimeChannel])
  });

  return {
    orders,
    loading,
    error,
    deleteOrder,
    duplicateOrder,
    refreshOrders: loadOrders
  };
};

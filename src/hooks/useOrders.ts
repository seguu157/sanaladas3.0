import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { Order, ExtractedData } from '../types';
import { usePageVisibility } from './usePageVisibility';
import { recoverSupabaseConnection, FORCE_REFETCH_EVENT } from '../lib/supabaseRecovery';

const LOAD_TIMEOUT_MS = 15_000;
const LOAD_RETRIES = 2;

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

      const formattedOrders: Order[] = (ordersData || []).map((order: any) => ({
        id: order.id,
        fileName: order.file_name,
        uploadDate: new Date(order.upload_date || order.created_at),
        pdfFilePath: order.pdf_file_path,
        pdfFileSize: order.pdf_file_size,
        pdfOriginalName: order.pdf_original_name,
        orderName: order.order_name,
        orderColor: order.order_color,
        orderColors: order.order_colors || (order.order_color ? [order.order_color] : undefined),
        data: order.extracted_data as ExtractedData,
        completionStatus: order.completion_status || {
          tableware: 0,
          products: 0,
          totalTableware: 0,
          totalProducts: 0
        },
        comments: (order.order_comments || []).map((comment: any) => ({
          id: comment.id,
          text: comment.text,
          timestamp: new Date(comment.created_at),
          // updatedAt vendrá del Realtime UPDATE cuando la migración esté aplicada;
          // si la columna aún no existe, simplemente queda undefined.
          updatedAt: comment.updated_at ? new Date(comment.updated_at) : undefined,
        }))
      }));

      setOrders(formattedOrders);
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
          console.log('🔔 Orders realtime update:', payload.eventType, (payload.new as any)?.id || (payload.old as any)?.id);
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

  usePageVisibility({
    onVisible: useCallback(async (timeHidden: number) => {
      if (!userId || !mountedRef.current) return;

      if (timeHidden > 3000) {
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
    refreshOrders: loadOrders
  };
};

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Timeout duro para TODA petición HTTP del cliente de Supabase (PostgREST,
// auth y storage). Crítico para el endpoint /token de GoTrue: su POST de
// refresh no lleva timeout propio y, si la conexión quedó zombie tras un
// wake de pestaña, se colgaba indefinidamente RETENIENDO la cola interna de
// auth. Como cada petición REST llama a getSession() antes de salir (para
// adjuntar el Authorization), una sola petición /token colgada paralizaba
// TODOS los guardados y cargas de la app. Con este límite, el cuelgue dura
// como máximo GLOBAL_FETCH_TIMEOUT_MS y la app se auto-recupera (los retries
// de robustWrite/loadOrders abren conexión fresca).
const GLOBAL_FETCH_TIMEOUT_MS = 15_000;

const fetchWithTimeout: typeof fetch = (input, init = {}) => {
  const controller = new AbortController();
  const timer = window.setTimeout(() => {
    controller.abort(new DOMException(`global fetch timeout (${GLOBAL_FETCH_TIMEOUT_MS}ms)`, 'TimeoutError'));
  }, GLOBAL_FETCH_TIMEOUT_MS);

  // Encadenar la señal del caller (p.ej. AbortSignal.timeout de los queries):
  // aborta lo que ocurra primero.
  const callerSignal = init.signal;
  if (callerSignal) {
    if (callerSignal.aborted) {
      controller.abort(callerSignal.reason);
    } else {
      callerSignal.addEventListener('abort', () => controller.abort(callerSignal.reason), { once: true });
    }
  }

  return fetch(input, { ...init, signal: controller.signal }).finally(() => {
    window.clearTimeout(timer);
  });
};

const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      // Bypass del navigator.locks de GoTrue. Ese lock se comparte entre
      // TODAS las pestañas del sitio: si una pestaña suspendida se queda el
      // lock a mitad de un refresh de token, getSession() (y con él TODAS
      // las peticiones REST, que lo llaman internamente para adjuntar el
      // Authorization) se quedan en cola indefinidamente — los cuelgues de
      // >10s al cambiar de pestaña. GoTrue tolera refrescos concurrentes
      // (ventana de reuso del refresh token), así que ejecutamos directo.
      lock: async <R,>(_name: string, _acquireTimeout: number, fn: () => Promise<R>): Promise<R> => fn()
    },
    global: {
      fetch: fetchWithTimeout,
      headers: {
        'x-client-info': 'sanaladas-app'
      }
    },
    realtime: {
      params: {
        eventsPerSecond: 10
      }
    },
    db: {
      schema: 'public'
    }
  }
);

// Verificar si las credenciales están configuradas
const isSupabaseConfigured = supabaseUrl &&
  supabaseAnonKey &&
  supabaseUrl !== 'your-supabase-url' &&
  supabaseAnonKey !== 'your-supabase-anon-key' &&
  supabaseUrl.includes('supabase.co');

export { supabase, isSupabaseConfigured };

// Función para subir archivo PDF
export const uploadPDF = async (file: File, userId: string): Promise<{ path: string | null; error: string | null }> => {
  if (!isSupabaseConfigured || !supabase) {
    // En modo offline, simular subida exitosa
    return { 
      path: `offline/${userId}/${Date.now()}-${file.name}`, 
      error: null 
    };
  }

  try {
    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
    const filePath = `${userId}/${fileName}`;

    const { data, error } = await supabase.storage
      .from('order-pdfs')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false
      });

    if (error) {
      console.error('Error uploading file:', error);
      return { path: null, error: error.message };
    }

    return { path: data.path, error: null };
  } catch (error: any) {
    console.error('Error in uploadPDF:', error);
    return { path: null, error: error.message || 'Error subiendo archivo' };
  }
};

// Función para obtener URL de descarga del PDF
export const getPDFDownloadUrl = async (filePath: string): Promise<{ url: string | null; error: string | null }> => {
  if (!isSupabaseConfigured || !supabase) {
    // En modo offline, retornar URL simulada
    return { 
      url: '#', 
      error: null 
    };
  }

  try {
    const { data, error } = await supabase.storage
      .from('order-pdfs')
      .createSignedUrl(filePath, 3600); // URL válida por 1 hora

    if (error) {
      console.error('Error getting download URL:', error);
      return { url: null, error: error.message };
    }

    return { url: data.signedUrl, error: null };
  } catch (error: any) {
    console.error('Error in getPDFDownloadUrl:', error);
    return { url: null, error: error.message || 'Error obteniendo URL de descarga' };
  }
};

// Función para eliminar PDF
export const deletePDF = async (filePath: string): Promise<{ error: string | null }> => {
  if (!isSupabaseConfigured || !supabase) {
    // En modo offline, simular eliminación exitosa
    return { error: null };
  }

  try {
    const { error } = await supabase.storage
      .from('order-pdfs')
      .remove([filePath]);

    if (error) {
      console.error('Error deleting file:', error);
      return { error: error.message };
    }

    return { error: null };
  } catch (error: any) {
    console.error('Error in deletePDF:', error);
    return { error: error.message || 'Error eliminando archivo' };
  }
};

// Tipos para TypeScript
export interface Database {
  public: {
    Tables: {
      orders: {
        Row: {
          id: string;
          file_name: string;
          upload_date: string;
          event_date: string;
          client_company: string;
          client_contact: string;
          client_address: string;
          client_phone: string;
          number_of_attendees: number;
          sales_representative: string;
          extracted_data: any;
          completion_status: any;
          created_at: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          id?: string;
          file_name: string;
          upload_date?: string;
          event_date: string;
          client_company: string;
          client_contact: string;
          client_address: string;
          client_phone: string;
          number_of_attendees: number;
          sales_representative: string;
          extracted_data: any;
          completion_status?: any;
          pdf_file_path?: string | null;
          pdf_file_size?: number | null;
          pdf_original_name?: string | null;
          created_at?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          id?: string;
          file_name?: string;
          upload_date?: string;
          event_date?: string;
          client_company?: string;
          client_contact?: string;
          client_address?: string;
          client_phone?: string;
          number_of_attendees?: number;
          sales_representative?: string;
          extracted_data?: any;
          completion_status?: any;
          pdf_file_path?: string | null;
          pdf_file_size?: number | null;
          pdf_original_name?: string | null;
          created_at?: string;
          updated_at?: string;
          user_id?: string;
        };
      };
      user_profiles: {
        Row: {
          id: string;
          full_name: string | null;
          role: string | null;
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          full_name?: string | null;
          role?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          full_name?: string | null;
          role?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
    };
  };
}
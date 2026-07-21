import React from 'react';
import { supabase } from '../lib/supabase';
import {
  Package, Users, BookOpen, Search, Plus, Edit2, Trash2, Check, X,
  RefreshCw, Star,
} from 'lucide-react';

type SubTab = 'productos' | 'clientes' | 'conocimiento';

interface HoldedProduct {
  id: string; holded_id: string; sku: string | null; name: string;
  category: string | null; price: number | null; tax: number | null;
  synced_at: string | null;
}
interface HoldedContact {
  id: string; holded_id: string; name: string; email: string | null;
  phone: string | null; code: string | null; type: string | null;
  synced_at: string | null;
}
interface Knowledge {
  id: string; type: string; event_type: string | null; title: string;
  product_name: string | null; category: string | null;
  units_per_person: number | null; diet_tags: string[] | null;
  recommended: boolean; content: string | null; active: boolean;
  sort_order: number | null;
}

const KNOWLEDGE_TYPES = [
  { value: 'ratio', label: 'Ratio por persona' },
  { value: 'pack', label: 'Pack de evento' },
  { value: 'regla_extra', label: 'Regla de extra' },
  { value: 'nota', label: 'Nota / directriz' },
];

const emptyKnowledge = (): Knowledge => ({
  id: '', type: 'ratio', event_type: '', title: '', product_name: '',
  category: '', units_per_person: null, diet_tags: [], recommended: false,
  content: '', active: true, sort_order: 0,
});

const Presupuestos: React.FC = () => {
  const [tab, setTab] = React.useState<SubTab>('conocimiento');

  return (
    <div className="w-full">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-9 h-9 rounded-lg bg-indigo-100 flex items-center justify-center">
          <BookOpen className="h-5 w-5 text-indigo-600" />
        </div>
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-slate-900">Presupuestos</h2>
          <p className="text-xs text-slate-500">Catálogo (Holded) y base de conocimiento para elaborar presupuestos</p>
        </div>
      </div>

      {/* Sub-pestañas */}
      <div className="flex gap-2 mb-4 overflow-x-auto">
        {([
          { key: 'productos', label: 'Productos', icon: Package },
          { key: 'clientes', label: 'Clientes', icon: Users },
          { key: 'conocimiento', label: 'Conocimiento', icon: BookOpen },
        ] as const).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              tab === key ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      <div style={{ display: tab === 'productos' ? 'block' : 'none' }}><ProductosView /></div>
      <div style={{ display: tab === 'clientes' ? 'block' : 'none' }}><ClientesView /></div>
      <div style={{ display: tab === 'conocimiento' ? 'block' : 'none' }}><ConocimientoView /></div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Aviso de sincronización con Holded
// ---------------------------------------------------------------------------
const SyncNote: React.FC<{ count: number; syncedAt?: string | null; loading: boolean; onReload: () => void }> = ({ count, syncedAt, loading, onReload }) => (
  <div className="flex items-center justify-between gap-3 mb-3 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
    <span>
      {count} registros ·{' '}
      {syncedAt ? `última sincronización ${new Date(syncedAt).toLocaleString('es-ES')}` : 'aún sin sincronizar con Holded'}
    </span>
    <button onClick={onReload} className="flex items-center gap-1 text-slate-600 hover:text-indigo-600" title="Recargar">
      <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
      <span className="hidden sm:inline">Recargar</span>
    </button>
  </div>
);

// ---------------------------------------------------------------------------
// Productos (solo lectura, desde holded_products)
// ---------------------------------------------------------------------------
const ProductosView: React.FC = () => {
  const [rows, setRows] = React.useState<HoldedProduct[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [q, setQ] = React.useState('');

  const load = React.useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('holded_products')
      .select('id, holded_id, sku, name, category, price, tax, synced_at')
      .order('name', { ascending: true })
      .limit(2000);
    setRows((data as HoldedProduct[]) || []);
    setLoading(false);
  }, []);
  React.useEffect(() => { load(); }, [load]);

  const filtered = rows.filter(r =>
    !q || `${r.name} ${r.sku ?? ''} ${r.category ?? ''}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div>
      <SyncNote count={rows.length} syncedAt={rows[0]?.synced_at} loading={loading} onReload={load} />
      <SearchBar value={q} onChange={setQ} placeholder="Buscar producto, SKU o categoría…" />
      {rows.length === 0 && !loading ? (
        <EmptyState icon={Package} text="Sin productos todavía. Se llenará con la sincronización diaria de Holded." />
      ) : (
        <div className="overflow-x-auto bg-white rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <Th>SKU</Th><Th>Nombre</Th><Th>Categoría</Th><Th className="text-right">Precio</Th><Th className="text-right">IVA</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <Td className="text-slate-500">{r.sku || '—'}</Td>
                  <Td className="font-medium text-slate-800">{r.name}</Td>
                  <Td>{r.category || '—'}</Td>
                  <Td className="text-right">{r.price != null ? `${Number(r.price).toFixed(2)} €` : '—'}</Td>
                  <Td className="text-right text-slate-500">{r.tax != null ? `${r.tax}%` : '—'}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Clientes (solo lectura, desde holded_contacts)
// ---------------------------------------------------------------------------
const ClientesView: React.FC = () => {
  const [rows, setRows] = React.useState<HoldedContact[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [q, setQ] = React.useState('');

  const load = React.useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('holded_contacts')
      .select('id, holded_id, name, email, phone, code, type, synced_at')
      .order('name', { ascending: true })
      .limit(2000);
    setRows((data as HoldedContact[]) || []);
    setLoading(false);
  }, []);
  React.useEffect(() => { load(); }, [load]);

  const filtered = rows.filter(r =>
    !q || `${r.name} ${r.email ?? ''} ${r.code ?? ''}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div>
      <SyncNote count={rows.length} syncedAt={rows[0]?.synced_at} loading={loading} onReload={load} />
      <SearchBar value={q} onChange={setQ} placeholder="Buscar cliente, email o NIF…" />
      {rows.length === 0 && !loading ? (
        <EmptyState icon={Users} text="Sin clientes todavía. Se llenará con la sincronización diaria de Holded." />
      ) : (
        <div className="overflow-x-auto bg-white rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr><Th>Nombre</Th><Th>Email</Th><Th>Teléfono</Th><Th>NIF/CIF</Th></tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <Td className="font-medium text-slate-800">{r.name}</Td>
                  <Td className="text-slate-500">{r.email || '—'}</Td>
                  <Td>{r.phone || '—'}</Td>
                  <Td className="text-slate-500">{r.code || '—'}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Conocimiento (CRUD editable, sobre budget_knowledge)
// ---------------------------------------------------------------------------
const ConocimientoView: React.FC = () => {
  const [rows, setRows] = React.useState<Knowledge[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [q, setQ] = React.useState('');
  const [editing, setEditing] = React.useState<Knowledge | null>(null);
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('budget_knowledge')
      .select('*')
      .order('type', { ascending: true })
      .order('sort_order', { ascending: true })
      .limit(2000);
    setRows((data as Knowledge[]) || []);
    setLoading(false);
  }, []);
  React.useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const payload: any = {
        type: editing.type,
        event_type: editing.event_type || null,
        title: editing.title || '',
        product_name: editing.product_name || null,
        category: editing.category || null,
        units_per_person: editing.units_per_person === null || (editing.units_per_person as any) === '' ? null : Number(editing.units_per_person),
        diet_tags: editing.diet_tags || [],
        recommended: !!editing.recommended,
        content: editing.content || null,
        active: !!editing.active,
        sort_order: editing.sort_order ?? 0,
      };
      if (editing.id) {
        const { error } = await supabase.from('budget_knowledge').update(payload).eq('id', editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('budget_knowledge').insert(payload);
        if (error) throw error;
      }
      setEditing(null);
      await load();
    } catch (e) {
      console.error(e);
      alert('No se pudo guardar. Revisa los datos e inténtalo de nuevo.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('¿Eliminar esta entrada de conocimiento?')) return;
    const { error } = await supabase.from('budget_knowledge').delete().eq('id', id);
    if (error) { alert('No se pudo eliminar.'); return; }
    await load();
  };

  const filtered = rows.filter(r =>
    !q || `${r.title} ${r.product_name ?? ''} ${r.category ?? ''} ${r.event_type ?? ''} ${r.content ?? ''}`.toLowerCase().includes(q.toLowerCase()));

  const typeLabel = (t: string) => KNOWLEDGE_TYPES.find(k => k.value === t)?.label || t;

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-3">
        <p className="text-xs text-slate-500">
          Base de conocimiento editable: ratios por persona, packs, reglas de extras y notas. Es la fuente que la IA usa para proponer presupuestos.
        </p>
        <button
          onClick={() => setEditing(emptyKnowledge())}
          className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium flex-shrink-0"
        >
          <Plus className="h-4 w-4" /> Nueva entrada
        </button>
      </div>

      <SearchBar value={q} onChange={setQ} placeholder="Buscar en el conocimiento…" />

      <div className="overflow-x-auto bg-white rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <Th>Tipo</Th><Th>Título</Th><Th>Producto</Th><Th>Evento</Th>
              <Th className="text-right">Uds/pers.</Th><Th className="text-center">Recom.</Th><Th></Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => (
              <tr key={r.id} className={`border-t border-slate-100 hover:bg-slate-50 ${!r.active ? 'opacity-50' : ''}`}>
                <Td><span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{typeLabel(r.type)}</span></Td>
                <Td className="font-medium text-slate-800">{r.title}</Td>
                <Td className="text-slate-500">{r.product_name || '—'}</Td>
                <Td className="text-slate-500">{r.event_type || '—'}</Td>
                <Td className="text-right">{r.units_per_person != null ? Number(r.units_per_person) : '—'}</Td>
                <Td className="text-center">{r.recommended ? <Star className="h-4 w-4 text-amber-500 fill-amber-400 inline" /> : ''}</Td>
                <Td className="text-right whitespace-nowrap">
                  <button onClick={() => setEditing(r)} className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded" title="Editar">
                    <Edit2 className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => remove(r.id)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded" title="Eliminar">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </Td>
              </tr>
            ))}
            {filtered.length === 0 && !loading && (
              <tr><td colSpan={7} className="text-center text-slate-400 py-8">Sin entradas.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <KnowledgeModal
          value={editing}
          saving={saving}
          onChange={setEditing}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Modal de edición de conocimiento
// ---------------------------------------------------------------------------
const DIET_OPTIONS = ['vegetariano', 'vegano', 'sin_lactosa', 'sin_gluten'];
const inputCls = 'w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm bg-white';

const KnowledgeModal: React.FC<{
  value: Knowledge; saving: boolean;
  onChange: (k: Knowledge) => void; onClose: () => void; onSave: () => void;
}> = ({ value, saving, onChange, onClose, onSave }) => {
  const set = (patch: Partial<Knowledge>) => onChange({ ...value, ...patch });
  const toggleDiet = (d: string) => {
    const cur = value.diet_tags || [];
    set({ diet_tags: cur.includes(d) ? cur.filter(x => x !== d) : [...cur, d] });
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-[9998]" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl shadow-2xl z-[9999] w-[calc(100vw-2rem)] max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <h3 className="font-semibold text-slate-800">{value.id ? 'Editar' : 'Nueva'} entrada de conocimiento</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded"><X className="h-5 w-5 text-slate-500" /></button>
        </div>

        <div className="p-4 space-y-3">
          <Field label="Tipo">
            <select value={value.type} onChange={e => set({ type: e.target.value })} className={inputCls}>
              {KNOWLEDGE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="Título">
            <input value={value.title} onChange={e => set({ title: e.target.value })} className={inputCls} placeholder="Ej: Croquetas de cocido" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Producto (opcional)">
              <input value={value.product_name || ''} onChange={e => set({ product_name: e.target.value })} className={inputCls} />
            </Field>
            <Field label="Categoría (opcional)">
              <input value={value.category || ''} onChange={e => set({ category: e.target.value })} className={inputCls} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tipo de evento (opcional)">
              <input value={value.event_type || ''} onChange={e => set({ event_type: e.target.value })} className={inputCls} placeholder="coffee_break, coctel…" />
            </Field>
            <Field label="Uds por persona (ratio)">
              <input type="number" step="0.01" value={value.units_per_person ?? ''} onChange={e => set({ units_per_person: e.target.value === '' ? null : Number(e.target.value) })} className={inputCls} />
            </Field>
          </div>
          <Field label="Etiquetas dietéticas">
            <div className="flex flex-wrap gap-2">
              {DIET_OPTIONS.map(d => (
                <button key={d} type="button" onClick={() => toggleDiet(d)}
                  className={`px-2.5 py-1 rounded-full text-xs border ${(value.diet_tags || []).includes(d) ? 'bg-green-100 border-green-300 text-green-800' : 'bg-white border-slate-300 text-slate-600'}`}>
                  {d.replace('_', ' ')}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Contenido / regla">
            <textarea value={value.content || ''} onChange={e => set({ content: e.target.value })} rows={3} className={inputCls} placeholder="Descripción o regla en texto libre…" />
          </Field>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={value.recommended} onChange={e => set({ recommended: e.target.checked })} /> Recomendado
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={value.active} onChange={e => set({ active: e.target.checked })} /> Activo
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-slate-200 bg-slate-50 rounded-b-xl">
          <button onClick={onClose} className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-100 text-sm">Cancelar</button>
          <button onClick={onSave} disabled={saving || !value.title.trim()} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium disabled:opacity-50">
            <Check className="h-4 w-4" /> {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </>
  );
};

// ---------------------------------------------------------------------------
// Helpers de UI
// ---------------------------------------------------------------------------
const SearchBar: React.FC<{ value: string; onChange: (v: string) => void; placeholder: string }> = ({ value, onChange, placeholder }) => (
  <div className="relative mb-3">
    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
    <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm" />
  </div>
);

const EmptyState: React.FC<{ icon: React.ComponentType<any>; text: string }> = ({ icon: Icon, text }) => (
  <div className="bg-white rounded-xl border border-slate-200 p-10 text-center">
    <div className="w-14 h-14 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3">
      <Icon className="h-7 w-7 text-slate-400" />
    </div>
    <p className="text-slate-500 text-sm">{text}</p>
  </div>
);

const Th: React.FC<{ children?: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <th className={`text-left font-semibold px-3 py-2 ${className}`}>{children}</th>
);
const Td: React.FC<{ children?: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <td className={`px-3 py-2 ${className}`}>{children}</td>
);
const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="block">
    <span className="text-xs font-medium text-slate-600">{label}</span>
    <div className="mt-1">{children}</div>
  </label>
);

export default Presupuestos;

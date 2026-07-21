import React from 'react';
import { supabase } from '../lib/supabase';
import {
  Package, Users, BookOpen, Search, Plus, Edit2, Trash2, Check, X,
  RefreshCw, Sparkles,
} from 'lucide-react';
import PresupuestoGenerador from './PresupuestoGenerador';

type SubTab = 'generador' | 'productos' | 'clientes' | 'conocimiento';

interface HoldedProduct {
  id: string; holded_id: string; sku: string | null; name: string;
  category: string | null; price: number | null; tax: number | null;
  tags: string[] | null; synced_at: string | null;
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
  sort_order: number | null; tags: string[] | null;
}

const emptyKnowledge = (): Knowledge => ({
  id: '', type: 'nota', event_type: '', title: '', product_name: '',
  category: '', units_per_person: null, diet_tags: [], recommended: false,
  content: '', active: true, sort_order: 0, tags: [],
});

const Presupuestos: React.FC = () => {
  const [tab, setTab] = React.useState<SubTab>('generador');

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
          { key: 'generador', label: 'Generador IA', icon: Sparkles },
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

      <div style={{ display: tab === 'generador' ? 'block' : 'none' }}><PresupuestoGenerador /></div>
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

  const [activeTag, setActiveTag] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    const PAGE = 1000; // PostgREST corta a 1000 filas por respuesta → paginamos
    const all: HoldedProduct[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('holded_products')
        .select('id, holded_id, sku, name, category, price, tax, tags, synced_at')
        .order('name', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error || !data || data.length === 0) break;
      all.push(...(data as HoldedProduct[]));
      if (data.length < PAGE) break;
    }
    setRows(all);
    setLoading(false);
  }, []);
  React.useEffect(() => { load(); }, [load]);

  // Tags más usadas (para la barra de filtro rápido)
  const topTags = React.useMemo(() => {
    const count = new Map<string, number>();
    rows.forEach(r => (r.tags || []).forEach(t => count.set(t, (count.get(t) || 0) + 1)));
    return Array.from(count.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([t]) => t);
  }, [rows]);

  const filtered = rows.filter(r => {
    if (activeTag && !(r.tags || []).includes(activeTag)) return false;
    if (!q) return true;
    return `${r.name} ${r.sku ?? ''} ${(r.tags || []).join(' ')}`.toLowerCase().includes(q.toLowerCase());
  });

  return (
    <div>
      <SyncNote count={rows.length} syncedAt={rows[0]?.synced_at} loading={loading} onReload={load} />
      <SearchBar value={q} onChange={setQ} placeholder="Buscar producto, SKU o etiqueta…" />
      {topTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          <button
            onClick={() => setActiveTag(null)}
            className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${activeTag === null ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
          >Todas</button>
          {topTags.map(t => (
            <button
              key={t}
              onClick={() => setActiveTag(activeTag === t ? null : t)}
              className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${activeTag === t ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
            >{t}</button>
          ))}
        </div>
      )}
      {rows.length === 0 && !loading ? (
        <EmptyState icon={Package} text="Sin productos todavía. Se llenará con la sincronización diaria de Holded." />
      ) : (
        <div className="overflow-x-auto bg-white rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <Th>SKU</Th><Th>Nombre</Th><Th>Etiquetas</Th><Th className="text-right">Precio</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50 align-top">
                  <Td className="text-slate-500 whitespace-nowrap">{r.sku || '—'}</Td>
                  <Td className="font-medium text-slate-800">{r.name}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {(r.tags || []).length === 0 ? <span className="text-slate-400">—</span> :
                        (r.tags || []).map(t => (
                          <button
                            key={t}
                            onClick={() => setActiveTag(t)}
                            className="px-1.5 py-0.5 rounded-full text-[11px] bg-indigo-50 text-indigo-700 border border-indigo-100 hover:bg-indigo-100"
                          >{t}</button>
                        ))}
                    </div>
                  </Td>
                  <Td className="text-right whitespace-nowrap">{r.price != null ? `${Number(r.price).toFixed(2)} €` : '—'}</Td>
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
type ContactFilter = 'client' | 'lead' | 'all';
const CONTACT_FILTERS: { key: ContactFilter; label: string }[] = [
  { key: 'client', label: 'Clientes' },
  { key: 'lead', label: 'Leads' },
  { key: 'all', label: 'Todos' },
];

const ClientesView: React.FC = () => {
  const [rows, setRows] = React.useState<HoldedContact[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [q, setQ] = React.useState('');
  const [typeFilter, setTypeFilter] = React.useState<ContactFilter>('client');

  const load = React.useCallback(async () => {
    setLoading(true);
    const PAGE = 1000; // PostgREST corta a 1000 filas por respuesta → paginamos
    const all: HoldedContact[] = [];
    for (let from = 0; ; from += PAGE) {
      let query = supabase
        .from('holded_contacts')
        .select('id, holded_id, name, email, phone, code, type, synced_at')
        .order('name', { ascending: true })
        .range(from, from + PAGE - 1);
      // Holded /contacts trae clientes, leads, proveedores y acreedores.
      // Por defecto mostramos solo los clientes.
      if (typeFilter === 'client') query = query.eq('type', 'client');
      else if (typeFilter === 'lead') query = query.eq('type', 'lead');
      // 'all' no filtra
      const { data, error } = await query;
      if (error || !data || data.length === 0) break;
      all.push(...(data as HoldedContact[]));
      if (data.length < PAGE) break;
    }
    setRows(all);
    setLoading(false);
  }, [typeFilter]);
  React.useEffect(() => { load(); }, [load]);

  const filtered = rows.filter(r =>
    !q || `${r.name} ${r.email ?? ''} ${r.code ?? ''}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div>
      <SyncNote count={rows.length} syncedAt={rows[0]?.synced_at} loading={loading} onReload={load} />
      <div className="flex gap-1.5 mb-3">
        {CONTACT_FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setTypeFilter(f.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${typeFilter === f.key ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
          >{f.label}</button>
        ))}
      </div>
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
  const [activeTag, setActiveTag] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<Knowledge | null>(null);
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('budget_knowledge')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(2000);
    setRows((data as Knowledge[]) || []);
    setLoading(false);
  }, []);
  React.useEffect(() => { load(); }, [load]);

  const allTags = React.useMemo(() => {
    const s = new Set<string>();
    rows.forEach(r => (r.tags || []).forEach(t => s.add(t)));
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const payload: any = {
        title: editing.title || '',
        content: editing.content || '',
        tags: editing.tags || [],
        active: !!editing.active,
        type: editing.type || 'nota',
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
      alert('No se pudo guardar. Inténtalo de nuevo.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('¿Eliminar esta nota?')) return;
    const { error } = await supabase.from('budget_knowledge').delete().eq('id', id);
    if (error) { alert('No se pudo eliminar.'); return; }
    await load();
  };

  const filtered = rows.filter(r => {
    if (activeTag && !(r.tags || []).includes(activeTag)) return false;
    if (!q) return true;
    return `${r.title} ${r.content ?? ''} ${(r.tags || []).join(' ')}`.toLowerCase().includes(q.toLowerCase());
  });

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-3">
        <p className="text-xs text-slate-500">
          Notas y directrices para elaborar presupuestos. Escribe libremente y organízalas con tus propias etiquetas.
        </p>
        <button
          onClick={() => setEditing(emptyKnowledge())}
          className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium flex-shrink-0"
        >
          <Plus className="h-4 w-4" /> Nueva nota
        </button>
      </div>

      <SearchBar value={q} onChange={setQ} placeholder="Buscar en las notas…" />

      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          <button
            onClick={() => setActiveTag(null)}
            className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${activeTag === null ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
          >Todas</button>
          {allTags.map(t => (
            <button
              key={t}
              onClick={() => setActiveTag(activeTag === t ? null : t)}
              className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${activeTag === t ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
            >{t}</button>
          ))}
        </div>
      )}

      {filtered.length === 0 && !loading ? (
        <EmptyState icon={BookOpen} text="Sin notas. Crea la primera con tus propias etiquetas." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map(r => (
            <div key={r.id} className={`bg-white border border-slate-200 rounded-xl p-4 ${!r.active ? 'opacity-50' : ''}`}>
              <div className="flex items-start justify-between gap-2 mb-1">
                <h4 className="font-semibold text-slate-800 text-sm">{r.title || 'Sin título'}</h4>
                <div className="flex gap-1 flex-shrink-0">
                  <button onClick={() => setEditing(r)} className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded" title="Editar"><Edit2 className="h-3.5 w-3.5" /></button>
                  <button onClick={() => remove(r.id)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded" title="Eliminar"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              </div>
              {r.content && <p className="text-sm text-slate-600 whitespace-pre-wrap mb-2">{r.content}</p>}
              {r.tags && r.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {r.tags.map(t => (
                    <span key={t} className="px-2 py-0.5 rounded-full text-[11px] bg-indigo-50 text-indigo-700 border border-indigo-100">{t}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {editing && (
        <KnowledgeModal
          value={editing}
          saving={saving}
          allTags={allTags}
          onChange={setEditing}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}
    </div>
  );
};

const inputCls = 'w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm bg-white';

const KnowledgeModal: React.FC<{
  value: Knowledge; saving: boolean; allTags: string[];
  onChange: (k: Knowledge) => void; onClose: () => void; onSave: () => void;
}> = ({ value, saving, allTags, onChange, onClose, onSave }) => {
  const [tagInput, setTagInput] = React.useState('');
  const set = (patch: Partial<Knowledge>) => onChange({ ...value, ...patch });
  const tags = value.tags || [];

  const addTag = (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    if (!tags.includes(t)) set({ tags: [...tags, t] });
    setTagInput('');
  };
  const removeTag = (t: string) => set({ tags: tags.filter(x => x !== t) });

  const suggestions = allTags
    .filter(t => !tags.includes(t) && (!tagInput || t.toLowerCase().includes(tagInput.toLowerCase())))
    .slice(0, 8);

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-[9998]" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl shadow-2xl z-[9999] w-[calc(100vw-2rem)] max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <h3 className="font-semibold text-slate-800">{value.id ? 'Editar' : 'Nueva'} nota</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded"><X className="h-5 w-5 text-slate-500" /></button>
        </div>

        <div className="p-4 space-y-3">
          <Field label="Título (opcional)">
            <input value={value.title} onChange={e => set({ title: e.target.value })} className={inputCls} placeholder="Ej: Regla de camareros" />
          </Field>
          <Field label="Contenido">
            <textarea value={value.content || ''} onChange={e => set({ content: e.target.value })} rows={7} className={inputCls} placeholder="Escribe aquí libremente la nota, regla o directriz…" autoFocus />
          </Field>
          <Field label="Etiquetas">
            <div className="flex flex-wrap gap-1.5 mb-2">
              {tags.map(t => (
                <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-indigo-100 text-indigo-800 border border-indigo-200">
                  {t}
                  <button type="button" onClick={() => removeTag(t)} className="hover:text-red-600"><X className="h-3 w-3" /></button>
                </span>
              ))}
              {tags.length === 0 && <span className="text-xs text-slate-400">Sin etiquetas todavía</span>}
            </div>
            <div className="flex gap-2">
              <input
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(tagInput); } }}
                className={inputCls}
                placeholder="Escribe una etiqueta y pulsa Enter…"
              />
              <button type="button" onClick={() => addTag(tagInput)} className="px-3 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 text-sm flex-shrink-0">Añadir</button>
            </div>
            {suggestions.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2 items-center">
                <span className="text-[11px] text-slate-400">Sugeridas:</span>
                {suggestions.map(t => (
                  <button key={t} type="button" onClick={() => addTag(t)} className="px-2 py-0.5 rounded-full text-xs bg-white border border-slate-300 text-slate-600 hover:bg-slate-50">+ {t}</button>
                ))}
              </div>
            )}
          </Field>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={value.active} onChange={e => set({ active: e.target.checked })} /> Activa
          </label>
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-slate-200 bg-slate-50 rounded-b-xl">
          <button onClick={onClose} className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-100 text-sm">Cancelar</button>
          <button onClick={onSave} disabled={saving || (!value.content?.trim() && !value.title.trim())} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium disabled:opacity-50">
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

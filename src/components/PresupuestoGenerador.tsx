import React from 'react';
import { supabase } from '../lib/supabase';
import {
  Plus, Trash2, Send, Sparkles, ArrowLeft, ExternalLink, X,
  GraduationCap, Loader2, FileText, Layers, Bot, User as UserIcon, CheckCircle2,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------
interface Diets { vegetariano?: number; vegano?: number; sin_lactosa?: number; sin_gluten?: number }
interface Brief {
  event_type?: string; pax?: number; date?: string; budget?: number;
  zone?: string; transport?: string; diets?: Diets; notes?: string;
}
interface Line { sku?: string; name: string; units?: number; price?: number; tax?: number; diet?: string; note?: string }
interface Totals { base: number; tax: number; total: number }
interface Draft { items?: Line[]; extras?: Line[]; notas?: string; totals?: Totals }
interface Proposal {
  id: string; title: string; status: string;
  client_name: string | null; client_email: string | null; holded_contact_id: string | null;
  brief: Brief; draft: Draft;
  holded_document_id: string | null; holded_document_url: string | null;
  created_at: string; updated_at: string;
}
interface Msg { id: string; role: 'user' | 'assistant'; content: string; created_at: string }

// ---------------------------------------------------------------------------
// Llamada a edge functions con timeout largo (evita el cap global de 15s del
// cliente Supabase: usamos fetch nativo con nuestro propio AbortController).
// ---------------------------------------------------------------------------
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

async function callFn<T = any>(name: string, body: any, timeoutMs = 90_000): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(new DOMException('timeout', 'TimeoutError')), timeoutMs);
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: ANON,
        Authorization: `Bearer ${token ?? ANON}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json?.ok === false) throw new Error(json?.error || `Error ${res.status}`);
    return json as T;
  } finally {
    window.clearTimeout(timer);
  }
}

const eur = (n?: number) => `${(Number(n) || 0).toFixed(2)} €`;

// ---------------------------------------------------------------------------
// Contenedor
// ---------------------------------------------------------------------------
const PresupuestoGenerador: React.FC = () => {
  const [rows, setRows] = React.useState<Proposal[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [batch, setBatch] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('budget_proposals').select('*').order('updated_at', { ascending: false }).limit(200);
    setRows((data as Proposal[]) || []);
    setLoading(false);
  }, []);
  React.useEffect(() => { load(); }, [load]);

  const selected = rows.find(r => r.id === selectedId) || null;

  if (selected) {
    return (
      <Workspace
        proposal={selected}
        onBack={() => { setSelectedId(null); load(); }}
        onChanged={load}
        onDeleted={() => { setSelectedId(null); load(); }}
      />
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-3">
        <p className="text-xs text-slate-500">
          Crea presupuestos conversando con la IA. Puedes tener varios a la vez; cada uno tiene su propio chat.
        </p>
        <div className="flex gap-2 flex-shrink-0">
          <button onClick={() => setBatch(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 text-sm font-medium">
            <Layers className="h-4 w-4" /> Crear en lote
          </button>
          <button onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium">
            <Plus className="h-4 w-4" /> Nuevo presupuesto
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center">
          <div className="w-14 h-14 bg-indigo-50 rounded-full flex items-center justify-center mx-auto mb-3">
            <Sparkles className="h-7 w-7 text-indigo-500" />
          </div>
          <p className="text-slate-600 text-sm font-medium mb-1">Aún no hay presupuestos</p>
          <p className="text-slate-400 text-sm">Pulsa «Nuevo presupuesto» y pega el email del cliente para empezar.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {rows.map(p => (
            <ProposalCard key={p.id} p={p} onOpen={() => setSelectedId(p.id)} />
          ))}
        </div>
      )}

      {creating && (
        <NewProposalModal
          onClose={() => setCreating(false)}
          onCreated={(id) => { setCreating(false); load().then(() => setSelectedId(id)); }}
        />
      )}
      {batch && (
        <BatchModal
          onClose={() => setBatch(false)}
          onDone={() => { setBatch(false); load(); }}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Tarjeta de presupuesto en la lista
// ---------------------------------------------------------------------------
const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  draft: { label: 'Borrador', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  ready: { label: 'Listo', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  exported: { label: 'En Holded', cls: 'bg-green-50 text-green-700 border-green-200' },
};

const ProposalCard: React.FC<{ p: Proposal; onOpen: () => void }> = ({ p, onOpen }) => {
  const badge = STATUS_BADGE[p.status] || STATUS_BADGE.draft;
  const total = p.draft?.totals?.total;
  const pax = p.brief?.pax;
  return (
    <button onClick={onOpen}
      className="text-left bg-white border border-slate-200 rounded-xl p-4 hover:border-indigo-300 hover:shadow-sm transition-all">
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <h4 className="font-semibold text-slate-800 text-sm line-clamp-2">{p.title}</h4>
        <span className={`px-2 py-0.5 rounded-full text-[11px] border flex-shrink-0 ${badge.cls}`}>{badge.label}</span>
      </div>
      {p.client_name && <p className="text-xs text-slate-500 mb-2">{p.client_name}</p>}
      <div className="flex flex-wrap gap-1.5 text-[11px] text-slate-500">
        {p.brief?.event_type && <span className="px-1.5 py-0.5 bg-slate-100 rounded">{p.brief.event_type}</span>}
        {pax != null && <span className="px-1.5 py-0.5 bg-slate-100 rounded">{pax} pax</span>}
        {(p.draft?.items?.length || 0) > 0 && <span className="px-1.5 py-0.5 bg-slate-100 rounded">{p.draft!.items!.length} líneas</span>}
      </div>
      {total != null && total > 0 && (
        <p className="mt-2 text-sm font-semibold text-slate-800">{eur(total)} <span className="text-xs font-normal text-slate-400">IVA incl.</span></p>
      )}
    </button>
  );
};

// ---------------------------------------------------------------------------
// Selector de cliente (busca en holded_contacts)
// ---------------------------------------------------------------------------
const ClientPicker: React.FC<{
  name: string; email: string; contactId: string | null;
  onPick: (v: { name: string; email: string; contactId: string | null }) => void;
}> = ({ name, email, contactId, onPick }) => {
  const [q, setQ] = React.useState('');
  const [opts, setOpts] = React.useState<any[]>([]);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (!q.trim()) { setOpts([]); return; }
    let alive = true;
    const t = window.setTimeout(async () => {
      const { data } = await supabase
        .from('holded_contacts')
        .select('holded_id,name,email')
        .eq('type', 'client')
        .ilike('name', `%${q}%`)
        .limit(8);
      if (alive) setOpts(data || []);
    }, 250);
    return () => { alive = false; window.clearTimeout(t); };
  }, [q]);

  return (
    <div>
      <div className="relative">
        <input
          value={q || name}
          onChange={e => { setQ(e.target.value); setOpen(true); onPick({ name: e.target.value, email, contactId: null }); }}
          onFocus={() => setOpen(true)}
          placeholder="Buscar cliente en Holded o escribir nombre…"
          className={inputCls}
        />
        {contactId && <CheckCircle2 className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-green-500" />}
      </div>
      {open && opts.length > 0 && (
        <div className="mt-1 border border-slate-200 rounded-lg bg-white shadow-sm max-h-44 overflow-y-auto">
          {opts.map(o => (
            <button key={o.holded_id} type="button"
              onClick={() => { onPick({ name: o.name, email: o.email || '', contactId: o.holded_id }); setQ(o.name); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 border-b border-slate-100 last:border-0">
              <div className="font-medium text-slate-700">{o.name}</div>
              {o.email && <div className="text-xs text-slate-400">{o.email}</div>}
            </button>
          ))}
        </div>
      )}
      <input
        value={email}
        onChange={e => onPick({ name, email: e.target.value, contactId })}
        placeholder="Email del cliente (opcional)"
        className={`${inputCls} mt-2`}
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Modal: nuevo presupuesto
// ---------------------------------------------------------------------------
const NewProposalModal: React.FC<{ onClose: () => void; onCreated: (id: string) => void }> = ({ onClose, onCreated }) => {
  const [title, setTitle] = React.useState('');
  const [client, setClient] = React.useState<{ name: string; email: string; contactId: string | null }>({ name: '', email: '', contactId: null });
  const [email, setEmail] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');

  const create = async () => {
    setBusy(true); setErr('');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase.from('budget_proposals').insert({
        title: title.trim() || (client.name ? `Presupuesto · ${client.name}` : 'Nuevo presupuesto'),
        client_name: client.name || null,
        client_email: client.email || null,
        holded_contact_id: client.contactId,
        created_by: user?.id ?? null,
      }).select('id').single();
      if (error) throw error;
      const id = (data as any).id as string;
      if (email.trim()) {
        // Primer turno: analizar el email del cliente
        await callFn('budget-chat', {
          proposalId: id,
          message: `Este es el email del cliente. Analízalo, identifica el brief (tipo de evento, nº de personas, fecha, dietas, presupuesto, zona), hazme las preguntas que falten y prepara un primer borrador con productos del catálogo:\n\n"""${email.trim()}"""`,
        }).catch(() => {/* el usuario podrá reintentar dentro */});
      }
      onCreated(id);
    } catch (e: any) {
      setErr(e?.message || 'No se pudo crear');
      setBusy(false);
    }
  };

  return (
    <Modal title="Nuevo presupuesto" onClose={onClose}>
      <div className="p-4 space-y-3">
        <Field label="Título (opcional)">
          <input value={title} onChange={e => setTitle(e.target.value)} className={inputCls} placeholder="Ej: Coffee break oficinas ACME" />
        </Field>
        <Field label="Cliente">
          <ClientPicker name={client.name} email={client.email} contactId={client.contactId} onPick={setClient} />
        </Field>
        <Field label="Email del cliente (opcional — la IA lo analiza y arranca el borrador)">
          <textarea value={email} onChange={e => setEmail(e.target.value)} rows={5} className={inputCls}
            placeholder="Pega aquí el email con la petición del cliente…" />
        </Field>
        {err && <p className="text-sm text-red-600">{err}</p>}
      </div>
      <ModalFooter>
        <button onClick={onClose} className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-100 text-sm">Cancelar</button>
        <button onClick={create} disabled={busy}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {busy ? 'Creando…' : 'Crear y abrir'}
        </button>
      </ModalFooter>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Modal: crear en lote (varios a la vez, separando emails por una línea "---")
// ---------------------------------------------------------------------------
const BatchModal: React.FC<{ onClose: () => void; onDone: () => void }> = ({ onClose, onDone }) => {
  const [text, setText] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState<{ done: number; total: number }>({ done: 0, total: 0 });

  const run = async () => {
    const blocks = text.split(/\n\s*---+\s*\n/).map(s => s.trim()).filter(Boolean);
    if (blocks.length === 0) return;
    setBusy(true); setProgress({ done: 0, total: blocks.length });
    const { data: { user } } = await supabase.auth.getUser();

    // Se crean y analizan en paralelo (cada uno con su propio chat).
    await Promise.allSettled(blocks.map(async (block, i) => {
      const { data } = await supabase.from('budget_proposals').insert({
        title: `Presupuesto en lote #${i + 1}`,
        created_by: user?.id ?? null,
      }).select('id').single();
      const id = (data as any)?.id;
      if (!id) return;
      await callFn('budget-chat', {
        proposalId: id,
        message: `Este es el email del cliente. Analízalo, identifica el brief, hazme las preguntas que falten y prepara un primer borrador con productos del catálogo:\n\n"""${block}"""`,
      }).catch(() => {});
      setProgress(prev => ({ ...prev, done: prev.done + 1 }));
    }));
    setBusy(false);
    onDone();
  };

  return (
    <Modal title="Crear presupuestos en lote" onClose={busy ? () => {} : onClose}>
      <div className="p-4 space-y-3">
        <p className="text-xs text-slate-500">
          Pega varios emails de clientes, separando cada uno con una línea que contenga solo <code className="px-1 bg-slate-100 rounded">---</code>.
          Se creará un presupuesto por email y la IA preparará un primer borrador de cada uno.
        </p>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={12} className={inputCls}
          placeholder={'Email 1…\n\n---\n\nEmail 2…\n\n---\n\nEmail 3…'} disabled={busy} />
        {busy && (
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <Loader2 className="h-4 w-4 animate-spin" /> Procesando {progress.done}/{progress.total}…
          </div>
        )}
      </div>
      <ModalFooter>
        <button onClick={onClose} disabled={busy} className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-100 text-sm disabled:opacity-50">Cancelar</button>
        <button onClick={run} disabled={busy || !text.trim()}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium disabled:opacity-50">
          <Layers className="h-4 w-4" /> Crear en lote
        </button>
      </ModalFooter>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Workspace: chat + panel de borrador
// ---------------------------------------------------------------------------
const Workspace: React.FC<{ proposal: Proposal; onBack: () => void; onChanged: () => void; onDeleted: () => void }> = ({ proposal, onBack, onChanged, onDeleted }) => {
  const [p, setP] = React.useState<Proposal>(proposal);
  const [msgs, setMsgs] = React.useState<Msg[]>([]);
  const [input, setInput] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [err, setErr] = React.useState('');
  const [exporting, setExporting] = React.useState(false);
  const [learning, setLearning] = React.useState(false);
  const [banner, setBanner] = React.useState('');
  const [editClient, setEditClient] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const loadMsgs = React.useCallback(async () => {
    const { data } = await supabase
      .from('budget_proposal_messages').select('id,role,content,created_at')
      .eq('proposal_id', proposal.id).order('created_at');
    setMsgs((data as Msg[]) || []);
  }, [proposal.id]);

  const reloadProposal = React.useCallback(async () => {
    const { data } = await supabase.from('budget_proposals').select('*').eq('id', proposal.id).single();
    if (data) setP(data as Proposal);
  }, [proposal.id]);

  React.useEffect(() => { loadMsgs(); }, [loadMsgs]);
  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, sending]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput(''); setErr('');
    setMsgs(prev => [...prev, { id: `tmp-${Date.now()}`, role: 'user', content: text, created_at: new Date().toISOString() }]);
    setSending(true);
    try {
      const res = await callFn('budget-chat', { proposalId: proposal.id, message: text });
      await loadMsgs();
      await reloadProposal();
      onChanged();
      if (res?.learned) setBanner(`He aprendido ${res.learned} regla(s) nueva(s) (en Conocimiento).`);
    } catch (e: any) {
      setErr(e?.message || 'Error al enviar');
      await loadMsgs();
    } finally {
      setSending(false);
    }
  };

  const learn = async () => {
    setLearning(true); setErr(''); setBanner('');
    try {
      const res = await callFn('budget-chat', { proposalId: proposal.id, action: 'learn' });
      setBanner(res?.learned ? `He guardado ${res.learned} aprendizaje(s) en Conocimiento.` : 'No he encontrado reglas nuevas que guardar.');
    } catch (e: any) {
      setErr(e?.message || 'No se pudo aprender');
    } finally {
      setLearning(false);
    }
  };

  const exportHolded = async () => {
    if (!p.client_name && !p.holded_contact_id) { setEditClient(true); return; }
    if (!window.confirm('¿Crear este presupuesto en Holded?')) return;
    setExporting(true); setErr(''); setBanner('');
    try {
      const res = await callFn('holded-estimate', { proposalId: proposal.id }, 60_000);
      await reloadProposal(); onChanged();
      setBanner('Presupuesto creado en Holded ✓');
      if (res?.url) window.open(res.url, '_blank');
    } catch (e: any) {
      setErr(e?.message || 'No se pudo crear en Holded');
    } finally {
      setExporting(false);
    }
  };

  const remove = async () => {
    if (!window.confirm('¿Eliminar este presupuesto y su conversación?')) return;
    await supabase.from('budget_proposals').delete().eq('id', proposal.id);
    onDeleted();
  };

  const draft = p.draft || {};
  const items = draft.items || [];
  const extras = draft.extras || [];

  return (
    <div>
      {/* Cabecera */}
      <div className="flex items-center gap-2 mb-3">
        <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500"><ArrowLeft className="h-4 w-4" /></button>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-slate-800 truncate">{p.title}</h3>
          <button onClick={() => setEditClient(true)} className="text-xs text-slate-500 hover:text-indigo-600">
            {p.client_name || 'Sin cliente'}{p.holded_contact_id ? ' · Holded ✓' : ''} · editar
          </button>
        </div>
        <button onClick={remove} className="p-2 hover:bg-red-50 rounded-lg text-slate-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
      </div>

      {banner && (
        <div className="mb-3 flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
          <CheckCircle2 className="h-4 w-4" /> {banner}
          {p.holded_document_url && <a href={p.holded_document_url} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-green-800 underline">Ver <ExternalLink className="h-3 w-3" /></a>}
        </div>
      )}
      {err && <div className="mb-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Chat */}
        <div className="flex flex-col bg-white border border-slate-200 rounded-xl overflow-hidden" style={{ height: '70vh' }}>
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
            {msgs.length === 0 && !sending && (
              <div className="text-center text-slate-400 text-sm py-10">
                <Bot className="h-8 w-8 mx-auto mb-2 text-slate-300" />
                Cuéntame el evento (o pega el email del cliente) y preparo el presupuesto.
              </div>
            )}
            {msgs.map(m => <Bubble key={m.id} role={m.role} content={m.content} />)}
            {sending && (
              <div className="flex items-center gap-2 text-slate-400 text-sm">
                <Bot className="h-4 w-4" /> <Loader2 className="h-4 w-4 animate-spin" /> pensando…
              </div>
            )}
          </div>
          <div className="border-t border-slate-200 p-3 flex gap-2">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              rows={2}
              placeholder="Escribe un mensaje… (Enter para enviar)"
              className="flex-1 resize-none px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
            />
            <button onClick={send} disabled={sending || !input.trim()}
              className="px-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center">
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Panel de borrador */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 overflow-y-auto" style={{ maxHeight: '70vh' }}>
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-semibold text-slate-800 text-sm flex items-center gap-1.5"><FileText className="h-4 w-4 text-indigo-500" /> Borrador</h4>
            <div className="flex gap-1.5">
              <button onClick={learn} disabled={learning}
                title="Extraer reglas de esta conversación y guardarlas en Conocimiento"
                className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 text-xs font-medium disabled:opacity-50">
                {learning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GraduationCap className="h-3.5 w-3.5" />} Aprender
              </button>
              <button onClick={exportHolded} disabled={exporting || items.length === 0}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 text-xs font-medium disabled:opacity-50">
                {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />} A Holded
              </button>
            </div>
          </div>

          <BriefChips brief={p.brief || {}} />
          <DietCoverage brief={p.brief || {}} items={items} />

          {items.length === 0 && extras.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">Aún no hay líneas. Habla con la IA para construir el presupuesto.</p>
          ) : (
            <>
              <LineTable title="Productos" lines={items} />
              {extras.length > 0 && <LineTable title="Extras y logística" lines={extras} />}
              {draft.totals && (
                <div className="mt-3 border-t border-slate-200 pt-2 text-sm space-y-1">
                  <Row k="Base" v={eur(draft.totals.base)} />
                  <Row k="IVA" v={eur(draft.totals.tax)} />
                  <Row k="Total" v={eur(draft.totals.total)} bold />
                </div>
              )}
              {draft.notas && (
                <div className="mt-3 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-2 whitespace-pre-wrap">{draft.notas}</div>
              )}
            </>
          )}

          {p.holded_document_url && (
            <a href={p.holded_document_url} target="_blank" rel="noreferrer"
              className="mt-3 inline-flex items-center gap-1 text-sm text-green-700 hover:underline">
              <ExternalLink className="h-4 w-4" /> Ver presupuesto en Holded
            </a>
          )}
        </div>
      </div>

      {editClient && (
        <ClientModal proposal={p} onClose={() => setEditClient(false)} onSaved={(np) => { setP(np); setEditClient(false); onChanged(); }} />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Sub-componentes del workspace
// ---------------------------------------------------------------------------
const Bubble: React.FC<{ role: 'user' | 'assistant'; content: string }> = ({ role, content }) => {
  const mine = role === 'user';
  return (
    <div className={`flex gap-2 ${mine ? 'flex-row-reverse' : ''}`}>
      <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${mine ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-600'}`}>
        {mine ? <UserIcon className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap ${mine ? 'bg-indigo-600 text-white rounded-tr-sm' : 'bg-slate-100 text-slate-800 rounded-tl-sm'}`}>
        {content}
      </div>
    </div>
  );
};

const BriefChips: React.FC<{ brief: Brief }> = ({ brief }) => {
  const chips: string[] = [];
  if (brief.event_type) chips.push(brief.event_type);
  if (brief.pax != null) chips.push(`${brief.pax} pax`);
  if (brief.date) chips.push(brief.date);
  if (brief.budget != null) chips.push(`Ppto ${eur(brief.budget)}`);
  if (brief.zone) chips.push(brief.zone);
  if (brief.transport) chips.push(brief.transport);
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mb-3">
      {chips.map((c, i) => <span key={i} className="px-2 py-0.5 rounded-full text-[11px] bg-indigo-50 text-indigo-700 border border-indigo-100">{c}</span>)}
    </div>
  );
};

const DIET_LABEL: Record<string, string> = { vegetariano: 'Vegetariano', vegano: 'Vegano', sin_lactosa: 'Sin lactosa', sin_gluten: 'Sin gluten' };
const DietCoverage: React.FC<{ brief: Brief; items: Line[] }> = ({ brief, items }) => {
  const diets = brief.diets || {};
  const entries = Object.entries(diets).filter(([, n]) => (n as number) > 0);
  if (entries.length === 0) return null;
  return (
    <div className="mb-3 flex flex-wrap gap-1.5">
      {entries.map(([k, n]) => {
        const covered = items.filter(it => (it.diet || '').includes(k) || (it.diet || '').includes(DIET_LABEL[k]?.toLowerCase() || k)).length;
        const ok = covered > 0;
        return (
          <span key={k} className={`px-2 py-0.5 rounded-full text-[11px] border ${ok ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
            {DIET_LABEL[k] || k}: {n} pax · {covered} línea(s)
          </span>
        );
      })}
    </div>
  );
};

const LineTable: React.FC<{ title: string; lines: Line[] }> = ({ title, lines }) => (
  <div className="mb-2">
    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{title}</p>
    <div className="space-y-1">
      {lines.map((l, i) => (
        <div key={i} className="flex items-start justify-between gap-2 text-sm border-b border-slate-100 pb-1">
          <div className="min-w-0">
            <span className="text-slate-800">{l.name}</span>
            {l.diet && <span className="ml-1 px-1 py-0.5 rounded text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-100">{l.diet}</span>}
            <span className="block text-[11px] text-slate-400">
              {l.sku ? `${l.sku} · ` : ''}{(Number(l.units) || 0)} × {eur(l.price)}{l.tax != null ? ` · IVA ${l.tax}%` : ''}
            </span>
          </div>
          <span className="text-slate-700 whitespace-nowrap">{eur((Number(l.units) || 0) * (Number(l.price) || 0))}</span>
        </div>
      ))}
    </div>
  </div>
);

const Row: React.FC<{ k: string; v: string; bold?: boolean }> = ({ k, v, bold }) => (
  <div className={`flex justify-between ${bold ? 'font-semibold text-slate-800' : 'text-slate-500'}`}>
    <span>{k}</span><span>{v}</span>
  </div>
);

const ClientModal: React.FC<{ proposal: Proposal; onClose: () => void; onSaved: (p: Proposal) => void }> = ({ proposal, onClose, onSaved }) => {
  const [client, setClient] = React.useState({ name: proposal.client_name || '', email: proposal.client_email || '', contactId: proposal.holded_contact_id });
  const [title, setTitle] = React.useState(proposal.title);
  const [busy, setBusy] = React.useState(false);
  const save = async () => {
    setBusy(true);
    const { data } = await supabase.from('budget_proposals').update({
      title: title.trim() || proposal.title,
      client_name: client.name || null,
      client_email: client.email || null,
      holded_contact_id: client.contactId,
    }).eq('id', proposal.id).select('*').single();
    setBusy(false);
    if (data) onSaved(data as Proposal);
  };
  return (
    <Modal title="Datos del presupuesto" onClose={onClose}>
      <div className="p-4 space-y-3">
        <Field label="Título"><input value={title} onChange={e => setTitle(e.target.value)} className={inputCls} /></Field>
        <Field label="Cliente"><ClientPicker name={client.name} email={client.email} contactId={client.contactId} onPick={setClient} /></Field>
      </div>
      <ModalFooter>
        <button onClick={onClose} className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-100 text-sm">Cancelar</button>
        <button onClick={save} disabled={busy} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium disabled:opacity-50">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Guardar
        </button>
      </ModalFooter>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Helpers de UI compartidos
// ---------------------------------------------------------------------------
const inputCls = 'w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm bg-white';

const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => (
  <>
    <div className="fixed inset-0 bg-black/50 z-[9998]" onClick={onClose} />
    <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl shadow-2xl z-[9999] w-[calc(100vw-2rem)] max-w-lg max-h-[90vh] overflow-y-auto">
      <div className="flex items-center justify-between p-4 border-b border-slate-200">
        <h3 className="font-semibold text-slate-800">{title}</h3>
        <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded"><X className="h-5 w-5 text-slate-500" /></button>
      </div>
      {children}
    </div>
  </>
);

const ModalFooter: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex justify-end gap-2 p-4 border-t border-slate-200 bg-slate-50 rounded-b-xl">{children}</div>
);

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="block">
    <span className="text-xs font-medium text-slate-600">{label}</span>
    <div className="mt-1">{children}</div>
  </label>
);

export default PresupuestoGenerador;

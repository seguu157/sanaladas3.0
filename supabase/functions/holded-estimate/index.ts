// Supabase Edge Function: holded-estimate
// -----------------------------------------------------------------------------
// Toma el borrador final de un presupuesto (budget_proposals.draft) y crea el
// documento de tipo "estimate" (presupuesto) en Holded vía API. Guarda el id del
// documento devuelto y marca el presupuesto como exportado.
//
//   POST /invoicing/v1/documents/estimate
//   headers: key: <HOLDED_API_KEY>
//
// Secretos: HOLDED_API_KEY (ya configurado para el sync).
// -----------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const HOLDED_DOCS = "https://api.holded.com/api/invoicing/v1/documents/estimate";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

function toUnixSeconds(dateStr?: string): number {
  if (dateStr) {
    const t = Date.parse(dateStr);
    if (!Number.isNaN(t)) return Math.floor(t / 1000);
  }
  return Math.floor(Date.now() / 1000);
}

function mapLine(l: any) {
  const desc = [l.diet ? `Apto ${l.diet}` : "", l.note || ""].filter(Boolean).join(" · ");
  const item: any = {
    name: String(l.name ?? "").slice(0, 250),
    desc,
    units: Number(l.units ?? 1) || 1,
    subtotal: Number(l.price ?? 0) || 0, // precio unitario SIN IVA
    tax: Number(l.tax ?? 10) || 0,       // % de IVA
  };
  if (l.sku) item.sku = String(l.sku);
  return item;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const apiKey = Deno.env.get("HOLDED_API_KEY");
    if (!apiKey) return json({ error: "HOLDED_API_KEY no configurada" }, 500);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Auth: solo usuarios autenticados
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) return json({ error: "no autorizado" }, 401);

    const { proposalId } = await req.json();
    if (!proposalId) return json({ error: "falta proposalId" }, 400);

    const { data: p, error } = await supabase
      .from("budget_proposals").select("*").eq("id", proposalId).single();
    if (error || !p) return json({ error: "presupuesto no encontrado" }, 404);

    const draft = p.draft ?? {};
    const lines = [...(draft.items ?? []), ...(draft.extras ?? [])];
    if (lines.length === 0) return json({ error: "el borrador no tiene líneas" }, 400);
    if (!p.holded_contact_id && !p.client_name) {
      return json({ error: "falta el cliente (nombre o contacto de Holded)" }, 400);
    }

    const payload: any = {
      date: toUnixSeconds(p.brief?.date),
      notes: draft.notas ?? "",
      language: "es",
      items: lines.map(mapLine),
    };
    if (p.holded_contact_id) payload.contactId = p.holded_contact_id;
    else {
      payload.contactName = p.client_name;
      if (p.client_email) payload.contactEmail = p.client_email;
    }

    const res = await fetch(HOLDED_DOCS, {
      method: "POST",
      headers: { key: apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));

    // Holded devuelve { status: 1, id: "..." } al crear correctamente.
    const docId = body?.id ?? body?.documentId ?? null;
    if (!res.ok || body?.status === 0 || !docId) {
      return json({ ok: false, error: "Holded rechazó la creación", holded: body }, 502);
    }

    // Recuperar el nº de documento (E2xxxx) para mostrarlo y poder localizarlo
    // fácil en Holded (Ventas → Presupuestos). No es crítico si falla.
    let docNumber: string | null = body?.docNumber ?? null;
    if (!docNumber) {
      try {
        const g = await fetch(`${HOLDED_DOCS}/${docId}`, { headers: { key: apiKey, accept: "application/json" } });
        const gd = await g.json().catch(() => ({} as any));
        docNumber = gd?.docNumber ?? null;
      } catch { /* no crítico */ }
    }

    const url = `https://app.holded.com/documents/estimate/${docId}`;
    await supabase.from("budget_proposals")
      .update({
        holded_document_id: docId,
        holded_doc_number: docNumber,
        holded_document_url: url,
        status: "exported",
        updated_at: new Date().toISOString(),
      })
      .eq("id", proposalId);

    return json({ ok: true, holded_document_id: docId, holded_doc_number: docNumber, url });
  } catch (e) {
    console.error("holded-estimate error:", e);
    return json({ ok: false, error: String((e as any)?.message ?? e) }, 500);
  }
});

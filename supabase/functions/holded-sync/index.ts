// Supabase Edge Function: holded-sync
// -----------------------------------------------------------------------------
// Sincroniza el catálogo de Holded hacia Supabase:
//   - GET /invoicing/v1/products  -> upsert en holded_products
//   - GET /invoicing/v1/contacts  -> upsert en holded_contacts
//
// Se ejecuta a diario (pg_cron) y también puede invocarse a mano.
//
// Secretos necesarios (Supabase → Project Settings → Edge Functions → Secrets):
//   HOLDED_API_KEY   -> tu API key de Holded (obligatorio)
//   SYNC_SECRET      -> (opcional) si se define, el llamador debe enviar el
//                       header  x-sync-secret: <valor>  para poder ejecutar.
//
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase automáticamente.
// -----------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const HOLDED_BASE = "https://api.holded.com/api/invoicing/v1";
const PAGE_SIZE = 500;
const MAX_PAGES = 60; // salvaguarda anti-bucle

async function holdedGet(path: string, apiKey: string, page: number): Promise<any[]> {
  const url = `${HOLDED_BASE}${path}?page=${page}`;
  const res = await fetch(url, {
    headers: { key: apiKey, accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Holded ${path} p${page} -> ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  return Array.isArray(json) ? json : [];
}

// Recorre todas las páginas hasta agotar (con detección de repetición).
async function holdedAll(path: string, apiKey: string): Promise<any[]> {
  const all: any[] = [];
  let prevFirstId: string | null = null;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const items = await holdedGet(path, apiKey, page);
    if (items.length === 0) break;
    const firstId = String(items[0]?.id ?? "");
    if (firstId && firstId === prevFirstId) break; // la API ignoró ?page
    prevFirstId = firstId;
    all.push(...items);
    if (items.length < PAGE_SIZE) break;
  }
  return all;
}

function num(v: unknown): number | null {
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? n : null;
}

Deno.serve(async (req) => {
  try {
    // Protección opcional por secreto compartido.
    const syncSecret = Deno.env.get("SYNC_SECRET");
    if (syncSecret) {
      const provided = req.headers.get("x-sync-secret") ??
        new URL(req.url).searchParams.get("secret");
      if (provided !== syncSecret) {
        return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
      }
    }

    const apiKey = Deno.env.get("HOLDED_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "HOLDED_API_KEY no configurada" }), { status: 500 });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const now = new Date().toISOString();

    // ---- Productos ----
    const products = await holdedAll("/products", apiKey);
    const productRows = products.map((p: any) => ({
      holded_id: String(p.id),
      sku: p.sku ?? null,
      name: p.name ?? "",
      description: p.desc ?? p.description ?? null,
      price: num(p.price),
      tax: num(p.tax),
      cost: num(p.cost),
      category: p.categoryId ?? p.category ?? null,
      kind: p.kind ?? null,
      barcode: p.barcode ?? null,
      stock: num(p.stock),
      raw: p,
      synced_at: now,
      updated_at: now,
    }));

    let productsUpserted = 0;
    for (let i = 0; i < productRows.length; i += 500) {
      const chunk = productRows.slice(i, i + 500);
      const { error } = await supabase
        .from("holded_products")
        .upsert(chunk, { onConflict: "holded_id" });
      if (error) throw new Error(`upsert products: ${error.message}`);
      productsUpserted += chunk.length;
    }

    // ---- Contactos / Clientes ----
    const contacts = await holdedAll("/contacts", apiKey);
    const contactRows = contacts.map((c: any) => {
      const bill = c.billAddress ?? c.defaults?.billAddress ?? {};
      return {
        holded_id: String(c.id),
        name: c.name ?? "",
        code: c.code ?? null,
        email: c.email ?? null,
        phone: c.phone ?? c.mobile ?? null,
        type: c.type ?? null,
        is_person: typeof c.isperson === "boolean" ? c.isperson : null,
        billing_address: bill.address ?? null,
        city: bill.city ?? null,
        province: bill.province ?? null,
        postal_code: bill.postalCode ?? null,
        country: bill.country ?? null,
        raw: c,
        synced_at: now,
        updated_at: now,
      };
    });

    let contactsUpserted = 0;
    for (let i = 0; i < contactRows.length; i += 500) {
      const chunk = contactRows.slice(i, i + 500);
      const { error } = await supabase
        .from("holded_contacts")
        .upsert(chunk, { onConflict: "holded_id" });
      if (error) throw new Error(`upsert contacts: ${error.message}`);
      contactsUpserted += chunk.length;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        products: productsUpserted,
        contacts: contactsUpserted,
        synced_at: now,
      }),
      { headers: { "content-type": "application/json" } },
    );
  } catch (e) {
    console.error("holded-sync error:", e);
    return new Response(
      JSON.stringify({ ok: false, error: String(e?.message ?? e) }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
});

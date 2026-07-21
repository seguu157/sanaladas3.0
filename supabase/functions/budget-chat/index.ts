// Supabase Edge Function: budget-chat
// -----------------------------------------------------------------------------
// Cerebro conversacional del generador de presupuestos de Sanaladas.
//
// Recibe un mensaje del usuario para un presupuesto (budget_proposals) y responde
// como experto en catering, apoyándose en:
//   - la base de conocimiento editable (budget_knowledge): ratios/persona, reglas
//     de extras, notas y las listas de productos aptos por dieta,
//   - el catálogo vivo de Holded (holded_products) a través de herramientas,
// y mantiene el "borrador vivo" del presupuesto (líneas + extras + totales).
//
// Acciones (body.action):
//   'chat'  (por defecto) -> conversa y actualiza el borrador
//   'learn'               -> extrae de la conversación reglas duraderas y las
//                            guarda en budget_knowledge (tag "aprendido")
//
// Secretos necesarios (Supabase → Edge Functions → Secrets):
//   ANTHROPIC_API_KEY   -> API key de Anthropic (obligatorio)
//   BUDGET_MODEL        -> (opcional) id del modelo; por defecto claude-sonnet-5
//
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase.
// -----------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-5";
const MAX_STEPS = 6; // vueltas del bucle de herramientas por turno

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

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// ---------------------------------------------------------------------------
// Herramientas expuestas al modelo
// ---------------------------------------------------------------------------
const TOOLS = [
  {
    name: "buscar_productos",
    description:
      "Busca productos en el catálogo vivo de Holded por texto y/o etiquetas. " +
      "Devuelve SKU, nombre, precio (sin IVA) e IVA. Úsalo para elegir productos reales " +
      "y precios actualizados. Etiquetas útiles: ensalada, wraps, bocadillos, bocaditos, " +
      "croquetas, postre, bolleria, bebida, singluten, vegetariano, sinlactosa, vegano…",
    input_schema: {
      type: "object",
      properties: {
        consulta: { type: "string", description: "Texto a buscar en el nombre del producto" },
        etiquetas: { type: "array", items: { type: "string" }, description: "Filtra por etiquetas (coincide con cualquiera)" },
        limite: { type: "integer", description: "Máximo de resultados (por defecto 25)" },
      },
    },
  },
  {
    name: "productos_por_dieta",
    description:
      "Devuelve la lista curada de productos aptos para una necesidad especial " +
      "(con SKU, nombre y precio vivo). Úsalo siempre que haya comensales con esa dieta.",
    input_schema: {
      type: "object",
      properties: {
        dieta: { type: "string", enum: ["sin_gluten", "vegetariano", "sin_lactosa", "vegano"] },
      },
      required: ["dieta"],
    },
  },
  {
    name: "guardar_borrador",
    description:
      "Guarda/actualiza el borrador del presupuesto. Llama SIEMPRE que cambien las líneas. " +
      "Los totales se calculan en el servidor a partir de units*price y el IVA de cada línea.",
    input_schema: {
      type: "object",
      properties: {
        brief: {
          type: "object",
          description: "Datos del evento",
          properties: {
            event_type: { type: "string" },
            pax: { type: "integer" },
            date: { type: "string" },
            budget: { type: "number" },
            zone: { type: "string" },
            transport: { type: "string" },
            diets: {
              type: "object",
              description: "Nº de comensales por dieta",
              properties: {
                vegetariano: { type: "integer" },
                vegano: { type: "integer" },
                sin_lactosa: { type: "integer" },
                sin_gluten: { type: "integer" },
              },
            },
            notes: { type: "string" },
          },
        },
        items: {
          type: "array",
          description: "Líneas de producto del presupuesto",
          items: {
            type: "object",
            properties: {
              sku: { type: "string" },
              name: { type: "string" },
              units: { type: "number" },
              price: { type: "number", description: "Precio unitario SIN IVA" },
              tax: { type: "number", description: "% de IVA (p.ej. 10 o 21)" },
              diet: { type: "string", description: "Dieta que cubre, si aplica" },
              note: { type: "string" },
            },
            required: ["name", "units", "price"],
          },
        },
        extras: {
          type: "array",
          description: "Extras: envío, recogida, colocación, camareros, carga/descarga…",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              units: { type: "number" },
              price: { type: "number" },
              tax: { type: "number" },
            },
            required: ["name", "price"],
          },
        },
        notas: { type: "string", description: "Notas del presupuesto (incluye el aviso de trazas si hay dietas)" },
      },
      required: ["items"],
    },
  },
  {
    name: "aprender",
    description:
      "Guarda una regla o preferencia DURADERA y reutilizable que el usuario te enseñe " +
      "sobre cómo elaborar presupuestos (no datos de un cliente concreto). Aparecerá como " +
      "nota editable en Conocimiento.",
    input_schema: {
      type: "object",
      properties: {
        titulo: { type: "string" },
        contenido: { type: "string" },
        etiquetas: { type: "array", items: { type: "string" } },
      },
      required: ["titulo", "contenido"],
    },
  },
];

// ---------------------------------------------------------------------------
// Construcción del system prompt a partir de la base de conocimiento
// ---------------------------------------------------------------------------
function buildSystem(knowledge: any[], proposal: any): string {
  const ratios = knowledge.filter((k) => k.type === "ratio");
  const reglas = knowledge.filter((k) => k.type === "regla_extra");
  const notas = knowledge.filter((k) => k.type === "nota");
  const aprendidos = knowledge.filter((k) => (k.tags || []).includes("aprendido"));

  const fmtRatio = (r: any) =>
    `- ${r.product_name || r.title}: ${r.units_per_person ?? "?"} uds/persona${r.content ? ` (${r.content})` : ""}`;
  const fmtNote = (r: any) => `- ${r.title}: ${r.content || ""}`;

  return [
    "Eres el asistente experto de Sanaladas (catering en Barcelona) para ELABORAR PRESUPUESTOS.",
    "Tu objetivo: a partir del brief del evento, proponer un presupuesto excelente con productos REALES",
    "del catálogo de Holded (precios en vivo), aplicando las reglas y ratios de la empresa, cubriendo las",
    "necesidades dietéticas y ajustándote al presupuesto del cliente.",
    "",
    "CÓMO TRABAJAS:",
    "- Conversa en español, con tono cercano y profesional. Sé concreto y breve.",
    "- Si falta información clave del brief (tipo de evento, nº de personas, fecha, dietas, presupuesto,",
    "  zona/transporte), PREGÚNTALA antes de cerrar el presupuesto. No inventes datos del cliente.",
    "- Usa `buscar_productos` y `productos_por_dieta` para elegir productos y precios REALES. Nunca inventes SKUs ni precios.",
    "- Cada vez que definas o cambies las líneas, llama a `guardar_borrador` con items+extras+brief+notas.",
    "- Por cada comensal con dieta especial, SUSTITUYE su ración por la variante apta (no sumes de más).",
    "- Aplica las reglas de extras (envío, recogida de menaje reutilizable, colocación, camareros, carga/descarga).",
    "- Si hay dietas especiales, incluye SIEMPRE en `notas` el aviso de trazas de la empresa.",
    "- Cuando el usuario te enseñe una regla general nueva, guárdala con `aprender`.",
    "",
    `PRESUPUESTO ACTUAL: "${proposal.title}"${proposal.client_name ? ` · cliente: ${proposal.client_name}` : ""}.`,
    "",
    "=== RATIOS BASE POR PERSONA (editables, punto de partida) ===",
    ratios.length ? ratios.map(fmtRatio).join("\n") : "(sin ratios cargados)",
    "",
    "=== REGLAS DE EXTRAS Y LOGÍSTICA ===",
    reglas.map(fmtNote).join("\n"),
    "",
    "=== NOTAS Y DIRECTRICES ===",
    notas.map(fmtNote).join("\n"),
    aprendidos.length ? "\n=== APRENDIDO DE CONVERSACIONES PREVIAS ===\n" + aprendidos.map(fmtNote).join("\n") : "",
    "",
    "Listas de productos aptos por dieta: obténlas con la herramienta `productos_por_dieta`.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Ejecución de una herramienta
// ---------------------------------------------------------------------------
async function runTool(supabase: any, name: string, input: any, proposalId: string, draftRef: { value: any }) {
  if (name === "buscar_productos") {
    let q = supabase.from("holded_products").select("sku,name,price,tax,tags");
    if (input.consulta) q = q.ilike("name", `%${input.consulta}%`);
    if (Array.isArray(input.etiquetas) && input.etiquetas.length) q = q.overlaps("tags", input.etiquetas);
    q = q.limit(Math.min(input.limite ?? 25, 60));
    const { data, error } = await q;
    if (error) return { error: error.message };
    return { productos: data ?? [] };
  }

  if (name === "productos_por_dieta") {
    const { data: notes } = await supabase
      .from("budget_knowledge")
      .select("data")
      .eq("type", "dieta")
      .contains("data", { diet: input.dieta })
      .limit(1);
    const skus: string[] = notes?.[0]?.data?.skus ?? [];
    if (!skus.length) return { productos: [], nota: "No hay lista curada para esa dieta." };
    const { data: prods } = await supabase
      .from("holded_products")
      .select("sku,name,price,tax")
      .in("sku", skus);
    return { productos: prods ?? [] };
  }

  if (name === "guardar_borrador") {
    const items = Array.isArray(input.items) ? input.items : [];
    const extras = Array.isArray(input.extras) ? input.extras : [];
    const allLines = [...items, ...extras];
    let base = 0, tax = 0;
    for (const l of allLines) {
      const units = Number(l.units ?? 1) || 0;
      const price = Number(l.price ?? 0) || 0;
      const rate = Number(l.tax ?? 10) || 0;
      base += units * price;
      tax += units * price * (rate / 100);
    }
    const totals = { base: round2(base), tax: round2(tax), total: round2(base + tax) };
    const draft = { items, extras, notas: input.notas ?? "", totals };
    draftRef.value = draft;
    const patch: any = { draft, updated_at: new Date().toISOString() };
    if (input.brief && typeof input.brief === "object") patch.brief = input.brief;
    await supabase.from("budget_proposals").update(patch).eq("id", proposalId);
    return { ok: true, totals, lineas: allLines.length };
  }

  if (name === "aprender") {
    const tags = Array.isArray(input.etiquetas) ? input.etiquetas : [];
    if (!tags.includes("aprendido")) tags.push("aprendido");
    await supabase.from("budget_knowledge").insert({
      type: "nota",
      title: input.titulo,
      content: input.contenido,
      tags,
      data: { source_proposal: proposalId },
      active: true,
    });
    return { ok: true };
  }

  return { error: `herramienta desconocida: ${name}` };
}

// ---------------------------------------------------------------------------
// Llamada al modelo (una vuelta)
// ---------------------------------------------------------------------------
async function callModel(apiKey: string, model: string, system: string, messages: any[], tools: any[]) {
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({ model, max_tokens: 2048, system, tools, messages }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic ${res.status}: ${body.slice(0, 400)}`);
  }
  return await res.json();
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY no configurada" }, 500);
    const model = Deno.env.get("BUDGET_MODEL") || DEFAULT_MODEL;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // --- Autenticación: exige usuario válido (evita llamadas anónimas de pago) ---
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) return json({ error: "no autorizado" }, 401);

    const { proposalId, message, action = "chat" } = await req.json();
    if (!proposalId) return json({ error: "falta proposalId" }, 400);

    const { data: proposal, error: pErr } = await supabase
      .from("budget_proposals").select("*").eq("id", proposalId).single();
    if (pErr || !proposal) return json({ error: "presupuesto no encontrado" }, 404);

    const { data: knowledge } = await supabase
      .from("budget_knowledge").select("*").eq("active", true).order("sort_order");

    // Historial de la conversación (texto plano user/assistant)
    const { data: history } = await supabase
      .from("budget_proposal_messages")
      .select("role,content").eq("proposal_id", proposalId)
      .order("created_at").limit(40);

    const system = buildSystem(knowledge ?? [], proposal);
    const convo: any[] = (history ?? []).map((m: any) => ({ role: m.role, content: m.content }));

    // Mensaje que arranca este turno
    const userText = action === "learn"
      ? "Revisa toda nuestra conversación y extrae SOLO las reglas o preferencias generales y reutilizables " +
        "que he expresado sobre cómo elaborar presupuestos (no datos de este cliente). Guarda cada una con la " +
        "herramienta `aprender`. Si no hay ninguna nueva, dilo. Termina resumiendo qué has aprendido."
      : (message ?? "");
    if (action !== "learn" && !userText.trim()) return json({ error: "mensaje vacío" }, 400);

    // Persistimos el mensaje del usuario (en 'learn' no ensuciamos el hilo)
    if (action !== "learn") {
      await supabase.from("budget_proposal_messages").insert({
        proposal_id: proposalId, role: "user", content: userText,
      });
    }
    convo.push({ role: "user", content: userText });

    // --- Bucle agéntico de herramientas ---
    const draftRef = { value: proposal.draft ?? null };
    let learned = 0;
    let finalText = "";

    for (let step = 0; step < MAX_STEPS; step++) {
      const resp = await callModel(apiKey, model, system, convo, TOOLS);
      const blocks = resp.content ?? [];
      convo.push({ role: "assistant", content: blocks });

      const toolUses = blocks.filter((b: any) => b.type === "tool_use");
      const text = blocks.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim();
      if (text) finalText = text;

      if (resp.stop_reason !== "tool_use" || toolUses.length === 0) break;

      const results = [];
      for (const tu of toolUses) {
        if (tu.name === "aprender") learned++;
        const out = await runTool(supabase, tu.name, tu.input ?? {}, proposalId, draftRef);
        results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(out) });
      }
      convo.push({ role: "user", content: results });
    }

    if (!finalText) finalText = "(sin respuesta)";

    // Persistimos la respuesta de la IA con el snapshot del borrador
    if (action !== "learn") {
      await supabase.from("budget_proposal_messages").insert({
        proposal_id: proposalId, role: "assistant", content: finalText, draft: draftRef.value,
      });
    }

    // Releer el presupuesto (el borrador puede haber cambiado)
    const { data: fresh } = await supabase
      .from("budget_proposals").select("draft,brief,status").eq("id", proposalId).single();

    return json({
      ok: true,
      reply: finalText,
      draft: fresh?.draft ?? draftRef.value,
      brief: fresh?.brief ?? {},
      learned,
    });
  } catch (e) {
    console.error("budget-chat error:", e);
    return json({ ok: false, error: String((e as any)?.message ?? e) }, 500);
  }
});

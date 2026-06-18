import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const JINA_API_KEY = process.env.JINA_API_KEY;

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  try {
    const { website } = await req.json();
    if (!website?.trim()) {
      return json({ servicio: "su servicio principal" });
    }

    const pageContent = await scrapeWithJina(website);

    if (!pageContent || pageContent.length < 50) {
      return json({ servicio: "su servicio principal" });
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: `Analiza este contenido de una página web de una empresa o negocio y devuelve un JSON con dos campos.

${pageContent.slice(0, 4000)}

CAMPO 1 — "servicio": el servicio o producto MÁS destacado que ofrecen.
- En español, 2-5 palabras máximo.
- Ejemplos: "cirugía estética y reconstructora", "asesoría fiscal", "diseño de interiores".
- Si no puedes determinarlo, pon "su servicio principal".

CAMPO 2 — "detalle": UN dato diferenciador concreto, específico y verificable que diferencie a este negocio de un competidor grande y generalista.

REGLA DE ORO (lo más importante):
El detalle DEBE ser algo que el negocio OFRECE o HACE PARA SUS CLIENTES: un servicio, producto, especialización o capacidad concreta que un cliente contrataría o compraría.
PRUEBA MENTAL antes de devolver nada: ¿un cliente podría decir "los contraté/les compré PORQUE ofrecen [detalle]"? Si la frase no encaja ahí, NO es válido → pon null.
- "ofrecen reconstrucción mamaria" ✅ (un paciente la contrata)
- "fabrican cerramientos de malla electrosoldada" ✅ (un cliente los compra)
- "ofrecen un incentivo de la Junta de Andalucía" ❌ (nadie contrata eso; lo recibieron ellos)
- "tienen 1.200 metros cuadrados de instalaciones" ❌ (es un dato, no un servicio)

QUÉ BUSCAR (cualquier sector, en orden de preferencia):
1. Un producto, servicio o técnica específica que ofrezcan al cliente (ej: "reconstrucción mamaria post-oncológica", "cerramientos de malla electrosoldada", "alquiler de naves industriales").
2. Una especialización o nicho claro (ej: "solo cirugía facial", "inmuebles de lujo en Tortosa").
3. Antigüedad o escala como argumento de venta, SOLO si es concreta y relevante (ej: "más de 20 años", "fabricación propia").

RELEVANCIA: cuando haya varios candidatos, elige el MÁS RELEVANTE para la actividad principal del negocio, no el primero que encuentres. Prefiere el producto/servicio estrella sobre algo secundario, y una especialización concreta sobre los años.

NUNCA DEVUELVAS COMO DETALLE (si es lo único que hay → pon null):
- Subvenciones, ayudas, incentivos, premios o cofinanciación RECIBIDOS (Junta, FEDER, fondos europeos, "premio a la innovación"). Los recibió el negocio, no los ofrece.
- Datos corporativos sin servicio: metros cuadrados, superficie, facturación, nº de empleados, año de fundación (salvo que la antigüedad sea el argumento de venta).
- Generalidades vacías que diría cualquiera: "trato cercano", "equipo profesional", "atención personalizada", "tecnología de última generación", "resultados naturales", "calidad y servicio".
- Ganchos comerciales genéricos: "consulta/valoración/visita gratuita", "sin compromiso", "financiación", "presupuesto cerrado", "descuento", "promoción".

NORMALIZACIÓN DEL DETALLE (obligatorio):
- Devuélvelo en lenguaje natural y en minúsculas, como lo diría una persona hablando, NO como aparece titulado en la web.
- QUITA nombres de marca de aparatos/productos (Evolve, Morpheus8, HIFU, etc.): describe lo que HACE, no la marca. "Liposucción de papada – Evolve" → "reducción de papada sin cirugía".
- QUITA separadores y maquetación: "–", "/", "®", "™", saltos de línea.
- CONVIERTE el Title Case de la web a minúscula natural. "Lifting Sin Cirugía HIFU" → "lifting facial sin cirugía".

REGLAS DE SALIDA:
- SOLO una frase nominal corta (máximo 8 palabras), tal como la usarías dentro de otra frase. Ej: "fabricación de cerramientos de malla rígida".
- NO inventes NADA. Si no está literalmente en el texto, pon null.
- Si la web no aporta nada concreto y diferenciable, pon null.

Responde SOLO con JSON válido, sin markdown:
{"servicio": "...", "detalle": "..." o null}`,
        },
      ],
      max_tokens: 80,
      temperature: 0.2,
    });

    const raw = response.choices[0].message.content
      .trim().replace(/```json\s*/g, "").replace(/```/g, "");

    try {
      const parsed = JSON.parse(raw);
      return json({
        servicio: parsed.servicio || "su servicio principal",
        detalle: parsed.detalle || null,
      });
    } catch {
      const servicio = raw.replace(/^["']|["']$/g, "");
      return json({ servicio, detalle: null });
    }
  } catch (error) {
    console.error("[extract-service]", error.message);
    return json({ servicio: "su servicio principal" });
  }
};

async function scrapeWithJina(url) {
  try {
    const cleanUrl = url.startsWith("http") ? url : `https://${url}`;
    const res = await fetch(`https://r.jina.ai/${cleanUrl}`, {
      headers: {
        Authorization: `Bearer ${JINA_API_KEY}`,
        Accept: "text/plain",
        "X-Return-Format": "text",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      console.warn(`[jina] ${res.status} for ${url}`);
      return null;
    }

    return await res.text();
  } catch (err) {
    console.warn(`[jina] scrape failed for ${url}:`, err.message);
    return null;
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json" },
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export const config = { path: "/api/extract-service" };

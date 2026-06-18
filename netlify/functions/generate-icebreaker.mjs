import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const JINA_API_KEY = process.env.JINA_API_KEY;

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  try {
    const { companyName, city, servicio, serpResults, website, email, detalle } = await req.json();

    if (!companyName || !city || !servicio) {
      return json({ error: "companyName, city y servicio son requeridos" }, 400);
    }

    // ─── GATE 0: Descarte por placeholder / datos insuficientes ───
    const servicioLower = (servicio || "").toLowerCase().trim();
    const SERVICE_PLACEHOLDERS = [
      "su servicio principal", "servicio principal",
      "tu servicio", "vuestro servicio principal",
    ];
    const isPlaceholder = SERVICE_PLACEHOLDERS.some((p) => servicioLower.includes(p));
    const hasSerpReal = serpResults && serpResults.length > 0;

    if (isPlaceholder || !servicioLower || servicioLower.length < 3 || !hasSerpReal) {
      const reason = isPlaceholder ? "servicio no extraído (placeholder)"
        : !servicioLower || servicioLower.length < 3 ? "servicio vacío o demasiado corto"
        : "sin datos SERP reales";
      console.log(`[icebreaker] ${companyName} → SKIP: ${reason}`);
      return json({
        icebreaker: null, hasRealSerpData: false,
        serpQuery: null, leadPosition: -1,
        skipped: true, skipReason: reason,
      });
    }

    // ─── GATE 1: Sanitizar detalle (ganchos comerciales) ───
    const cleanDetalle = sanitizeDetalle(detalle);

    // Step 1: Find lead position
    const leadPosition = await findLeadPosition(
      serpResults, website, email, companyName
    );

    // Step 2: If on first page, skip — no icebreaker needed
    if (leadPosition >= 1 && leadPosition <= 10) {
      console.log(`[icebreaker] ${companyName} en posición ${leadPosition} → SKIP`);
      return json({
        icebreaker: null, hasRealSerpData: true,
        serpQuery: `${servicio} en ${city}`,
        leadPosition, skipped: true, skipReason: "ya en primera página",
      });
    }

    // Step 3: Analyze competitors
    const competitorContext = await buildCompetitorContext(
      serpResults, website, email, companyName, servicio, leadPosition
    );

    // Step 4: Generate icebreaker
    const prompt = buildPrompt(companyName, city, servicio, competitorContext, cleanDetalle);
    let icebreaker = await generateIcebreakerText(prompt);

    // ─── GATE 2: Saneado de tuteo ───
    if (containsTuteo(icebreaker)) {
      console.warn(`[icebreaker] Tuteo detectado en "${companyName}", reintentando...`);
      icebreaker = await generateIcebreakerText(prompt);
      if (containsTuteo(icebreaker)) {
        console.warn(`[icebreaker] Tuteo persiste tras reintento en "${companyName}" → revisión manual`);
        return json({
          icebreaker, hasRealSerpData: !!competitorContext,
          serpQuery: `${servicio} en ${city}`,
          leadPosition, skipped: false, needsReview: true,
        });
      }
    }

    return json({
      icebreaker, hasRealSerpData: !!competitorContext,
      serpQuery: `${servicio} en ${city}`,
      leadPosition, skipped: false,
    });
  } catch (error) {
    console.error("[generate-icebreaker]", error.message);
    return json({ error: error.message }, 500);
  }
};

// ─── VALIDATION HELPERS ───

const DETAIL_BLACKLIST = [
  "financiación", "financiar", "gratuita", "gratis", "sin compromiso",
  "presupuesto", "descuento", "oferta", "promoción", "primera consulta",
  "primera visita",
];

function sanitizeDetalle(detalle) {
  if (!detalle) return null;
  const lower = detalle.toLowerCase();
  if (DETAIL_BLACKLIST.some((term) => lower.includes(term))) {
    console.log(`[detalle] Descartado gancho comercial: "${detalle}"`);
    return null;
  }
  return detalle;
}

const TUTEO_PATTERN = /\b(tu|tus|contigo|(?<![a-záéíóú])te(?![a-záéíóúñ])|tuyo|tuya|ofreces|tienes|apareces)\b/i;

function containsTuteo(text) {
  return TUTEO_PATTERN.test(text);
}

async function generateIcebreakerText(prompt) {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 200,
    temperature: 0.7,
  });
  let text = response.choices[0].message.content
    .trim().replace(/^["']|["']$/g, "");
  if (!/[.!?]$/.test(text)) text += ".";
  return text;
}

// ─── POSITION DETECTION ───

function extractDomain(url) {
  if (!url) return "";
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return url.toLowerCase().replace(/^www\./, "").replace(/\/.*$/, "");
  }
}

function getCoreDomain(domain) {
  if (!domain) return "";
  const parts = domain.split(".");
  if (parts.length >= 2) {
    return parts[parts.length - 2];
  }
  return parts[0];
}

function getLeadDomains(website, email) {
  const domains = [];
  if (website) {
    const d = extractDomain(website);
    if (d) domains.push(d);
  }
  if (email && email.includes("@")) {
    const d = email.split("@")[1].toLowerCase().replace(/^www\./, "");
    if (d && !domains.includes(d)) domains.push(d);
  }
  return domains;
}

function domainsMatch(serpDomain, leadDomain) {
  if (!serpDomain || !leadDomain) return false;
  const a = serpDomain.toLowerCase();
  const b = leadDomain.toLowerCase();
  if (a === b) return true;
  if (a.endsWith("." + b) || b.endsWith("." + a)) return true;
  const coreA = getCoreDomain(a);
  const coreB = getCoreDomain(b);
  if (coreA && coreB && coreA === coreB && coreA.length >= 4) return true;
  return false;
}

async function findLeadPosition(serpResults, website, email, companyName) {
  if (!serpResults || serpResults.length === 0) return -1;

  const leadDomains = getLeadDomains(website, email);
  console.log(`[position] Lead: "${companyName}" | domains: [${leadDomains.join(", ")}]`);

  // Method 1: Direct domain matching
  for (let i = 0; i < serpResults.length; i++) {
    const r = serpResults[i];
    const serpDomain = (r.domain || "").toLowerCase();
    const serpUrlDomain = extractDomain(r.url || "");

    for (const ld of leadDomains) {
      if (domainsMatch(serpDomain, ld) || domainsMatch(serpUrlDomain, ld)) {
        console.log(`[position] DOMAIN MATCH at #${i + 1}: ${serpDomain} ≈ ${ld}`);
        return i + 1;
      }
    }
  }

  // Method 2: Company name in SERP title
  if (companyName && companyName.length >= 3) {
    const nameLower = companyName.toLowerCase();
    const nameWords = nameLower.split(/\s+/).filter(w => w.length >= 3 && !["dr.", "dra.", "dr", "dra", "the", "los", "las", "del", "de", "la", "el", "en", "y"].includes(w));

    for (let i = 0; i < serpResults.length; i++) {
      const titleLower = (serpResults[i].title || "").toLowerCase();
      const domainLower = (serpResults[i].domain || "").toLowerCase();

      if (titleLower.includes(nameLower)) {
        console.log(`[position] NAME MATCH (exact) at #${i + 1}: "${serpResults[i].title}"`);
        return i + 1;
      }

      if (nameWords.length >= 2) {
        const matchCount = nameWords.filter(w => titleLower.includes(w) || domainLower.includes(w)).length;
        if (matchCount >= nameWords.length) {
          console.log(`[position] NAME MATCH (words) at #${i + 1}: "${serpResults[i].title}"`);
          return i + 1;
        }
      }
    }
  }

  // Method 3: AI fallback — only when methods 1 & 2 fail, with compact list
  if (leadDomains.length > 0) {
    try {
      const compactList = serpResults.map((r, i) => `${i + 1}|${r.domain || "?"}|${(r.title || "").slice(0, 60)}`).join("\n");

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{
          role: "user",
          content: `Encuentra la posición de esta empresa en los resultados de Google.

Empresa: ${companyName}
Dominios: ${leadDomains.join(", ")}

Resultados (posición|dominio|título):
${compactList}

Busca coincidencias de dominio (con variaciones: .es/.com, con/sin www, subdominios) o nombre en título. Solo la web PROPIA, no directorios.
JSON: {"position": número o -1}`,
        }],
        max_tokens: 20,
        temperature: 0,
      });

      const raw = response.choices[0].message.content.trim().replace(/```json\s*/g, "").replace(/```/g, "");
      const parsed = JSON.parse(raw);
      if (parsed.position > 0 && parsed.position <= serpResults.length) {
        console.log(`[position] AI MATCH at #${parsed.position}: ${serpResults[parsed.position - 1]?.domain}`);
        return parsed.position;
      }
    } catch (err) {
      console.warn(`[position] AI fallback failed:`, err.message);
    }
  }

  console.log(`[position] NOT FOUND in ${serpResults.length} results`);
  return -1;
}

// ─── COMPETITOR ANALYSIS ───

async function analyzeCompetitorSite(url, serpTitle, leadServicio) {
  try {
    const cleanUrl = url.startsWith("http") ? url : `https://${url}`;
    const res = await fetch(`https://r.jina.ai/${cleanUrl}`, {
      headers: {
        Authorization: `Bearer ${JINA_API_KEY}`,
        Accept: "text/plain",
        "X-Return-Format": "text",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return { isCompetitor: false, name: null };
    const text = await res.text();
    if (!text || text.length < 30) return { isCompetitor: false, name: null };

    const analysis = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{
        role: "user",
        content: `Analiza esta web. JSON con 2 campos.

URL: ${cleanUrl}
Título: ${serpTitle || "?"}
Servicio: ${leadServicio}

Contenido:
${text.slice(0, 2000)}

1. ¿NEGOCIO REAL que ofrece "${leadServicio}"? (NO directorios, listines, periódicos, rankings)
2. Si sí, nombre real del negocio (conversacional, no Title Case artificial)

JSON: {"isCompetitor": true/false, "name": "nombre" o null}`,
      }],
      max_tokens: 60,
      temperature: 0.1,
    });

    const raw = analysis.choices[0].message.content.trim().replace(/```json\s*/g, "").replace(/```/g, "");
    const parsed = JSON.parse(raw);
    return {
      isCompetitor: !!parsed.isCompetitor,
      name: parsed.name && parsed.name.length < 60 ? parsed.name : null,
    };
  } catch (err) {
    console.warn(`[competitor] analysis failed for ${url}:`, err.message);
    return { isCompetitor: false, name: null };
  }
}

function anyDomainMatches(serpDomain, leadDomains) {
  return leadDomains.some(ld => domainsMatch(serpDomain, ld));
}

async function buildCompetitorContext(serpResults, website, email, companyName, servicio, leadPosition) {
  if (!serpResults || serpResults.length === 0) return null;

  const leadDomains = getLeadDomains(website, email);
  const firstPage = serpResults.slice(0, 10);
  const candidates = firstPage.filter((r) => {
    if (anyDomainMatches(r.domain, leadDomains)) return false;
    if (r.title?.toLowerCase().includes(companyName.toLowerCase())) return false;
    return true;
  });

  const top5 = candidates.slice(0, 5);
  const analyses = await Promise.all(
    top5.map(async (r) => {
      const url = r.url || (r.domain ? `https://${r.domain}` : null);
      if (!url) return null;
      const result = await analyzeCompetitorSite(url, r.title, servicio);
      if (!result.isCompetitor) {
        console.log(`[competitor] Descartado: ${r.domain || url}`);
        return null;
      }
      return result.name || fallbackName(r);
    })
  );

  return {
    leadPosition,
    topCompetitors: analyses.filter(Boolean).slice(0, 3),
    totalResults: serpResults.length,
  };
}

function fallbackName(result) {
  const domain = (result.domain || "").replace(/^www\./, "");
  if (domain) {
    const base = domain.split(".")[0];
    const name = base
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
    if (name.length >= 3 && name.length < 40) return name;
  }
  return null;
}

// ─── PROMPT BUILDER ───

function buildPrompt(companyName, city, servicio, competitorData, detalle) {
  const keyword = `${servicio} en ${city}`;
  const competitorsStr = competitorData?.topCompetitors?.slice(0, 2).join(" y ") || "";
  const pos = competitorData?.leadPosition ?? -1;

  let posicion;
  if (pos > 10) {
    const page = Math.ceil(pos / 10);
    posicion = `página ${page}`;
  } else if (pos === -1 || pos === 0) {
    posicion = "no aparece";
  } else {
    posicion = "página 1";
  }

  const detalleStr = detalle || "null";

  return `Eres un copywriter experto en cold email en español de España. Tu única tarea es
generar el texto del ICEBREAKER (la primera frase o dos del email, la que rompe el
hielo). Devuelve SOLO ese texto, sin saludo, sin firma, sin comillas, sin explicaciones.

═══════════════════════════════════════════
OBJETIVO
═══════════════════════════════════════════
Demostrar al lead, en 1-2 frases, que de verdad has mirado su situación en Google
hace un momento. El icebreaker solo crea cercanía y curiosidad; NO vende ni propone
nada (eso va después en el cuerpo del email).

═══════════════════════════════════════════
DATOS DISPONIBLES
═══════════════════════════════════════════
- Nombre del lead: ${companyName}
- Servicio principal del lead: ${servicio}
- Búsqueda geográfica usada en Google: "${keyword}"
- Competidores en la primera página: ${competitorsStr || "no identificados"}
- Posición del lead: ${posicion}
- Detalle real del lead: ${detalleStr}

═══════════════════════════════════════════
REGISTRO Y TIEMPO VERBAL (OBLIGATORIO — no te desvíes)
═══════════════════════════════════════════
1. PRESENTE PERFECTO SIEMPRE. Para todo lo que acabas de hacer/ver usa "he +
   participio". NUNCA pretérito indefinido.
   ✅ "He buscado", "He visto", "He encontrado", "He estado mirando",
      "Me ha llamado la atención", "Me ha sorprendido", "Me ha chocado",
      "No he conseguido dar con...", "Me ha hecho pensar"
   ❌ "Busqué", "Vi", "Encontré", "Estuve mirando", "Me llamó la atención",
      "Me sorprendió", "Me chocó", "No conseguí dar con...", "Me hizo pensar"
   (El imperfecto sí está permitido: "salían", "estabais", "se veía".)

2. TRATAMIENTO DE VOSOTROS SIEMPRE (te diriges a la clínica/equipo, no al individuo).
   ✅ "vuestra web", "lo vuestro", "os he encontrado", "no he conseguido dar con
      vosotros", "aparecéis", "ofrecéis", "tenéis", "sois"
   ❌ "tu web", "lo tuyo", "te he encontrado", "no he conseguido dar contigo",
      "apareces", "ofreces", "tienes", "eres"
   Aunque el lead sea un médico individual (Dr. X), trátalo SIEMPRE en vosotros.
   No mezcles tú y vosotros nunca.

═══════════════════════════════════════════
REGLAS DE TONO
═══════════════════════════════════════════
- Cercano y humano, como si acabaras de buscar en Google hace 5 minutos.
- Específico y verificable: menciona la búsqueda EXACTA entre comillas y 1-2
  competidores reales por su nombre.
- Observación NEUTRAL, nunca un diagnóstico de fracaso. Das el dato de la posición
  tal cual y dejas que el lead saque sus conclusiones.
- Tono de igual a igual, no de vendedor desesperado ni condescendiente.

PROHIBIDO ABSOLUTAMENTE (ni estas palabras ni nada con esta carga):
- "invisible", "nadie os encuentra", "no os ve nadie"
- "lejos de donde buscan los clientes"
- "estáis perdiendo clientes", "perdéis dinero", "os están quitando clientes"
- cualquier frase que suene a juicio, a miedo, a urgencia falsa o a culpa.

═══════════════════════════════════════════
VALIDACIÓN DE DATOS DE ENTRADA (antes de escribir)
═══════════════════════════════════════════
No te fíes ciegamente de los competidores ni del detalle: a veces vienen mal extraídos
de la web. Antes de usarlos, valida:

COMPETIDORES:
- Usa solo los que parezcan un NOMBRE PROPIO real de clínica o doctor (ej: "Clínica
  Planas", "Instituto Médico Láser", "Dr. Pérez").
- DESCARTA y NO menciones los que parezcan un título SEO o un eslogan en vez de un
  nombre (ej: "El mejor centro de cirugía estética en Granada", "Cirugía estética al
  mejor precio", "Clínica nº1 en..."). Esos no son nombres, son metadescripciones.
- Si tras descartar te queda al menos un competidor válido, usa ese. Si NO queda
  ninguno válido, no nombres a ningún competidor: reformula la frase sin nombres
  ("entre los primeros han salido varias clínicas grandes, pero a vosotros...").

DETALLE:
- Si el detalle suena a nombre de producto/marca, a eslogan o a copia literal de un
  título de web (Title Case raro, guiones, nombres de aparato), NO lo uses tal cual:
  descríbelo con tus palabras en lenguaje natural, o si no puedes, ignóralo y cierra
  con el contraste especialista/generalista o la curiosidad.

═══════════════════════════════════════════
CÓMO TRATAR CADA CASO DE POSICIÓN
═══════════════════════════════════════════
- PÁGINA 2 o más: di el dato sin coletilla ("vuestra web me ha salido en la segunda
  página", "os he encontrado algo más abajo, en la página 4").
- NO APARECE: "no he llegado a ver vuestra web en esa primera búsqueda" o "no he
  conseguido dar con vosotros en los primeros resultados". NUNCA "es invisible".
- VARIOS competidores: menciona solo 1 o 2, los que suenen más fuertes.

═══════════════════════════════════════════
CÓMO CERRAR (lo más importante)
═══════════════════════════════════════════
El cierre NO es un cumplido suelto. Debe ENLAZAR la especialización del lead con el
dato de su posición: [sois especializados/concretos] + [y aun así estáis en página X
/ no aparecéis]. Eso cierra solo y deja la curiosidad abierta.

- Si tienes detalle real del lead (no es null): úsalo como ancla concreta.
  "...y me ha sorprendido, porque ofrecéis ${detalleStr !== "null" ? detalleStr : "{detalle}"} y aun así no estabais entre los primeros."
- Contraste especialista vs generalista (cuando los de arriba son clínicas grandes):
  "...las que salían primero son clínicas grandes y generalistas; lo vuestro en
  ${servicio} se ve mucho más específico, por eso me ha chocado encontraros más abajo."
- Si NO hay detalle (es null): cierra con curiosidad honesta, sin elogios vagos.

PROHIBIDO en el cierre: elogios vagos sin anclaje ("destacable", "muy interesante",
"bastante único", "tiene mucho que ofrecer", "enfoque detallado"). Si no puedes
sostener el elogio con un dato real, NO lo pongas.

═══════════════════════════════════════════
ANTI-PLANTILLA (CRÍTICO)
═══════════════════════════════════════════
JAMÁS repitas la misma frase de cierre literal entre leads. El cierre de "curiosidad
honesta" NO es una plantilla fija: es una IDEA que debes redactar distinta cada vez.
Está PROHIBIDO usar tal cual "algo en cómo os encuentran en Google no acompaña a lo
que ofrecéis". Reformúlala con otras palabras y otra estructura en CADA lead.

Variaciones de esa idea (inspiración, NO las copies literal, genera las tuyas):
- "...y me ha extrañado que con lo específico que es lo vuestro no salgáis antes."
- "...lo que me ha hecho pensar que vuestra visibilidad online va por detrás de
  vuestro trabajo."
- "...y me ha sorprendido el desajuste entre lo que ofrecéis y dónde aparecéis."
- "...se nota que el posicionamiento no está al nivel de lo que hacéis."
- "...y me ha picado la curiosidad de por qué no estáis más arriba."

Si estás a punto de escribir un cierre parecido a otro, cámbialo entero. La variedad
entre leads es obligatoria.

═══════════════════════════════════════════
VARÍA LA APERTURA (rota, TODAS en presente perfecto y en vosotros)
═══════════════════════════════════════════
1. "He buscado '${keyword}' y me ha salido ${competitorsStr || "{competidor}"}..."
2. "He visto que ${competitorsStr || "{competidor}"} aparece de los primeros cuando buscas '${keyword}'..."
3. "He estado mirando vuestra web de ${servicio} y luego he buscado '${keyword}'..."
4. "Me ha llamado la atención una cosa buscando '${keyword}'..."
5. "Una cosa que he visto buscando '${keyword}'..."
No empieces SIEMPRE igual; alterna entre las cinco.

═══════════════════════════════════════════
EJEMPLOS
═══════════════════════════════════════════
MAL (juzga, indefinido, tuteo, sin punto final):
"Busqué 'cirugía plástica en Barcelona' y vi que Clínica Planas está primera, mientras
que tú eres invisible para los clientes en Google"

BIEN (con detalle, enlaza calidad ↔ posición, cierra con punto):
"He buscado 'cirugía plástica personalizada en Barcelona' y me ha salido Bookimed de
los primeros; vuestra web la he encontrado en la segunda página, lo cual me ha chocado
porque sois de los pocos que ofrecéis reconstrucción post-oncológica y aun así no
estabais arriba."

BIEN (contraste especialista vs generalista, sin detalle):
"He estado mirando vuestra web de medicina estética y luego he buscado 'medicina
estética en Barcelona': han salido Clínica Planas y Eimec, clínicas grandes y
generalistas, y lo vuestro se ve mucho más específico, por eso me ha chocado
encontraros más abajo."

BIEN (no aparece, curiosidad honesta y NO plantilla):
"Me ha llamado la atención una cosa buscando 'armonización facial en Barcelona': han
aparecido Doctora Blanco y Clínica Propia, pero no he conseguido dar con vosotros, y me
ha extrañado que con lo concreto que es vuestro enfoque no salgáis antes."

BIEN (ya en el top, honesto):
"He buscado 'lifting facial en Barcelona' y aparecéis de los primeros, muy bien
posicionados para esa keyword; justo por eso me ha surgido una duda sobre algo distinto."

═══════════════════════════════════════════
FORMATO DE SALIDA (OBLIGATORIO)
═══════════════════════════════════════════
- Máximo 2 frases.
- DEBE TERMINAR SIEMPRE EN PUNTO FINAL ("."). Nunca dejes la frase sin cerrar ni
  acabada en coma, punto y coma o sin signo. La última palabra va seguida de un punto.
- Solo el texto del icebreaker. Nada más.
- Español natural de España, presente perfecto, vosotros, sin sonar a IA.`;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...corsHeaders(), "Content-Type": "application/json" },
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export const config = { path: "/api/generate-icebreaker" };

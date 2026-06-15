import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  try {
    const { companyName, city, servicio, serpResults, website } = await req.json();

    if (!companyName || !city || !servicio) {
      return json({ error: "companyName, city y servicio son requeridos" }, 400);
    }

    const competitorContext = buildCompetitorContext(
      serpResults,
      website,
      companyName
    );

    const prompt = buildPrompt(companyName, city, servicio, competitorContext);

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 200,
      temperature: 0.7,
    });

    const icebreaker = response.choices[0].message.content
      .trim()
      .replace(/^["']|["']$/g, "")
      .replace(/\.$/, "");

    return json({
      icebreaker,
      hasRealSerpData: !!competitorContext,
      serpQuery: serpResults ? `${servicio} en ${city}` : null,
    });
  } catch (error) {
    console.error("[generate-icebreaker]", error.message);
    return json({ error: error.message }, 500);
  }
};

function buildCompetitorContext(serpResults, website, companyName) {
  if (!serpResults || !Array.isArray(serpResults) || serpResults.length === 0) {
    return null;
  }

  const leadDomain = website
    ? extractDomain(website)
    : companyName.toLowerCase().replace(/\s+/g, "");

  const leadPosition = serpResults.findIndex(
    (r) =>
      r.domain?.includes(leadDomain) ||
      r.url?.toLowerCase().includes(leadDomain) ||
      r.title?.toLowerCase().includes(companyName.toLowerCase())
  );

  const topCompetitors = serpResults
    .filter(
      (r) =>
        !r.domain?.includes(leadDomain) &&
        !r.title?.toLowerCase().includes(companyName.toLowerCase())
    )
    .slice(0, 3)
    .map((r) => r.title || r.domain);

  return {
    leadPosition: leadPosition >= 0 ? leadPosition + 1 : -1,
    topCompetitors,
    totalResults: serpResults.length,
  };
}

function buildPrompt(companyName, city, servicio, competitorData) {
  if (competitorData && competitorData.topCompetitors.length > 0) {
    const competitorsStr = competitorData.topCompetitors
      .slice(0, 2)
      .join(" y ");
    const positionInfo =
      competitorData.leadPosition > 0
        ? `La clínica aparece en la posición ${competitorData.leadPosition} de Google.`
        : `La clínica NO aparece en los primeros 10 resultados de Google.`;

    return `Eres un experto en copywriting de cold email B2B en español de España. Tu tarea es escribir UNA sola frase de apertura (icebreaker) para un email de prospección SEO.

DATOS REALES DE GOOGLE (usa estos datos para hacer la frase más creíble y específica):
- Búsqueda realizada: "${servicio} en ${city}"
- ${positionInfo}
- Competidores que SÍ aparecen en la primera página: ${competitorsStr}

La frase debe:
1. Mencionar que buscaste el servicio en Google en su ciudad
2. Incluir datos REALES: mencionar competidores concretos que aparecen por encima o que la clínica no aparece donde debería
3. Sonar natural y conversacional, como si lo escribiera una persona real de España
4. Tener máximo 2 líneas. Sin saludos, sin punto al final

IMPORTANTE - Lenguaje: Escribe en español de España. NUNCA uses expresiones latinoamericanas:
- "Recientemente busqué" → usa "He buscado" o "Buscando"
- "Estuve buscando" → usa "He estado buscando" o "Buscando"
- "Me sorprendió" → usa "He notado" o "Vi"
Usa siempre presente perfecto ("He buscado", "He notado") o gerundio ("Buscando").

Datos:
Clínica: ${companyName}
Ciudad: ${city}
Servicio estrella: ${servicio}

Ejemplo: "He buscado '${servicio} en ${city}' y he visto que ${competitorsStr} aparecen en primera página mientras que ${companyName} no tiene la visibilidad que merece"

Devuelve SOLO la frase. Sin comillas, sin explicaciones.`;
  }

  return `Eres un experto en copywriting de cold email B2B en español de España. Tu tarea es escribir UNA sola frase de apertura (icebreaker) para un email de prospección SEO.

Esta frase debe:
1. Mencionar que buscaste el servicio estrella de la clínica en Google en su ciudad
2. Señalar que la clínica no aparece con la visibilidad que merece
3. Sonar natural y conversacional, como si lo escribiera una persona real de España
4. Tener máximo 2 líneas. Sin saludos, sin punto al final

IMPORTANTE - Lenguaje: Escribe en español de España. NUNCA uses expresiones latinoamericanas:
- "Recientemente busqué" → usa "He buscado" o "Buscando"
- "Estuve buscando" → usa "He estado buscando" o "Buscando"
- "Me sorprendió" → usa "He notado" o "Vi"
Usa siempre presente perfecto ("He buscado", "He notado") o gerundio ("Buscando").

Datos:
Clínica: ${companyName}
Ciudad: ${city}
Servicio estrella: ${servicio}

Ejemplo: "He buscado '${servicio} en ${city}' como lo haría un paciente potencial y he notado que ${companyName} no aparece entre los primeros resultados"

Devuelve SOLO la frase. Sin comillas, sin explicaciones.`;
}

function extractDomain(url) {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return url;
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

export const config = { path: "/api/generate-icebreaker" };

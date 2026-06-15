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
          content: `Analiza este contenido de una web médica o clínica:

${pageContent.slice(0, 4000)}

Dime cuál es el servicio o tratamiento más destacado que ofrecen.
Devuelve SOLO el nombre del servicio, en español, en 2-5 palabras máximo.
Ejemplos: "rinoplastia de preservación", "medicina estética facial", "cirugía de párpados".
Si no puedes determinarlo, devuelve "su servicio principal".
No expliques nada. Solo el nombre.`,
        },
      ],
      max_tokens: 30,
      temperature: 0.3,
    });

    const servicio = response.choices[0].message.content
      .trim()
      .replace(/^["']|["']$/g, "");
    return json({ servicio });
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

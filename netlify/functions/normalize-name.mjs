import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  try {
    const { name } = await req.json();
    if (!name?.trim()) {
      return json({ error: "name es requerido" }, 400);
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: `Limpia y normaliza el nombre de esta empresa o negocio para usarlo en un email de marketing profesional en español. El valor original es: ${name}

Reglas de limpieza:
1. Si el nombre está todo junto sin espacios (ej: "Tecnologiaavanzada", "Consultoresasociados") separa correctamente las palabras y añade puntos donde corresponda (ej: "Tecnología Avanzada", "Consultores Asociados").
2. Si ya está bien escrito (ej: "Acme Corp", "Tech Solutions") devuélvelo exactamente igual.
3. Corrige mayúsculas/minúsculas si es necesario.
4. Devuelve SOLO el nombre limpio, sin explicaciones ni texto adicional.`,
        },
      ],
      max_tokens: 50,
      temperature: 0.1,
    });

    const companyName = response.choices[0].message.content.trim();
    return json({ companyName });
  } catch (error) {
    console.error("[normalize-name]", error.message);
    return json({ error: error.message }, 500);
  }
};

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

export const config = { path: "/api/normalize-name" };

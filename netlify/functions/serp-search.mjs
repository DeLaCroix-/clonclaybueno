const SERPER_API_KEY = process.env.SERPER_API_KEY;

export default async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  try {
    const { keyword, city } = await req.json();
    if (!keyword?.trim() || !city?.trim()) {
      return json({ error: "keyword y city son requeridos" }, 400);
    }

    const query = `${keyword} en ${city}`;

    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": SERPER_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: query,
        gl: "es",
        hl: "es",
        num: 10,
        type: "search",
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Serper.dev error (${res.status}): ${errText.slice(0, 300)}`);
    }

    const data = await res.json();
    const organic = (data.organic ?? [])
      .filter((r) => {
        const url = (r.link ?? "").toLowerCase();
        return (
          !url.includes("youtube.com") &&
          !url.includes("youtu.be") &&
          !url.includes("maps.google") &&
          !url.includes("google.com/maps")
        );
      })
      .slice(0, 10)
      .map((r, idx) => ({
        position: idx + 1,
        title: r.title ?? "",
        url: r.link ?? "",
        snippet: r.snippet ?? "",
        domain: extractDomain(r.link ?? ""),
      }));

    return json({ query, results: organic });
  } catch (error) {
    console.error("[serp-search]", error.message);
    return json({ error: error.message }, 500);
  }
};

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

export const config = { path: "/api/serp-search" };

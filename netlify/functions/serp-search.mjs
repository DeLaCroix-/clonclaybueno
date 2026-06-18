const SERPER_API_KEY = process.env.SERPER_API_KEY;
const MAX_PAGES = 10;
const BATCH_SIZE = 5;

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
    let allResults = [];

    // Fetch pages in batches of BATCH_SIZE in parallel
    for (let batchStart = 1; batchStart <= MAX_PAGES; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, MAX_PAGES);
      const pages = [];
      for (let p = batchStart; p <= batchEnd; p++) pages.push(p);

      const batchResults = await Promise.all(
        pages.map((page) => fetchSerpPage(query, page))
      );

      let batchEmpty = false;
      for (const organic of batchResults) {
        if (!organic || organic.length === 0) {
          batchEmpty = true;
          break;
        }
        for (const r of organic) {
          allResults.push({
            position: allResults.length + 1,
            title: r.title ?? "",
            url: r.link ?? "",
            snippet: r.snippet ?? "",
            domain: extractDomain(r.link ?? ""),
          });
        }
      }

      if (batchEmpty) break;
    }

    console.log(`[serp] "${query}" → ${allResults.length} results`);
    return json({ query, results: allResults });
  } catch (error) {
    console.error("[serp-search]", error.message);
    return json({ error: error.message }, 500);
  }
};

async function fetchSerpPage(query, page) {
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": SERPER_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query, gl: "es", hl: "es", num: 10, page }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const organic = data.organic ?? [];

    return organic.filter((r) => {
      const url = (r.link ?? "").toLowerCase();
      return !url.includes("youtube.com") && !url.includes("youtu.be") &&
        !url.includes("maps.google") && !url.includes("google.com/maps");
    });
  } catch {
    return null;
  }
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

export const config = { path: "/api/serp-search" };

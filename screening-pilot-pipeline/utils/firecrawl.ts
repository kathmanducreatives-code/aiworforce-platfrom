import { fetchJson } from "./http.js";

interface FirecrawlScrapeResponse {
  success: boolean;
  data?: {
    markdown?: string;
    metadata?: Record<string, unknown>;
  };
}

export async function firecrawlScrape(params: {
  baseUrl: string;
  apiKey: string;
  url: string;
}): Promise<{ markdown: string; metadata: Record<string, unknown> }> {
  const result = await fetchJson<FirecrawlScrapeResponse>(`${params.baseUrl}/scrape`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      url: params.url,
      formats: ["markdown"]
    })
  });

  if (!result.success || !result.data?.markdown) {
    throw new Error(`Firecrawl scrape failed for ${params.url}`);
  }

  return {
    markdown: result.data.markdown,
    metadata: result.data.metadata || {}
  };
}

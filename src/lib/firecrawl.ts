/**
 * FIRECRAWL, FROM THE BROWSER, WITHOUT A FIRECRAWL KEY.
 *
 * This module used to be a real Firecrawl client:
 *
 *     a v1 base URL, plus a VITE_-prefixed Firecrawl credential read
 *     straight from import.meta.env
 *
 * (the literal variable name is not written anywhere in this file: Vite's
 * `import.meta.env` substitution is textual and does not spare comments)
 *
 * Vite inlines every `VITE_*` value into the JavaScript it ships, so any
 * production build made in an environment carrying that variable published the
 * Firecrawl API key to every visitor — and the variable IS set in the Railway
 * environment. The key was absent from the last build only by accident of when
 * it ran.
 *
 * So the key moved server side, and this is now a thin call to the
 * `firecrawl-scrape` Edge Function, which holds `FIRECRAWL_API_KEY` and speaks
 * Firecrawl v2. Nothing here knows a Firecrawl endpoint or credential, and the
 * request is authenticated as the signed-in user by the Supabase client.
 *
 * `search` and `crawlUrl` are deliberately NOT proxied. Their only callers are
 * unreachable modules (the competitor/talent scrapers behind the unrouted
 * Talent Intelligence page), and exposing crawl or search to the browser would
 * be an open, paid proxy. They throw a message that says what to do instead.
 */
import { supabase } from "@/integrations/supabase/client";

export interface FirecrawlScrapeResult {
  success: boolean;
  data: {
    url: string;
    /** Page text. Null when the page yielded none. */
    markdown: string | null;
    /** Structured extraction, when a `prompt` was supplied. v1 called this `extract`. */
    json: Record<string, unknown> | null;
    /** v1 compatibility: the old client's callers read `data.extract`. */
    extract: Record<string, unknown> | null;
    metadata: Record<string, unknown> | null;
  } | null;
  error?: string;
}

const NOT_PROXIED = (method: string) =>
  `firecrawl.${method}() is not available in the browser. Firecrawl runs server ` +
  `side now; add it to the firecrawl-scrape Edge Function if a feature needs it.`;

class BackendFirecrawl {
  /**
   * Scrape one URL through the Edge Function.
   *
   * @param params.prompt structured-extraction prompt (v1's `extract.prompt`).
   */
  async scrapeUrl(
    url: string,
    params: { prompt?: string; extract?: { prompt?: string } } = {},
  ): Promise<FirecrawlScrapeResult> {
    const prompt = params.prompt ?? params.extract?.prompt;
    const { data, error } = await supabase.functions.invoke("firecrawl-scrape", {
      body: { url, ...(prompt ? { prompt } : {}) },
    });
    if (error) throw new Error(`Firecrawl request failed: ${error.message}`);
    const r = data as { ok?: boolean; error?: string; data?: Record<string, unknown> } | null;
    if (!r?.ok) {
      // The function distinguishes "not configured" from "provider refused";
      // both must surface, because neither is an empty page.
      throw new Error(r?.error ?? "firecrawl_failed");
    }
    const d = r.data ?? {};
    const extracted = (d.json ?? null) as Record<string, unknown> | null;
    return {
      success: true,
      data: {
        url: String(d.url ?? url),
        markdown: (d.markdown as string) ?? null,
        json: extracted,
        extract: extracted,
        metadata: (d.metadata as Record<string, unknown>) ?? null,
      },
    };
  }

  search(_query: string, _params: unknown = {}): Promise<never> {
    return Promise.reject(new Error(NOT_PROXIED("search")));
  }

  crawlUrl(_url: string, _params: unknown = {}): Promise<never> {
    return Promise.reject(new Error(NOT_PROXIED("crawlUrl")));
  }
}

export const firecrawl = new BackendFirecrawl();

// firecrawl-scrape — THE ONLY PLACE THE BROWSER MAY REACH FIRECRAWL.
//
// `src/lib/firecrawl.ts` used to hold a Firecrawl client that read
// `import.meta.env.VITE_FIRECRAWL_API_KEY`. Vite INLINES every `VITE_*` value
// into the bundle it ships, so any production build made in an environment that
// carried that variable published the Firecrawl API key to every visitor. The
// key was not in the last build only because the variable happened to be unset
// when it ran — it is set in the Railway environment, so the leak was one build
// away.
//
// The key now lives here, server side, and the browser asks this function
// instead. That also moves the call from Firecrawl v1 (which the browser client
// used) to v2, which is what the rest of this codebase already speaks.
//
// SCOPE, deliberately narrow: one URL, one scrape. No crawl, no search — the
// only live caller was the job-distribution sync, and a crawl endpoint exposed
// to the browser is an open proxy with somebody else's bill attached.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { allowedScrapeUrl, boundedPrompt } from "../_shared/firecrawlRequestGuard.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const FIRECRAWL_V2 = "https://api.firecrawl.dev/v2";
/** A scrape is a paid page read; the browser does not get to pick a bigger one. */
const TIMEOUT_MS = 60_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // AUTHENTICATED CALLERS ONLY. An unauthenticated scrape endpoint is a paid
  // open proxy: anyone could spend this workspace's Firecrawl credits.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ ok: false, error: "unauthorized" }, 401);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: uerr } = await userClient.auth.getUser(authHeader.replace("Bearer ", ""));
  if (uerr || !userData?.user?.id) return json({ ok: false, error: "unauthorized" }, 401);

  const key = Deno.env.get("FIRECRAWL_API_KEY");
  if (!key) return json({ ok: false, error: "firecrawl_not_configured" }, 503);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ ok: false, error: "invalid_json_body" }, 400); }

  const url = allowedScrapeUrl(body.url);
  if (!url) return json({ ok: false, error: "invalid_url" }, 400);

  // v1's `formats: ["extract"]` became v2's json format. The prompt is the
  // caller's; the SHAPE is ours, so a caller cannot ask for an unbounded job.
  const prompt = boundedPrompt(body.prompt);
  const formats: unknown[] = ["markdown"];
  if (prompt) formats.push({ type: "json", prompt });

  try {
    const res = await fetch(`${FIRECRAWL_V2}/scrape`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url: url.toString(), formats, onlyMainContent: true }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const payload = await res.json().catch(() => null) as
      | { success?: boolean; data?: Record<string, unknown>; error?: string }
      | null;

    // A PROVIDER FAILURE IS NOT A SUCCESS WITH EMPTY DATA. The caller must be
    // able to tell "the page said nothing" from "Firecrawl refused".
    if (!res.ok || !payload || payload.success === false) {
      return json({
        ok: false, error: "firecrawl_failed", status: res.status,
        detail: String(payload?.error ?? "").slice(0, 300),
      }, 502);
    }
    const data = payload.data ?? {};
    return json({
      ok: true,
      data: {
        url: url.toString(),
        markdown: data.markdown ?? null,
        json: data.json ?? null,
        metadata: data.metadata ?? null,
      },
    });
  } catch (e) {
    const aborted = e instanceof Error && e.name === "TimeoutError";
    return json({ ok: false, error: aborted ? "firecrawl_timeout" : "firecrawl_unreachable" }, 504);
  }
});

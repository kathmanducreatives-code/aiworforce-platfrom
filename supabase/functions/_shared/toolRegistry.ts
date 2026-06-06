// Shared backend tool registry for the AI workforce.
// All external tool calls go through `runTool` so that:
//   - tool_calls rows are written (queued → running → succeeded|failed|unavailable)
//   - activity_feed gets a "tool_used" or "tool_failed" entry
//   - allowed_agents is enforced server-side
//   - missing API keys produce a graceful "unavailable" instead of a crash
//
// Edge functions import this with a relative path:
//   import { runTool } from "../_shared/toolRegistry.ts";

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ACTOR_REGISTRY, getActorByKey, isActorRuntimeEnabled } from "./actorRegistry.ts";

export interface ToolContext {
  admin: SupabaseClient;
  workspace_id: string;
  agent_slug: string;
  agent_id: string | null;
  agent_name?: string;
  plan_id?: string | null;
  task_id?: string | null;
  user_id?: string | null;
}

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
  unavailable?: boolean;
  awaiting_approval?: boolean;
}

interface ToolDef {
  name: string;
  provider: string;
  description: string;
  allowed_agents: string[];
  requires_approval: boolean;
  execute: (input: unknown, ctx: ToolContext) => Promise<ToolResult>;
}

// ---------- Tool: research_web (Perplexity) ----------

async function execResearchWeb(input: unknown): Promise<ToolResult> {
  const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");
  if (!PERPLEXITY_API_KEY) {
    return { ok: false, unavailable: true, error: "PERPLEXITY_API_KEY not configured" };
  }

  const i = (input ?? {}) as { query?: string; recency?: string };
  const query = (i.query ?? "").toString().trim();
  if (!query) return { ok: false, error: "missing 'query'" };

  const body: Record<string, unknown> = {
    model: "sonar",
    messages: [
      { role: "system", content: "Be precise, concise, and factual. Cite sources." },
      { role: "user", content: query },
    ],
  };
  if (i.recency) body.search_recency_filter = i.recency;

  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25_000);
    try {
      const res = await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      clearTimeout(timer);
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        return {
          ok: true,
          data: {
            content: data?.choices?.[0]?.message?.content ?? "",
            citations: Array.isArray(data?.citations) ? data.citations : [],
            model: data?.model,
          },
        };
      }
      if (res.status >= 500 && attempt === 0) {
        await new Promise((r) => setTimeout(r, 800));
        continue;
      }
      return { ok: false, error: `Perplexity ${res.status}: ${JSON.stringify(data?.error ?? data)}` };
    } catch (e) {
      clearTimeout(timer);
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 800));
        continue;
      }
      return { ok: false, error: `Perplexity fetch failed: ${String(e)}` };
    }
  }
  return { ok: false, error: "Perplexity retry exhausted" };
}

// ---------- Tool: scrape_url (Firecrawl v2) ----------

const FIRECRAWL_V2 = "https://api.firecrawl.dev/v2";

function isValidHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function truncate(s: unknown, max = 6000): string {
  const str = typeof s === "string" ? s : "";
  return str.length > max ? str.slice(0, max) + "\n…[truncated]" : str;
}

async function firecrawlFetch(
  apiKey: string,
  path: string,
  body: unknown,
  timeoutMs = 25_000,
): Promise<{ ok: boolean; status: number; data: any }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${FIRECRAWL_V2}${path}`, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

async function firecrawlGet(
  apiKey: string,
  path: string,
  timeoutMs = 10_000,
): Promise<{ ok: boolean; status: number; data: any }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${FIRECRAWL_V2}${path}`, {
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

async function execScrapeUrl(input: unknown): Promise<ToolResult> {
  const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
  if (!FIRECRAWL_API_KEY) {
    return { ok: false, unavailable: true, error: "FIRECRAWL_API_KEY not configured" };
  }

  const i = (input ?? {}) as { url?: string; extraction_goal?: string; max_pages?: number };
  const url = (i.url ?? "").toString().trim();
  const extraction_goal = (i.extraction_goal ?? "").toString();
  const max_pages = Math.min(5, Math.max(1, Number(i.max_pages) || 1));

  if (!url) return { ok: false, error: "missing 'url'" };
  if (!isValidHttpUrl(url)) return { ok: false, error: "invalid_url" };

  // Single-page scrape
  if (max_pages === 1) {
    let last: { ok: boolean; status: number; data: any } | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        last = await firecrawlFetch(FIRECRAWL_API_KEY, "/scrape", {
          url,
          formats: ["markdown", "summary"],
          onlyMainContent: true,
        });
        if (last.ok) break;
        if (last.status >= 500 && attempt === 0) {
          await new Promise((r) => setTimeout(r, 800));
          continue;
        }
        break;
      } catch (e) {
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 800));
          continue;
        }
        return { ok: false, error: `Firecrawl fetch failed: ${String(e)}` };
      }
    }
    if (!last) return { ok: false, error: "Firecrawl no response" };
    if (last.status === 402) {
      return { ok: false, unavailable: true, error: "firecrawl_insufficient_credits" };
    }
    if (last.status === 401 || last.status === 403) {
      return { ok: false, unavailable: true, error: "firecrawl_unauthorized" };
    }
    if (!last.ok) {
      return { ok: false, error: `Firecrawl ${last.status}: ${JSON.stringify(last.data?.error ?? last.data).slice(0, 300)}` };
    }
    // v2 returns { success, data: { markdown, summary, metadata } }
    const doc = last.data?.data ?? last.data ?? {};
    const metadata = doc.metadata ?? {};
    return {
      ok: true,
      data: {
        url,
        source_url: metadata.sourceURL ?? url,
        title: metadata.title ?? null,
        markdown: truncate(doc.markdown, 12_000),
        summary: doc.summary ?? null,
        metadata,
        extraction_goal,
      },
    };
  }

  // Multi-page crawl
  const startRes = await firecrawlFetch(FIRECRAWL_API_KEY, "/crawl", {
    url,
    limit: max_pages,
    scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
  }).catch((e) => ({ ok: false, status: 0, data: { error: String(e) } }));

  if (startRes.status === 402) return { ok: false, unavailable: true, error: "firecrawl_insufficient_credits" };
  if (startRes.status === 401 || startRes.status === 403) return { ok: false, unavailable: true, error: "firecrawl_unauthorized" };
  if (!startRes.ok) return { ok: false, error: `Firecrawl crawl ${startRes.status}` };

  const jobId = startRes.data?.id ?? startRes.data?.data?.id;
  if (!jobId) {
    // Some responses return data inline.
    const docs = startRes.data?.data ?? [];
    return {
      ok: true,
      data: {
        url,
        source_url: url,
        extraction_goal,
        pages: (Array.isArray(docs) ? docs : []).map((d: any) => ({
          url: d?.metadata?.sourceURL ?? null,
          markdown: truncate(d?.markdown, 6000),
          metadata: d?.metadata ?? {},
        })),
      },
    };
  }

  // Poll up to ~25s
  const deadline = Date.now() + 25_000;
  let status: any = null;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const s = await firecrawlGet(FIRECRAWL_API_KEY, `/crawl/${jobId}`).catch(() => null);
    if (!s) continue;
    status = s.data;
    if (status?.status === "completed" || status?.status === "failed") break;
  }

  const docs = Array.isArray(status?.data) ? status.data : [];
  return {
    ok: true,
    data: {
      url,
      source_url: url,
      extraction_goal,
      partial: status?.status !== "completed",
      pages: docs.slice(0, max_pages).map((d: any) => ({
        url: d?.metadata?.sourceURL ?? null,
        markdown: truncate(d?.markdown, 6000),
        metadata: d?.metadata ?? {},
      })),
      truncated: docs.length > max_pages,
    },
  };
}

// ---------- Tool: source_with_apify (Apify) ----------

const APIFY_BASE = "https://api.apify.com/v2";

// Actor catalog. Fill `actor_id` once the user provides the Apify actor for that source_type.
// `null` => unavailable for that source_type until configured.
type ApifyActorCfg = {
  actor_id: string | null;
  description: string;
  source_type?: string;
  enabled_by_default?: boolean;
  use_for?: string[];
  input_adapter?: (i: {
    query?: string | null;
    location?: string | null;
    role_keywords?: string[] | null;
    max_results: number;
    user_input?: Record<string, unknown>;
  }) => Record<string, unknown>;
};

function buildLinkedInJobsSearchUrl(keywords: string | null | undefined, location: string | null | undefined): string {
  const params = new URLSearchParams();
  if (keywords && keywords.trim()) params.set("keywords", keywords.trim());
  if (location && location.trim()) params.set("location", location.trim());
  params.set("position", "1");
  params.set("pageNum", "0");
  return `https://www.linkedin.com/jobs/search/?${params.toString()}`;
}

// Apify actor registry. Apify is reserved for structured sourcing actors
// (jobs/hiring/company data). Broad web search stays on `search_web`
// (Gemini/Lovable grounded search) — `apify/google-search-scraper` is an
// opt-in fallback only and is disabled by default.
const APIFY_ACTORS: Record<string, ApifyActorCfg> = {
  jobs: {
    actor_id: "curious_coder/linkedin-jobs-scraper",
    source_type: "jobs",
    enabled_by_default: true,
    use_for: ["hiring signals", "companies hiring roles", "job openings"],
    description: "LinkedIn jobs search with company details",
    input_adapter: ({ query, location, role_keywords, max_results, user_input }) => {
      const kwFromRoles = Array.isArray(role_keywords) && role_keywords.length > 0
        ? role_keywords.join(" ")
        : null;
      const keywords = (user_input?.keywords as string | undefined)
        ?? kwFromRoles
        ?? query
        ?? null;
      const urls = Array.isArray(user_input?.urls) && (user_input!.urls as unknown[]).length > 0
        ? (user_input!.urls as string[])
        : [buildLinkedInJobsSearchUrl(keywords, location)];
      // Actor minimum is 10.
      const count = Math.max(10, Math.min(100, max_results));
      return {
        urls,
        count,
        scrapeCompany: user_input?.scrapeCompany ?? true,
      };
    },
  },
  indeed_jobs: {
    actor_id: "curious_coder/indeed-scraper",
    source_type: "indeed_jobs",
    enabled_by_default: false,
    use_for: ["Indeed jobs", "non-LinkedIn hiring signals", "backup jobs source"],
    description: "Indeed jobs scraper (backup hiring source)",
  },
  website_content: {
    actor_id: "apify/website-content-crawler",
    source_type: "website_content",
    enabled_by_default: false,
    use_for: ["website content fallback if Firecrawl fails"],
    description: "Website content crawler — fallback if Firecrawl fails",
  },
  custom_web: {
    actor_id: "apify/web-scraper",
    source_type: "custom_web",
    enabled_by_default: false,
    use_for: ["custom websites", "directories", "niche job boards"],
    description: "Generic web scraper for niche/custom sites",
  },
  search_fallback: {
    actor_id: "apify/google-search-scraper",
    source_type: "search",
    enabled_by_default: false,
    use_for: ["optional fallback only if grounded search is unavailable and user explicitly enables it"],
    description: "Google SERP via Apify — opt-in fallback only",
  },
};

// Alias map: planner / agent vocabularies often differ from the actor registry keys.
// Anything that means "find companies hiring people" routes to the jobs actor today,
// since no people/profile actor is configured yet.
const SOURCE_TYPE_ALIASES: Record<string, string> = {
  jobs: "jobs",
  job: "jobs",
  hiring: "jobs",
  hiring_signals: "jobs",
  job_search: "jobs",
  linkedin_jobs: "jobs",
  companies_hiring: "jobs",
  source_companies: "jobs",
  source_candidates: "jobs",
  candidates: "jobs",
  candidate: "jobs",
  people: "jobs",
  person: "jobs",
  profiles: "jobs",
  profile: "jobs",
  engineers: "jobs",
  engineer: "jobs",
  developers: "jobs",
  developer: "jobs",
  marketers: "jobs",
  marketer: "jobs",
  roles: "jobs",
  role: "jobs",
  companies: "jobs",
  company: "jobs",
  founders: "jobs",
  founder: "jobs",
  generic: "jobs",
  indeed_jobs: "indeed_jobs",
  website_content: "website_content",
  custom_web: "custom_web",
  search: "search_fallback",
  search_fallback: "search_fallback",
};

export function normalizeApifySourceType(raw?: string | null): string {
  const k = (raw ?? "").toString().trim().toLowerCase();
  if (!k) return "jobs";
  if (SOURCE_TYPE_ALIASES[k]) return SOURCE_TYPE_ALIASES[k];
  if (APIFY_ACTORS[k]) return k;
  return "jobs";
}

// Actors that must NEVER run without explicit opt-in, regardless of how
// the orchestrator/planner resolved them. Guards against silently using
// Apify as the default broad-search lane.
const OPT_IN_ONLY_ACTOR_IDS = new Set<string>(["apify/google-search-scraper"]);


const APIFY_ACTOR_ID_RE = /^[a-zA-Z0-9_~][a-zA-Z0-9_\-~]{0,127}(?:\/[a-zA-Z0-9_\-~]+)?$/;

function signalFromSourceType(source_type: string): string {
  switch (source_type) {
    case "jobs":           return "hiring";
    case "linkedin_posts": return "post";
    case "companies":      return "company";
    case "comments":       return "comment";
    case "websites":       return "website";
    default:               return "generic";
  }
}

function pickStr(obj: any, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function truncObj(v: unknown, max = 4000): unknown {
  try {
    const s = JSON.stringify(v);
    if (s.length <= max) return v;
    return { _truncated: true, preview: s.slice(0, max) };
  } catch {
    return { _unserializable: true };
  }
}

function normalizeApifyItem(raw: any, source_type: string) {
  const r = raw && typeof raw === "object" ? raw : {};
  return {
    name:        pickStr(r, ["name", "fullName", "authorName", "personName"]),
    company:     pickStr(r, ["companyName", "company", "employer", "organization", "org"]),
    title:       pickStr(r, ["title", "jobTitle", "position", "headline", "postTitle"]),
    url:         pickStr(r, ["url", "link", "jobUrl", "postUrl", "profileUrl", "sourceUrl"]),
    location:    pickStr(r, ["location", "city", "jobLocation", "geo", "place"]),
    description: pickStr(r, ["description", "snippet", "text", "summary", "body"]),
    source:      "apify",
    signal_type: signalFromSourceType(source_type),
    confidence:  null,
    raw:         truncObj(r, 4000),
  };
}

async function apifyFetch(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<{ ok: boolean; status: number; data: any }> {
  const { timeoutMs = 20_000, ...rest } = init;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${APIFY_BASE}${path}`, { ...rest, signal: ctrl.signal });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

async function execSourceWithApify(input: unknown): Promise<ToolResult> {
  const APIFY_API_TOKEN = Deno.env.get("APIFY_API_TOKEN");
  if (!APIFY_API_TOKEN) {
    return { ok: false, unavailable: true, error: "apify_not_configured" };
  }

  const i = (input ?? {}) as {
    actor_id?: string;
    source_type?: string;
    search_goal?: string;
    query?: string;
    location?: string;
    role_keywords?: string[];
    max_results?: number;
    input?: Record<string, unknown>;
    allow_disabled?: boolean;
  };

  const requested_source_type = (i.source_type ?? null) as string | null;
  const source_type = normalizeApifySourceType(requested_source_type ?? "jobs");
  const max_results = Math.min(100, Math.max(1, Number(i.max_results) || 25));
  const search_goal = (i.search_goal ?? "").toString();
  const allow_disabled = i.allow_disabled === true;

  let actor_id = (i.actor_id ?? "").toString().trim();
  let actorCfg: ApifyActorCfg | undefined;
  if (actor_id) {
    if (!APIFY_ACTOR_ID_RE.test(actor_id)) return { ok: false, error: "invalid_actor_id" };
    actorCfg = Object.values(APIFY_ACTORS).find((c) => c.actor_id === actor_id);
  } else {
    const cfg = APIFY_ACTORS[source_type];
    if (!cfg?.actor_id) {
      return {
        ok: false,
        unavailable: true,
        error: "apify_actor_not_configured",
        data: {
          requested_source_type,
          normalized_source_type: source_type,
          expected_actor_key: source_type,
          actor_configured: false,
          message: `No Apify actor configured for source_type=${source_type} (requested=${requested_source_type ?? "null"}).`,
        },
      };
    }
    actor_id = cfg.actor_id;
    actorCfg = cfg;
  }

  // Hard gate: opt-in-only actors (e.g. google-search-scraper) never run without explicit allow_disabled.
  if (OPT_IN_ONLY_ACTOR_IDS.has(actor_id) && !allow_disabled) {
    return {
      ok: false,
      unavailable: true,
      error: "apify_actor_disabled_by_default",
      data: {
        actor_id,
        source_type: actorCfg?.source_type ?? source_type,
        use_for: actorCfg?.use_for ?? [],
        message:
          "apify/google-search-scraper is opt-in only. Use grounded search_web for broad research, or pass allow_disabled: true to force this actor.",
      },
    };
  }

  // Soft gate: any registry actor marked enabled_by_default: false requires opt-in.
  if (actorCfg && actorCfg.enabled_by_default === false && !allow_disabled) {
    return {
      ok: false,
      unavailable: true,
      error: "apify_actor_disabled_by_default",
      data: {
        actor_id,
        source_type: actorCfg.source_type ?? source_type,
        use_for: actorCfg.use_for ?? [],
        message: `Apify actor ${actor_id} is opt-in only. Pass allow_disabled: true to enable.`,
      },
    };
  }


  // Apify accepts `username~actor-name` or actorId in the URL path.
  const actorPath = encodeURIComponent(actor_id.replace("/", "~"));

  const userInput = (i.input && typeof i.input === "object") ? (i.input as Record<string, unknown>) : {};
  const actorInput: Record<string, unknown> = actorCfg?.input_adapter
    ? actorCfg.input_adapter({
        query: i.query ?? search_goal ?? null,
        location: i.location ?? null,
        role_keywords: Array.isArray(i.role_keywords) ? i.role_keywords : null,
        max_results,
        user_input: userInput,
      })
    : {
        query: i.query ?? search_goal ?? null,
        location: i.location ?? null,
        role_keywords: Array.isArray(i.role_keywords) ? i.role_keywords : null,
        max_results,
        ...userInput,
      };

  const startRes = await apifyFetch(`/acts/${actorPath}/runs?token=${APIFY_API_TOKEN}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(actorInput),
    timeoutMs: 20_000,
  }).catch((e) => ({ ok: false, status: 0, data: { error: String(e) } }));

  if (startRes.status === 401 || startRes.status === 403) {
    return { ok: false, unavailable: true, error: "apify_unauthorized" };
  }
  if (startRes.status === 402) {
    return { ok: false, unavailable: true, error: "apify_insufficient_credits" };
  }
  if (!startRes.ok) {
    return { ok: false, error: `apify_start_failed:${startRes.status}` };
  }

  const run = startRes.data?.data ?? startRes.data ?? {};
  const run_id: string | undefined = run.id;
  const dataset_id: string | undefined = run.defaultDatasetId;
  if (!run_id) return { ok: false, error: "apify_missing_run_id" };

  const deadline = Date.now() + 90_000;
  let status: string = run.status ?? "READY";
  let finalRun: any = run;
  while (Date.now() < deadline) {
    if (status === "SUCCEEDED" || status === "FAILED" || status === "TIMED-OUT" || status === "ABORTED") break;
    await new Promise((r) => setTimeout(r, 3000));
    const poll = await apifyFetch(`/actor-runs/${run_id}?token=${APIFY_API_TOKEN}`, {
      method: "GET",
      timeoutMs: 10_000,
    }).catch(() => null);
    if (!poll) continue;
    if (poll.status === 401 || poll.status === 403) {
      return { ok: false, unavailable: true, error: "apify_unauthorized", data: { run_id } };
    }
    finalRun = poll.data?.data ?? poll.data ?? finalRun;
    status = finalRun?.status ?? status;
  }

  const resolvedDatasetId: string | undefined = finalRun?.defaultDatasetId ?? dataset_id;

  if (status !== "SUCCEEDED") {
    return {
      ok: false,
      error: `apify_run_${(status || "timeout").toLowerCase()}`,
      data: { run_id, dataset_id: resolvedDatasetId, status },
    };
  }

  if (!resolvedDatasetId) {
    return {
      ok: true,
      data: { actor_id, run_id, dataset_id: null, items: [], total: 0, summary: "no_dataset", citations: [] },
    };
  }

  const itemsRes = await apifyFetch(
    `/datasets/${resolvedDatasetId}/items?clean=true&limit=${max_results}&token=${APIFY_API_TOKEN}`,
    { method: "GET", timeoutMs: 20_000 },
  ).catch((e) => ({ ok: false, status: 0, data: { error: String(e) } }));

  if (!itemsRes.ok) {
    return {
      ok: false,
      error: `apify_items_failed:${itemsRes.status}`,
      data: { run_id, dataset_id: resolvedDatasetId },
    };
  }

  const rawItems: any[] = Array.isArray(itemsRes.data) ? itemsRes.data : [];
  const items = rawItems.slice(0, max_results).map((r) => normalizeApifyItem(r, source_type));
  const citations = items.map((it) => it.url).filter((u): u is string => !!u).slice(0, 10);

  return {
    ok: true,
    data: {
      actor_id,
      requested_source_type,
      normalized_source_type: source_type,
      expected_actor_key: source_type,
      actor_configured: true,
      run_id,
      dataset_id: resolvedDatasetId,
      items,
      total: items.length,
      summary: `Apify actor returned ${items.length} ${source_type} result(s) for: ${search_goal || i.query || "(no goal)"}`,
      citations,
    },
  };
}

// ---------- Tool: send_email (Resend) — approval-gated stub ----------

async function execSendEmail(input: unknown): Promise<ToolResult> {
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) return { ok: false, unavailable: true, error: "RESEND_API_KEY not configured" };
  const i = (input ?? {}) as { to?: string; subject?: string; html?: string; from?: string };
  if (!i.to || !i.subject || !i.html) return { ok: false, error: "missing to/subject/html" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: i.from ?? "Workforce <onboarding@resend.dev>",
        to: [i.to],
        subject: i.subject,
        html: i.html,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: `Resend ${res.status}` };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: `Resend fetch failed: ${String(e)}` };
  }
}

// ---------- Tool: search_web (broad grounded web search) ----------
// Placeholder: returns `unavailable` unless a real grounded-search backend
// (e.g. Gemini Enterprise webGroundingSpec) is wired up. This lets the
// orchestrator honestly report "broad web search unavailable" without
// pretending Perplexity is the only option.
async function execSearchWeb(_input: unknown): Promise<ToolResult> {
  return {
    ok: false,
    unavailable: true,
    error: "broad_web_search_not_configured",
  };
}

// ---------- Registry ----------

const REGISTRY: Record<string, ToolDef> = {
  research_web: {
    name: "research_web",
    provider: "perplexity",
    description: "Optional fallback: live web research with citations via Perplexity Sonar. Prefer source_with_apify for hiring/company signals and scrape_url for specific URLs.",
    allowed_agents: ["hawk", "scout"],
    requires_approval: false,
    execute: execResearchWeb,
  },
  search_web: {
    name: "search_web",
    provider: "gemini_search",
    description: "Broad grounded web search (Gemini/Lovable). Reports unavailable until a grounded-search backend is configured.",
    allowed_agents: ["hawk", "scout"],
    requires_approval: false,
    execute: execSearchWeb,
  },
  scrape_url: {
    name: "scrape_url",
    provider: "firecrawl",
    description: "Primary tool for URL/page extraction — scrape a single URL to markdown via Firecrawl.",
    allowed_agents: ["hawk", "scout"],
    requires_approval: false,
    execute: execScrapeUrl,
  },
  source_with_apify: {
    name: "source_with_apify",
    provider: "apify",
    description: "Primary tool for hiring/company/job/lead signal sourcing — runs an Apify actor.",
    allowed_agents: ["scout", "hawk"],
    requires_approval: false,
    execute: execSourceWithApify,
  },
  send_email: {
    name: "send_email",
    provider: "resend",
    description: "Send a transactional email via Resend (approval-gated).",
    allowed_agents: ["penn"],
    requires_approval: true,
    execute: execSendEmail,
  },
};

const TOOL_ENV: Record<string, string> = {
  research_web: "PERPLEXITY_API_KEY",
  search_web: "GEMINI_SEARCH",
  scrape_url: "FIRECRAWL_API_KEY",
  source_with_apify: "APIFY_API_TOKEN",
  send_email: "RESEND_API_KEY",
};

export function isToolConfigured(name: string): { ready: boolean; env?: string } {
  const env = TOOL_ENV[name];
  if (!env) return { ready: true };
  return { ready: !!Deno.env.get(env), env };
}

export function listTools() {
  return Object.values(REGISTRY).map((t) => ({
    name: t.name,
    provider: t.provider,
    allowed_agents: t.allowed_agents,
    requires_approval: t.requires_approval,
  }));
}


// ---------- Main entry point ----------

export async function runTool(
  toolName: string,
  input: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tool = REGISTRY[toolName];
  if (!tool) {
    console.error("[toolRegistry] tool_not_found:", toolName);
    return { ok: false, error: `tool_not_found:${toolName}` };
  }

  if (!tool.allowed_agents.includes(ctx.agent_slug)) {
    console.warn("[toolRegistry] tool_forbidden:", { tool: toolName, agent: ctx.agent_slug });
    await logToolCall(ctx, tool, input, {
      ok: false,
      error: `agent '${ctx.agent_slug}' not allowed to use '${toolName}'`,
    }, "failed");
    return { ok: false, error: "tool_forbidden" };
  }

  // Insert queued row + write activity.
  const startedAt = new Date().toISOString();
  const { data: row } = await ctx.admin
    .from("tool_calls")
    .insert({
      workspace_id: ctx.workspace_id,
      plan_id: ctx.plan_id ?? null,
      task_id: ctx.task_id ?? null,
      agent_id: ctx.agent_id ?? null,
      tool_name: tool.name,
      provider: tool.provider,
      input_json: safeJson(input),
      status: "running",
      started_at: startedAt,
      created_by: ctx.user_id ?? null,
    })
    .select("id")
    .single();

  // Approval gate — refuse to execute, create approval, return awaiting_approval.
  if (tool.requires_approval) {
    await ctx.admin.from("approvals").insert({
      workspace_id: ctx.workspace_id,
      plan_id: ctx.plan_id ?? null,
      task_id: ctx.task_id ?? null,
      agent_id: ctx.agent_id ?? null,
      title: `${ctx.agent_name ?? ctx.agent_slug} requests ${tool.name}`,
      description: `Approval required to execute ${tool.name} via ${tool.provider}.`,
      status: "pending",
    });
    if (row?.id) {
      await ctx.admin.from("tool_calls").update({ status: "queued" }).eq("id", row.id);
    }
    await ctx.admin.from("activity_feed").insert({
      workspace_id: ctx.workspace_id,
      plan_id: ctx.plan_id ?? null,
      agent_id: ctx.agent_id ?? null,
      event_type: "tool_awaiting_approval",
      title: `${ctx.agent_name ?? ctx.agent_slug} ${tool.name} awaiting approval`,
      body: `${tool.name} requires approval before running.`,
      metadata: { tool: tool.name, provider: tool.provider, tool_call_id: row?.id },
    });
    return { ok: false, awaiting_approval: true, error: "awaiting_approval" };
  }

  // Execute.
  let result: ToolResult;
  try {
    result = await tool.execute(input, ctx);
  } catch (e) {
    result = { ok: false, error: `tool_threw:${String(e)}` };
  }

  const status = result.ok ? "succeeded" : result.unavailable ? "unavailable" : "failed";
  const completedAt = new Date().toISOString();

  if (row?.id) {
    await ctx.admin.from("tool_calls").update({
      status,
      output_json: safeJson(result.data ?? null),
      error: result.error ?? null,
      completed_at: completedAt,
    }).eq("id", row.id);
  }

  await ctx.admin.from("activity_feed").insert({
    workspace_id: ctx.workspace_id,
    plan_id: ctx.plan_id ?? null,
    agent_id: ctx.agent_id ?? null,
    event_type: result.ok ? "tool_used" : "tool_failed",
    title: `${ctx.agent_name ?? ctx.agent_slug} ${result.ok ? "used" : "could not use"} ${tool.name}`,
    body: result.ok
      ? `${tool.provider} responded successfully.`
      : result.unavailable
        ? `${tool.provider} is not configured. ${result.error ?? ""}`
        : `${tool.provider} failed: ${result.error ?? "unknown"}`,
    metadata: {
      tool: tool.name,
      provider: tool.provider,
      tool_call_id: row?.id ?? null,
      status,
    },
  });

  return result;
}

async function logToolCall(
  ctx: ToolContext,
  tool: ToolDef,
  input: unknown,
  result: ToolResult,
  status: string,
) {
  try {
    await ctx.admin.from("tool_calls").insert({
      workspace_id: ctx.workspace_id,
      plan_id: ctx.plan_id ?? null,
      task_id: ctx.task_id ?? null,
      agent_id: ctx.agent_id ?? null,
      tool_name: tool.name,
      provider: tool.provider,
      input_json: safeJson(input),
      output_json: safeJson(result.data ?? null),
      status,
      error: result.error ?? null,
      created_by: ctx.user_id ?? null,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[toolRegistry] logToolCall failed:", e);
  }
}

function safeJson(value: unknown): unknown {
  try {
    JSON.stringify(value);
    return value;
  } catch {
    return { _unserializable: true };
  }
}

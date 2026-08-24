// run-radar-scan — Signal Feed v1 ICP-aware radar.
// JWT-validated, workspace-scoped. Capability-gated providers; no fake signals.
// Persists accepted signals to public.signals with rich metadata under `raw`.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { signalDedupeKey } from "../_shared/signalQuality.ts";
import { isSignalsV2Enabled } from "../_shared/signalsV2Flag.ts";
import { writeSignalEventV2 } from "../_shared/signalsV2Writer.ts";
import { mapRadarSignalToV2, type RadarLegacyRow } from "../_shared/radarSignalToV2.ts";
import { compileCompanyBrainContext } from "../_shared/companyBrainCompiler.ts";
import { buildRadarScanPlan } from "../_shared/radarScanPlanner.ts";
import { scoreCandidates, type RadarPlanSource, type ScoredCandidate } from "../_shared/radarCandidatePipeline.ts";
import { runFirecrawlSource, type FirecrawlSearchResult } from "../_shared/radarSourceExecution.ts";
import {
  authorizeProviderCall, settleProviderCall, resolveCreditEnforcement,
  CREDIT_REFUSED_ERROR, type CreditDb,
} from "../_shared/creditAuthorization.ts";
import { priceFor } from "../_shared/creditPricing.ts";
import {
  resolveScanBudget, ScanBudgetTracker, MAX_SEARCHES_PER_SCAN,
} from "../_shared/signalScanBudget.ts";
import {
  ProviderRateLimiter, DEFAULT_PROVIDER_RPM, DEFAULT_SCAN_WALL_CLOCK_MS,
  parseRetryAfterMs, classifyRateLimitBody,
} from "../_shared/providerRateLimit.ts";
import type { RadarSource } from "../_shared/radarScanPlanner.ts";
import { buildRadarIntelligenceProfile } from "../_shared/radarIntel/radarIntelligenceProfile.ts";
import { enrichAndGateRows, type EnrichableRow } from "../_shared/radarIntel/radarSignalEnrichment.ts";
import { postsAdapterStatus, commentsAdapterStatus, peopleAdapterStatus, normalizePostRow, normalizeCommentRow, runApifyActor } from "../_shared/radarIntel/radarProviderAdapters.ts";
import { postsToSignalRows, commentsToSignalRows, type BuildResult } from "../_shared/radarIntel/linkedInSourceExecution.ts";
import { buildSourceDiagnostics, type SourceDiagnostics } from "../_shared/radarIntel/radarDiagnostics.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

type Category = "hiring" | "linkedin_intent" | "competitor" | "workflow_trend" | "people";
type CategoryStatus = { found: number; accepted: number; status: "ready" | "setup_needed" | "skipped"; reason?: string };

function present(name: string): boolean {
  const v = Deno.env.get(name);
  return !!(v && v.trim().length > 0);
}
function flag(name: string, fb = true): boolean {
  const v = Deno.env.get(name);
  if (v == null) return fb;
  const t = v.trim().toLowerCase();
  return t === "1" || t === "true" || t === "yes" || t === "on";
}

function readPrefs(profile: any) {
  const p = (profile?.signal_preferences ?? {}) as Record<string, any>;
  return {
    keywords: arr(p.keywords),
    competitors: arr(p.competitors).length ? arr(p.competitors) : arr(profile?.competitors?.known),
    hiring_roles: arr(p.hiring_roles).length ? arr(p.hiring_roles) : arr(profile?.icp?.buyer_roles),
    linkedin_topics: arr(p.linkedin_topics),
    workflow_topics: arr(p.workflow_topics),
    geographies: arr(p.geographies).length ? arr(p.geographies) : (profile?.icp?.geography ? [profile.icp.geography] : []),
    industries: arr(p.industries).length ? arr(p.industries) : arr(profile?.icp?.industries),
    pain_points: arr(p.pain_points).length ? arr(p.pain_points) : arr(profile?.icp?.pain_points),
    disqualifiers: arr(p.disqualifiers).length ? arr(p.disqualifiers) : arr(profile?.icp?.disqualifiers),
    default_mix: p.default_mix ?? { hiring: 3, linkedin_intent: 3, competitors: 2, workflows: 2, people: 0 },
    strict_geography: !!p.strict_geography,
  };
}
function arr(v: any): string[] {
  return Array.isArray(v) ? v.filter((x: any) => typeof x === "string" && x.trim()) : [];
}

interface FirecrawlSearchHit {
  url?: string;
  title?: string;
  description?: string;
  markdown?: string;
}

/**
 * One Firecrawl search — hits, or the reason there are none.
 *
 * ── WHAT THIS RETURNED BEFORE ─────────────────────────────────────────────
 *
 *     if (!res.ok) { console.warn("firecrawl search non-200", res.status); return []; }
 *
 * A refusal and an empty market were the same value. On 2026-08-23 Firecrawl
 * returned 429 to all NINETY searches of one scan; each became `[]`, every
 * source reported `raw_count: 0` with no error, and the scan returned 200. That
 * is why `signals` had held zero rows since the feature was built — and why the
 * cause was invisible in the response, the diagnostics and the UI.
 *
 * The status is now carried out. `error` is a bounded, sanitized string: a
 * status code or a short message, never a body that could echo the key.
 */
/**
 * One Firecrawl search — hits, or the reason there are none.
 *
 * ── WHAT THIS RETURNED BEFORE ─────────────────────────────────────────────
 *
 *     if (!res.ok) { console.warn("firecrawl search non-200", res.status); return []; }
 *
 * A refusal and an empty market were the same value, so ninety 429s read as
 * "nothing found" and `signals` held zero rows for the life of the feature.
 *
 * ── AND WHY THE 429s WERE OURS ────────────────────────────────────────────
 *
 * Measured: 21 × 429 in 3.4 seconds — 6.2 req/sec, ~371/min, against a
 * provider whose free tier allows ~10/min. The scan was rate-limiting itself
 * and would have done so on any key. `limiter` is the shared gate that stops
 * it; the retry below honours what the provider actually asks for.
 */
/** Firecrawl's own `creditsUsed`, summed across the scan. */
let providerCreditsUsed = 0;

async function firecrawlSearchRaw(
  query: string, limit: number, limiter: ProviderRateLimiter,
): Promise<FirecrawlSearchResult> {
  const key = Deno.env.get("FIRECRAWL_API_KEY");
  // NOT CONFIGURED IS A REASON, not an empty result.
  if (!key) return { hits: [], error: "not_configured" };

  // ONE RETRY, and only when the provider itself said to wait.
  //
  // Inside the metered wrapper, so this attempt and its retry are ONE logical
  // call and reserve ONE credit — the provider refused us, it did not do the
  // work twice.
  for (let attempt = 0; attempt < 2; attempt++) {
    await limiter.acquire();
    try {
      const res = await fetch("https://api.firecrawl.dev/v2/search", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query, limit }),
      });

      if (res.status === 429) {
        // THE BODY SAYS WHICH 429 THIS IS. "Going too fast" and "account
        // empty" are the same status and have opposite remedies: one is ours
        // to fix by slowing down, the other needs a human.
        const body = await res.text().catch(() => "");
        const why = classifyRateLimitBody(body);
        const retryMs = parseRetryAfterMs(res.headers.get("retry-after"));

        // BACK OFF THE SHARED GATE, not just this request. A 429 is a statement
        // about the account; letting the other queued callers carry on at full
        // speed is how a rate limit becomes permanent.
        limiter.backOff(retryMs ?? limiter.minIntervalMs * 4);

        const canRetry = attempt === 0 && why !== "out_of_credits";
        if (canRetry) continue;

        console.warn("firecrawl 429", why, retryMs ?? "no-retry-after");
        return { hits: [], error: `http_429:${why}` };
      }

      if (!res.ok) {
        console.warn("firecrawl search non-200", res.status);
        return { hits: [], error: `http_${res.status}` };
      }

      const data = await res.json();
      // ── THE RESULTS LIVE AT data.web ────────────────────────────────────
      //
      // This read `data?.data ?? data?.web ?? []`. Firecrawl v2 /search
      // returns:
      //
      //     { success: true, data: { web: [...] }, creditsUsed: N }
      //
      // so `data.data` is an OBJECT, truthy, and `??` never fell through to
      // `data.web`. `Array.isArray({web:[...]})` is false, so every successful
      // search returned `[]`.
      //
      // The provider did the work, incremented `creditsUsed`, we were charged —
      // and the results were thrown away at the last step. Ten searches
      // succeeded in the 08:29 scan and every one reported `raw: 0`.
      //
      // Ordered most-specific first, with the older shapes kept as fallbacks so
      // an older account or a changed contract degrades rather than breaks.
      const hits: FirecrawlSearchHit[] =
        (Array.isArray(data?.data?.web) && data.data.web) ||
        (Array.isArray(data?.web) && data.web) ||
        (Array.isArray(data?.data) && data.data) ||
        [];
      // The provider's own count of what this cost, when it says.
      const used = Number(data?.creditsUsed);
      if (Number.isFinite(used) && used > 0) providerCreditsUsed += used;
      return { hits, error: null };
    } catch (e) {
      console.warn("firecrawl search failed", e);
      return { hits: [], error: `transport_error: ${String(e).slice(0, 120)}` };
    }
  }
  return { hits: [], error: "http_429:rate_limited" };
}

// NOTE: the legacy generic query builders (intentQueries/competitorQueries/
// workflowQueries/hiringQueries) were removed. Firecrawl queries now come from the
// compiled Company Brain's scan plan via runFirecrawlSource (radarSourceExecution).
// This kills the generic-search leak (hard-coded "AI SDR"/"SDR"/"Claude Code"
// fallbacks) and lets the Brain actually drive execution.

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: uerr } = await userClient.auth.getUser(authHeader.replace("Bearer ", ""));
  if (uerr || !userData?.user?.id) return json({ error: "Unauthorized" }, 401);
  const userId = userData.user.id;

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }

  const workspace_id = String(body.workspace_id ?? "");
  if (!workspace_id) return json({ error: "workspace_id required" }, 400);

  const mode = (body.mode ?? "default") as "default" | "load_more" | "category";
  const category = (body.category as Category | undefined) ?? undefined;
  const confirmed = !!body.confirmed;
  const requestedLimit = Math.min(Number(body.limit ?? 10) || 10, 25);

  if (mode === "load_more" && !confirmed) {
    return json({ error: "load_more requires `confirmed: true`" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Workspace membership check
  const { data: member } = await admin
    .from("workspace_members").select("workspace_id")
    .eq("workspace_id", workspace_id).eq("user_id", userId).maybeSingle();
  if (!member) return json({ error: "Forbidden" }, 403);

  // Load brain + prefs
  const { data: brainRow } = await admin
    .from("company_brain").select("profile").eq("workspace_id", workspace_id).maybeSingle();
  const profile = (brainRow?.profile as any) ?? {};
  const prefs = readPrefs(profile);

  // Capabilities
  const apifyToken = present("APIFY_API_TOKEN");
  const apifyEnabled = flag("APIFY_ENABLE_PEOPLE_SEARCH", true);
  const firecrawl = present("FIRECRAWL_API_KEY");

  // Company Brain is the source of truth: compile it, then build a scan plan.
  const brain = compileCompanyBrainContext({ workspace_id, profile, signal_preferences: profile?.signal_preferences });
  const scanPlan = buildRadarScanPlan(brain, { firecrawlReady: firecrawl, apifyReady: apifyToken && apifyEnabled });
  const planReasonFor = (source: RadarPlanSource) => scanPlan.source_plan.find((p) => p.source === source)?.reason ?? "";

  // Canonical, workspace-specific intelligence profile — drives role families,
  // exclusions and the canonical decision at persistence time.
  const intel = buildRadarIntelligenceProfile(brain);
  // Per-scan id so this run's signals/diagnostics never mix with previous runs.
  // Stored in signals.raw (no migration).
  const scan_run_id = crypto.randomUUID();

  // Env-gated LinkedIn adapters. Actor IDs come from env — never invented. When
  // unset, the source is not_configured: no provider call, honest diagnostics.
  const getEnv = (n: string) => Deno.env.get(n);
  const postsAdapter = postsAdapterStatus(getEnv, apifyToken);
  const commentsAdapter = commentsAdapterStatus(getEnv, apifyToken);
  const peopleAdapter = peopleAdapterStatus(getEnv, apifyToken);

  const caps: Record<Category, { ready: boolean; reason?: string }> = {
    hiring: firecrawl ? { ready: true } : { ready: false, reason: "Firecrawl required for hiring search" },
    linkedin_intent: firecrawl ? { ready: true } : { ready: false, reason: "Firecrawl required for LinkedIn intent search" },
    competitor: firecrawl ? { ready: true } : { ready: false, reason: "Firecrawl required for competitor search" },
    workflow_trend: firecrawl ? { ready: true } : { ready: false, reason: "Firecrawl required for workflow trends" },
    people: apifyToken && apifyEnabled ? { ready: true } : { ready: false, reason: "Apify people search not configured" },
  };

  // ── PHASE 3H: RADAR NO LONGER COLLECTS HIRING ───────────────────────────
  //
  // Two hiring paths lived here: a second Apify LinkedIn-Jobs adapter behind
  // `RADAR_ENABLE_APIFY_JOBS`, and a Firecrawl web-search fallback. Both are
  // retired, for different reasons that reach the same place.
  //
  // The Apify adapter was a SECOND provider stack for a question the shared
  // capability engine already answers — its own actor call, its own
  // normalizer, its own recruiter-proxy regex — and the engine's version is
  // better: `companyAggregatorEvidence` refuses a staffing proxy on EVIDENCE
  // rather than on the company's name, and `companyFirstStages` rejects it as
  // `staffing_or_aggregator`.
  //
  // The Firecrawl fallback could resolve neither company identity nor role
  // family, which is why `mapRadarSignalToV2` refuses a `hiring` row: it never
  // reached the canonical store, and since Phase 3G it never reaches the feed.
  //
  // Phase 3F proved the replacement live, end to end, from a stored monitoring
  // subject to a canonical `sales_hiring` event.
  //
  // The capability is reported honestly rather than removed from the response:
  // a caller that used to see `hiring` must be told where it went.
  const RETIRED_HIRING_REASON =
    "Retired in Phase 3H — hiring is collected by the shared capability engine, " +
    "which resolves the company and reads real job postings.";
  caps.hiring = { ready: false, reason: RETIRED_HIRING_REASON };

  // Mix
  const mix: Record<Category, number> = {
    hiring: prefs.default_mix.hiring ?? 3,
    linkedin_intent: prefs.default_mix.linkedin_intent ?? 3,
    competitor: prefs.default_mix.competitors ?? 2,
    workflow_trend: prefs.default_mix.workflows ?? 2,
    people: prefs.default_mix.people ?? 0,
  };

  // Mode adjustments
  if (mode === "category" && category) {
    for (const k of Object.keys(mix) as Category[]) mix[k] = k === category ? requestedLimit : 0;
  } else if (mode === "load_more") {
    // double the default counts for load-more
    for (const k of Object.keys(mix) as Category[]) mix[k] = mix[k] * 2;
  }

  // Existing keys for dedupe (7-day window)
  const sevenDays = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const { data: existingRows } = await admin
    .from("signals").select("id, source_url, title, signal_type, raw, created_at")
    .eq("workspace_id", workspace_id).gte("created_at", sevenDays).limit(500);
  const existingKeys = new Set(
    (existingRows ?? []).map((r: any) => signalDedupeKey({ source_url: r.source_url, title: r.title, account_name: (r.raw?.account_name as string) ?? null, competitor_name: (r.raw?.competitor_name as string) ?? null })),
  );

  // Fan-out
  const perCategory: Record<Category, CategoryStatus> = {
    hiring: { found: 0, accepted: 0, status: "skipped" },
    linkedin_intent: { found: 0, accepted: 0, status: "skipped" },
    competitor: { found: 0, accepted: 0, status: "skipped" },
    workflow_trend: { found: 0, accepted: 0, status: "skipped" },
    people: { found: 0, accepted: 0, status: "skipped" },
  };

  // Category → scan-plan source. The compiled Company Brain drives every query.
  const CAT_TO_PLAN_SOURCE: Record<Exclude<Category, "people">, RadarSource> = {
    hiring: "hiring", linkedin_intent: "linkedin_posts", competitor: "competitor", workflow_trend: "workflow_trends",
  };
  const planFor = (s: RadarSource) => scanPlan.source_plan.find((p) => p.source === s);

  // Brain-driven Firecrawl execution: staged queries (exact→synonym→adjacent) with
  // disqualifier exclusions applied, and a hard setup_required short-circuit — an
  // unusable Brain makes ZERO provider calls instead of running generic searches.
  // ── THE MONEY BOUNDARY FOR SIGNALS ──────────────────────────────────────
  //
  // Radar called Firecrawl directly, so `authorizeProviderCall` never saw it:
  // with enforcement live for Leads, a workspace at zero credits was blocked
  // from Leads and unrestricted on Signals. Every provider search now reserves
  // before the call and settles on what actually happened.
  //
  // The budget is checked FIRST and costs nothing. A scan that has hit its
  // ceiling must not reserve a credit it is not going to use.
  const creditMode = resolveCreditEnforcement();
  const searchPrice = priceFor("signal_search");
  const { data: balRow } = await admin
    .from("workspace_credit_balances")
    .select("balance_credits").eq("workspace_id", workspace_id).maybeSingle();
  // ── THE SHARED RATE GATE ────────────────────────────────────────────────
  //
  // Every Firecrawl request in this scan passes through one limiter, so the
  // three categories running under `Promise.all` below take turns instead of
  // bursting. Configurable because the right number is the KEY'S tier, which
  // this code cannot see: a Free-tier key needs RADAR_PROVIDER_RPM=10.
  const rpm = Number(Deno.env.get("RADAR_PROVIDER_RPM") ?? "") || DEFAULT_PROVIDER_RPM;
  const limiter = ProviderRateLimiter.fromRpm(rpm);

  // AND A THIRD CEILING: what fits in the wall clock.
  //
  // Spacing requests makes them slower, and an edge invocation gets killed. At
  // 10 req/min a 30-search scan needs three minutes and would die mid-flight,
  // losing everything it had already paid for. Better to plan a smaller scan
  // and finish it.
  const timeCapacity = limiter.capacityWithin(DEFAULT_SCAN_WALL_CLOCK_MS);
  const budget = resolveScanBudget({
    balance: typeof balRow?.balance_credits === "number" ? balRow.balance_credits : null,
    pricePerSearch: searchPrice,
    maxPerScan: Math.min(MAX_SEARCHES_PER_SCAN, timeCapacity),
  });
  const tracker = new ScanBudgetTracker(budget);
  let creditRefusals = 0;

  const firecrawlSearch = async (
    query: string, limit: number,
  ): Promise<FirecrawlSearchResult> => {
    if (!tracker.take()) {
      // NOT AN ERROR. The scan keeps what it already collected and says it
      // stopped early — throwing away paid-for results because the budget ran
      // out would waste the credits already spent.
      return { hits: [], error: "scan_budget_exhausted" };
    }
    // ONE LOGICAL CALL PER QUERY, so a replayed or retried scan reserves
    // nothing further — the same idempotency rule the lead path uses.
    const key = `signal_scan:${scan_run_id}:${query}`.slice(0, 200);
    const auth = await authorizeProviderCall({
      db: admin as unknown as CreditDb,
      workspace_id, logical_call_key: key, task_id: null,
      capability: "signal_search", mode: creditMode, amount: searchPrice,
    });
    if (!auth.allowed) {
      creditRefusals++;
      return { hits: [], error: CREDIT_REFUSED_ERROR };
    }
    let started = false;
    try {
      const res = await firecrawlSearchRaw(query, limit, limiter);
      // ── CHARGE ONLY FOR WORK THE PROVIDER ACTUALLY DID ──────────────────
      //
      // This read `res.error !== "not_configured"`, which charged for a 429 on
      // the grounds that the provider had been "reached". It had — and it
      // REFUSED. One scan against an empty Firecrawl balance charged 30 credits
      // for 30 declined requests and returned nothing, and would have done so
      // on every scan until the key was topped up.
      //
      // A refusal is not work. `error === null` is the only state in which the
      // provider ran the search, so it is the only state that costs anything.
      //
      // AN HONEST EMPTY SEARCH IS STILL CHARGED: `{ hits: [], error: null }`
      // means the provider did the work and the market is quiet. That consumed
      // their quota and it consumes ours. The distinction being drawn here is
      // refused-vs-performed, not empty-vs-full.
      started = res.error === null;
      return res;
    } finally {
      await settleProviderCall({
        db: admin as unknown as CreditDb,
        transaction_id: auth.transaction_id, started, amount: searchPrice,
      });
    }
  };

  // Provider refusals per category, so the diagnostics below can tell "found
  // nothing" from "the provider refused every request".
  const providerErrors: Partial<Record<Category, string | null>> = {};
  const providerFailures: Partial<Record<Category, number>> = {};

  async function runFirecrawlCategory(cat: Exclude<Category, "people">, wanted: number): Promise<ScoredCandidate[]> {
    const plan = planFor(CAT_TO_PLAN_SOURCE[cat]);
    if (!plan || wanted <= 0) { perCategory[cat] = { found: 0, accepted: 0, status: "skipped" }; return []; }
    if (!caps[cat].ready) { perCategory[cat] = { found: 0, accepted: 0, status: "setup_needed", reason: caps[cat].reason }; return []; }
    const res = await runFirecrawlSource({
      plan, wanted, search: firecrawlSearch, scanPlanReason: plan.reason, setupRequired: scanPlan.setup_required,
    });
    providerErrors[cat] = res.provider_error;
    providerFailures[cat] = res.provider_failures;
    perCategory[cat] = {
      found: res.found, accepted: 0,
      status: res.status === "setup_needed" ? "setup_needed" : res.status === "ready" ? "ready" : "skipped",
      reason: res.reason,
    };
    return res.items;
  }

  // RETIRED — see the note above. Kept as an explicit empty rather than deleted
  // so `perCategory.hiring` still reports, with a reason, instead of vanishing.
  const hiringItems: ScoredCandidate[] = [];
  const hiringCap = 0;
  perCategory.hiring = {
    found: 0, accepted: 0, status: "skipped", reason: RETIRED_HIRING_REASON,
  };

  // Other categories via Brain-driven Firecrawl execution.
  const [intentItems, compItems, workflowItems] = await Promise.all([
    runFirecrawlCategory("linkedin_intent", mix.linkedin_intent),
    runFirecrawlCategory("competitor", mix.competitor),
    runFirecrawlCategory("workflow_trend", mix.workflow_trend),
  ]);
  if (mix.people > 0) perCategory.people = { found: 0, accepted: 0, status: "setup_needed", reason: caps.people.reason };

  // Score every candidate against Company Brain, reject disqualified, dedupe,
  // rank, cap, and persist rich fields into signals.raw.
  const accepted: any[] = [];
  const addRows = (cat: Category, res: { rows: any[]; accepted: number }) => {
    perCategory[cat].accepted = res.accepted;
    for (const row of res.rows) {
      existingKeys.add(signalDedupeKey({
        source_url: row.source_url ?? undefined, title: row.title,
        account_name: (row.raw.account_name as string) ?? undefined, competitor_name: undefined,
      }));
      accepted.push(row);
    }
  };

  if (hiringItems.length) {
    addRows("hiring", scoreCandidates({ items: hiringItems, brain, workspace_id, userId, cap: hiringCap, existingKeys }));
  }
  for (const [cat, items] of [
    ["linkedin_intent", intentItems], ["competitor", compItems], ["workflow_trend", workflowItems],
  ] as [Category, ScoredCandidate[]][]) {
    const wanted = mix[cat];
    if (wanted <= 0 || items.length === 0) continue;
    addRows(cat, scoreCandidates({ items, brain, workspace_id, userId, cap: wanted, existingKeys }));
  }

  // Structured LinkedIn sources (posts → comments) — ENV-GATED. Runs only when the
  // actor env var is set; otherwise zero provider calls (diagnostics = not_configured).
  const apifyTokenValue = Deno.env.get("APIFY_API_TOKEN") ?? "";
  let postsBuilt: BuildResult | null = null; let postsErr: string | null = null;
  let commentsBuilt: BuildResult | null = null; let commentsErr: string | null = null;
  if (postsAdapter.configured && postsAdapter.actor && !scanPlan.setup_required) {
    try {
      const terms = [...intel.topics, ...intel.competitors.seeds].slice(0, 3);
      const rawRows = await runApifyActor(postsAdapter.actor, apifyTokenValue, { searchTerms: terms, maxItems: 25 }, 25);
      postsBuilt = postsToSignalRows(rawRows.map(normalizePostRow), intel, userId);
      for (const r of postsBuilt.rows) accepted.push({ ...r, workspace_id, created_by: userId, source: "apify_posts", confidence: 0.5, description: r.title });
    } catch (e) { postsErr = e instanceof Error ? e.message : "posts fetch failed"; }
  }
  if (commentsAdapter.configured && commentsAdapter.actor && !scanPlan.setup_required) {
    try {
      // Comments run only from parent post URLs surfaced by the posts source.
      const postUrls = (postsBuilt?.rows ?? []).map((r) => String((r.raw["source_details"] as Record<string, unknown>)?.["post_url"] ?? "")).filter(Boolean).slice(0, 5);
      if (postUrls.length) {
        const rawRows = await runApifyActor(commentsAdapter.actor, apifyTokenValue, { postUrls, maxComments: 30 }, 30);
        commentsBuilt = commentsToSignalRows(rawRows.map(normalizeCommentRow), intel, userId);
        for (const r of commentsBuilt.rows) accepted.push({ ...r, workspace_id, created_by: userId, source: "apify_comments", confidence: 0.5, description: r.title });
      }
    } catch (e) { commentsErr = e instanceof Error ? e.message : "comments fetch failed"; }
  }

  // Enrich + gate against the intelligence profile before persistence: drops
  // unrelated/excluded hiring rows, sets the canonical decision + outreach gate,
  // cleans duplicate tags and stamps scan_run_id. This is where the tested
  // intelligence contracts become part of the real persisted workflow.
  const enrich = enrichAndGateRows(accepted as EnrichableRow[], intel, scan_run_id);
  const kept = enrich.kept;

  // ── LEGACY WRITE — STILL THE AUTHORITY ──────────────────────────────────
  //
  // `signals` remains what the Signals UI reads. The v2 write below is a
  // dual-write behind it and can never affect this result: the read switch
  // waits for Phase 3's independent-monitoring gate.
  //
  // Rows are selected back because the canonical event needs `legacy_signal_id`
  // to point at the row it was derived from.
  let persisted: RadarLegacyRow[] = [];
  if (kept.length > 0) {
    const { data: insRows, error: insErr } = await admin.from("signals")
      .insert(kept)
      .select("id, workspace_id, signal_type, title, description, source, source_url, confidence, raw");
    if (insErr) {
      console.error("signals insert failed", insErr);
      return json({ error: "Failed to save signals", detail: insErr.message }, 500);
    }
    persisted = (insRows ?? []) as RadarLegacyRow[];
  }

  // ── SIGNALS V2 DUAL-WRITE ───────────────────────────────────────────────
  //
  // Radar's rows become canonical `signal_events` about a MARKET SUBJECT — a
  // competitor, or the problem space — never about a fabricated lead account.
  // Flag-gated, and deliberately unable to fail the scan: an exception here
  // must not lose a signal the legacy write already stored.
  //
  // Every outcome is counted, including the refusals. `hiring` and `funding`
  // rows are refused because Radar resolves neither company identity nor role
  // family, and a silent zero is indistinguishable from a broken writer — which
  // is the failure mode this whole phase exists to make visible.
  const v2Enabled = isSignalsV2Enabled();
  const v2 = { enabled: v2Enabled, attempted: 0, written: 0, deduplicated: 0, failed: 0,
    skipped: {} as Record<string, number> };
  if (v2Enabled && persisted.length > 0) {
    const observedAt = new Date().toISOString();
    for (const row of persisted) {
      try {
        // Human-triggered: this endpoint requires an authenticated member. A
        // scheduled monitor (Phase 3) states `scheduled_monitor` instead.
        const mapped = mapRadarSignalToV2(row, "manual_scan", observedAt);
        if (!mapped.ok) {
          v2.skipped[mapped.reason] = (v2.skipped[mapped.reason] ?? 0) + 1;
          continue;
        }
        v2.attempted++;
        const res = await writeSignalEventV2({ admin, enabled: true }, mapped.input);
        if (res.written) v2.written++;
        else if (res.deduplicated) v2.deduplicated++;
        else {
          v2.failed++;
          v2.skipped[res.error_class ?? "unknown"] = (v2.skipped[res.error_class ?? "unknown"] ?? 0) + 1;
        }
      } catch (e) {
        v2.failed++;
        console.warn("[radar-scan] signals-v2 dual-write skipped:", (e as Error)?.message);
      }
    }
  }

  // Per-source diagnostics — honest readiness; every zero is explained.
  const keptByType = (t: string) => kept.filter((r) => r.signal_type === t).length;
  const verifiedByType = (t: string) => kept.filter((r) => r.signal_type === t && String((r.raw as Record<string, unknown>)["verification_status"]) === "verified").length;
  const hiringRejected = (enrich.rejection_reasons["unrelated_role"] ?? 0) + (enrich.rejection_reasons["excluded_company"] ?? 0);
  const diagnostics: SourceDiagnostics[] = [
    // RETIRED, AND THE DIAGNOSTIC SAYS SO. `ran` would claim a scan that did
    // not happen; `skipped_not_configured` is the honest reading — Radar has no
    // hiring provider configured any more, because it has none at all.
    buildSourceDiagnostics({ source: "hiring", configured: false, provider_error: null, auth_failed: false, execution_status: "skipped_not_configured", queries_attempted: planFor("hiring")?.queries ?? [], raw_count: perCategory.hiring.found, accepted_count: keptByType("hiring"), verified_count: verifiedByType("hiring"), rejected_count: hiringRejected, rejection_reasons: enrich.rejection_reasons }),
    buildSourceDiagnostics({ source: "competitor", configured: caps.competitor.ready, provider_error: providerErrors.competitor ?? null, auth_failed: /401|403/.test(providerErrors.competitor ?? ""), queries_attempted: planFor("competitor")?.queries ?? [], raw_count: perCategory.competitor.found, accepted_count: keptByType("competitor"), verified_count: verifiedByType("competitor") }),
    buildSourceDiagnostics({ source: "workflow_trend", configured: caps.workflow_trend.ready, provider_error: providerErrors.workflow_trend ?? null, auth_failed: /401|403/.test(providerErrors.workflow_trend ?? ""), queries_attempted: planFor("workflow_trends")?.queries ?? [], raw_count: perCategory.workflow_trend.found, accepted_count: keptByType("workflow_trend"), verified_count: verifiedByType("workflow_trend") }),
    buildSourceDiagnostics({ source: "linkedin_post", configured: postsAdapter.configured, execution_status: postsAdapter.configured ? "ran" : "skipped_not_configured", provider_error: postsErr ?? (postsAdapter.configured ? null : postsAdapter.reason), auth_failed: /401|403|auth/i.test(postsErr ?? ""), raw_count: postsBuilt?.considered ?? 0, accepted_count: keptByType("linkedin_post"), rejected_count: postsBuilt?.rejected ?? 0, rejection_reasons: postsBuilt?.rejection_reasons ?? {} }),
    buildSourceDiagnostics({ source: "linkedin_comment", configured: commentsAdapter.configured, execution_status: commentsAdapter.configured ? "ran" : "skipped_not_configured", provider_error: commentsErr ?? (commentsAdapter.configured ? null : commentsAdapter.reason), auth_failed: /401|403|auth/i.test(commentsErr ?? ""), raw_count: commentsBuilt?.considered ?? 0, accepted_count: keptByType("linkedin_comment"), rejected_count: commentsBuilt?.rejected ?? 0, rejection_reasons: commentsBuilt?.rejection_reasons ?? {} }),
    buildSourceDiagnostics({ source: "funding", configured: false, execution_status: "skipped_not_configured" }),
    buildSourceDiagnostics({ source: "decision_maker", configured: peopleAdapter.configured, execution_status: peopleAdapter.configured ? "ran" : "skipped_not_configured", provider_error: peopleAdapter.configured ? null : peopleAdapter.reason }),
  ];

  // ── TEMPORARY PHASE-0/1 DIAGNOSTIC ──────────────────────────────────────
  //
  // The Signals UI has no scan-details panel, so a scan's per-source outcome is
  // unreadable after the fact. This puts it in the function log, which IS
  // queryable — the same place `firecrawl search non-200 429` was found, and
  // the only reason that scan was ever explained.
  //
  // Kept deliberately small and structured: one line, no payloads, no query
  // text that could echo Brain content into a log. Remove once a diagnostics
  // surface exists, or promote it to the execution ledger in Phase 2.
  console.log("[radar-scan][diagnostics]", JSON.stringify({
    scan_run_id,
    inserted: kept.length,
    credit_spend: {
      ...tracker.spend, refused: creditRefusals, mode: creditMode,
      provider_rpm: rpm, time_capacity: timeCapacity,
    },
    sources: diagnostics.map((d) => ({
      source: d.source,
      readiness: d.readiness,
      execution_status: d.execution_status,
      raw: d.raw_count, normalized: d.normalized_count,
      accepted: d.accepted_count, rejected: d.rejected_count,
      duplicates: d.duplicate_count, verified: d.verified_count,
      rejection_reasons: d.rejection_reasons,
      provider_error: d.provider_error,
    })),
  }));

  return json({
    ok: true,
    inserted: kept.length,
    dropped: enrich.dropped.length,
    dropped_reasons: enrich.rejection_reasons,
    decision_counts: enrich.decision_counts,
    scan_run_id,
    diagnostics,
    signals_v2: v2,
    adapters: { linkedin_posts: postsAdapter, linkedin_comments: commentsAdapter, decision_makers: peopleAdapter },
    per_category: perCategory,
    capabilities: caps,
    // NOTHING. Radar has no hiring provider any more; the capability engine has
    // one, and reporting a Radar provider here would say otherwise.
    hiring_provider: null,
    brain_confidence: scanPlan.brain_confidence,
    setup_required: scanPlan.setup_required,
    warnings: scanPlan.warnings,
    mode,
    // ── WHAT THIS SCAN SPENT, AND WHY IT STOPPED ──────────────────────────
    //
    // A scan that returns zero signals now has to say which zero it is: the
    // market was quiet, the provider refused, the budget ran out, or credits
    // were declined. Those were one indistinguishable answer, which is how
    // ninety consecutive 429s read as "nothing found" for the life of the
    // feature.
    credit_spend: {
      ...tracker.spend,
      price_per_search: searchPrice,
      mode: creditMode,
      refused: creditRefusals,
      // The rate the scan planned around. A 429 alongside this says the tier
      // is lower than configured — the one number that turns "it failed again"
      // into "set RADAR_PROVIDER_RPM to 10".
      provider_rpm: rpm,
      time_capacity: timeCapacity,
      // What Firecrawl says it charged, beside what we charged. Two different
      // ledgers; neither is allowed to stand in for the other.
      provider_credits_used: providerCreditsUsed,
    },
  });
});

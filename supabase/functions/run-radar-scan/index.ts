// run-radar-scan — Signal Feed v1 ICP-aware radar.
// JWT-validated, workspace-scoped. Capability-gated providers; no fake signals.
// Persists accepted signals to public.signals with rich metadata under `raw`.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { signalDedupeKey } from "../_shared/signalQuality.ts";
import { compileCompanyBrainContext } from "../_shared/companyBrainCompiler.ts";
import { buildRadarScanPlan } from "../_shared/radarScanPlanner.ts";
import { scoreCandidates, type RadarPlanSource, type ScoredCandidate } from "../_shared/radarCandidatePipeline.ts";
import { runFirecrawlSource } from "../_shared/radarSourceExecution.ts";
import type { RadarSource } from "../_shared/radarScanPlanner.ts";
import { apifyJobsSourceStatus, buildApifyJobsInput, fetchApifyJobs, apifyRowsToScoredItems } from "../_shared/radarSources/apifyJobsHiringSource.ts";
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

async function firecrawlSearch(query: string, limit: number): Promise<FirecrawlSearchHit[]> {
  const key = Deno.env.get("FIRECRAWL_API_KEY");
  if (!key) return [];
  try {
    const res = await fetch("https://api.firecrawl.dev/v2/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, limit }),
    });
    if (!res.ok) { console.warn("firecrawl search non-200", res.status); return []; }
    const data = await res.json();
    const list = (data?.data ?? data?.web ?? []) as FirecrawlSearchHit[];
    return Array.isArray(list) ? list : [];
  } catch (e) {
    console.warn("firecrawl search failed", e);
    return [];
  }
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

  // Commit 4A — hiring source: Apify LinkedIn Jobs behind RADAR_ENABLE_APIFY_JOBS,
  // else Firecrawl fallback. Honest status; never crashes when unconfigured.
  const HIRING_CAP = 10;
  const apifyJobsFlag = flag("RADAR_ENABLE_APIFY_JOBS", false);
  const hiringStatus = apifyJobsSourceStatus({ flagEnabled: apifyJobsFlag, apifyReady: !!apifyToken });
  const useApifyHiring = hiringStatus.enabled;
  caps.hiring = useApifyHiring
    ? { ready: true }
    : (firecrawl ? { ready: true } : { ready: false, reason: hiringStatus.reason });

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
  async function runFirecrawlCategory(cat: Exclude<Category, "people">, wanted: number): Promise<ScoredCandidate[]> {
    const plan = planFor(CAT_TO_PLAN_SOURCE[cat]);
    if (!plan || wanted <= 0) { perCategory[cat] = { found: 0, accepted: 0, status: "skipped" }; return []; }
    if (!caps[cat].ready) { perCategory[cat] = { found: 0, accepted: 0, status: "setup_needed", reason: caps[cat].reason }; return []; }
    const res = await runFirecrawlSource({
      plan, wanted, search: firecrawlSearch, scanPlanReason: plan.reason, setupRequired: scanPlan.setup_required,
    });
    perCategory[cat] = {
      found: res.found, accepted: 0,
      status: res.status === "setup_needed" ? "setup_needed" : res.status === "ready" ? "ready" : "skipped",
      reason: res.reason,
    };
    return res.items;
  }

  // Hiring source: Apify LinkedIn Jobs (flag) → richer candidates, else Brain-driven Firecrawl.
  let hiringItems: ScoredCandidate[] = [];
  let hiringCap = mix.hiring;
  if (mix.hiring > 0) {
    if (useApifyHiring) {
      hiringCap = HIRING_CAP;
      const input = buildApifyJobsInput(brain, HIRING_CAP);
      if (input.setup_required || input.urls.length === 0) {
        // Incomplete Brain → never fan out broad provider queries. Ask for setup.
        perCategory.hiring = { found: 0, accepted: 0, status: "setup_needed", reason: "Company Brain incomplete — complete setup before a high-quality hiring scan." };
        hiringItems = [];
      } else {
        perCategory.hiring.status = "ready";
        const rows = await fetchApifyJobs(input, Deno.env.get("APIFY_API_TOKEN") ?? "");
        const norm = apifyRowsToScoredItems(rows, { cap: HIRING_CAP, scanPlanReason: planReasonFor("hiring") });
        perCategory.hiring.found = norm.considered;
        hiringItems = norm.items;
      }
    } else {
      // Firecrawl fallback — now Brain-driven (staged plan), not legacy generic queries.
      hiringItems = await runFirecrawlCategory("hiring", mix.hiring);
    }
  }

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

  if (kept.length > 0) {
    const { error: insErr } = await admin.from("signals").insert(kept);
    if (insErr) {
      console.error("signals insert failed", insErr);
      return json({ error: "Failed to save signals", detail: insErr.message }, 500);
    }
  }

  // Per-source diagnostics — honest readiness; every zero is explained.
  const keptByType = (t: string) => kept.filter((r) => r.signal_type === t).length;
  const verifiedByType = (t: string) => kept.filter((r) => r.signal_type === t && String((r.raw as Record<string, unknown>)["verification_status"]) === "verified").length;
  const hiringRejected = (enrich.rejection_reasons["unrelated_role"] ?? 0) + (enrich.rejection_reasons["excluded_company"] ?? 0);
  const diagnostics: SourceDiagnostics[] = [
    buildSourceDiagnostics({ source: "hiring", configured: caps.hiring.ready, execution_status: perCategory.hiring.status === "setup_needed" ? "skipped_setup_required" : "ran", queries_attempted: planFor("hiring")?.queries ?? [], raw_count: perCategory.hiring.found, accepted_count: keptByType("hiring"), verified_count: verifiedByType("hiring"), rejected_count: hiringRejected, rejection_reasons: enrich.rejection_reasons }),
    buildSourceDiagnostics({ source: "competitor", configured: caps.competitor.ready, queries_attempted: planFor("competitor")?.queries ?? [], raw_count: perCategory.competitor.found, accepted_count: keptByType("competitor"), verified_count: verifiedByType("competitor") }),
    buildSourceDiagnostics({ source: "workflow_trend", configured: caps.workflow_trend.ready, queries_attempted: planFor("workflow_trends")?.queries ?? [], raw_count: perCategory.workflow_trend.found, accepted_count: keptByType("workflow_trend"), verified_count: verifiedByType("workflow_trend") }),
    buildSourceDiagnostics({ source: "linkedin_post", configured: postsAdapter.configured, execution_status: postsAdapter.configured ? "ran" : "skipped_not_configured", provider_error: postsErr ?? (postsAdapter.configured ? null : postsAdapter.reason), auth_failed: /401|403|auth/i.test(postsErr ?? ""), raw_count: postsBuilt?.considered ?? 0, accepted_count: keptByType("linkedin_post"), rejected_count: postsBuilt?.rejected ?? 0, rejection_reasons: postsBuilt?.rejection_reasons ?? {} }),
    buildSourceDiagnostics({ source: "linkedin_comment", configured: commentsAdapter.configured, execution_status: commentsAdapter.configured ? "ran" : "skipped_not_configured", provider_error: commentsErr ?? (commentsAdapter.configured ? null : commentsAdapter.reason), auth_failed: /401|403|auth/i.test(commentsErr ?? ""), raw_count: commentsBuilt?.considered ?? 0, accepted_count: keptByType("linkedin_comment"), rejected_count: commentsBuilt?.rejected ?? 0, rejection_reasons: commentsBuilt?.rejection_reasons ?? {} }),
    buildSourceDiagnostics({ source: "funding", configured: false, execution_status: "skipped_not_configured" }),
    buildSourceDiagnostics({ source: "decision_maker", configured: peopleAdapter.configured, execution_status: peopleAdapter.configured ? "ran" : "skipped_not_configured", provider_error: peopleAdapter.configured ? null : peopleAdapter.reason }),
  ];

  return json({
    ok: true,
    inserted: kept.length,
    dropped: enrich.dropped.length,
    dropped_reasons: enrich.rejection_reasons,
    decision_counts: enrich.decision_counts,
    scan_run_id,
    diagnostics,
    adapters: { linkedin_posts: postsAdapter, linkedin_comments: commentsAdapter, decision_makers: peopleAdapter },
    per_category: perCategory,
    capabilities: caps,
    hiring_provider: hiringStatus.provider,
    brain_confidence: scanPlan.brain_confidence,
    setup_required: scanPlan.setup_required,
    warnings: scanPlan.warnings,
    mode,
  });
});

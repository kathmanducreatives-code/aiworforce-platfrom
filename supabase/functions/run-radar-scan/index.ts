// run-radar-scan — Signal Feed v1 ICP-aware radar.
// JWT-validated, workspace-scoped. Capability-gated providers; no fake signals.
// Persists accepted signals to public.signals with rich metadata under `raw`.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  evaluateSignalQuality,
  dedupeSignals,
  signalDedupeKey,
  type SignalSourceType,
  type RawSignalInput,
} from "../_shared/signalQuality.ts";

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

function intentQueries(prefs: ReturnType<typeof readPrefs>): string[] {
  const topics = prefs.linkedin_topics.length ? prefs.linkedin_topics : ["AI SDR", "lead generation", "outbound automation"];
  const out: string[] = [];
  for (const t of topics.slice(0, 3)) {
    out.push(`site:linkedin.com/posts "${t}" 2026`);
  }
  return out;
}
function competitorQueries(prefs: ReturnType<typeof readPrefs>): string[] {
  if (!prefs.competitors.length) return [];
  return prefs.competitors.slice(0, 3).map((c) => `"${c}" alternative OR comparison OR vs site:linkedin.com OR site:reddit.com`);
}
function workflowQueries(prefs: ReturnType<typeof readPrefs>): string[] {
  const topics = prefs.workflow_topics.length ? prefs.workflow_topics : ["Claude Code workflow", "AI agent automation"];
  return topics.slice(0, 3).map((t) => `"${t}" tutorial OR example 2026`);
}
function hiringQueries(prefs: ReturnType<typeof readPrefs>): string[] {
  const roles = prefs.hiring_roles.length ? prefs.hiring_roles : ["Founder's Associate", "SDR", "GTM"];
  const geo = prefs.geographies[0] ? ` ${prefs.geographies[0]}` : "";
  return roles.slice(0, 3).map((r) => `"${r}" hiring${geo} site:linkedin.com/jobs OR site:wellfound.com`);
}

interface ScannedSignal extends RawSignalInput {
  signal_type: Category;
  source_provider: string;
}

function hitsToSignals(category: Category, provider: string, hits: FirecrawlSearchHit[]): ScannedSignal[] {
  return hits.map((h) => ({
    signal_type: category,
    source_provider: provider,
    title: h.title ?? "",
    description: h.description ?? (h.markdown ? h.markdown.slice(0, 280) : ""),
    source_url: h.url,
    source: provider,
    created_at: new Date().toISOString(),
    post_snippet: h.description ?? (h.markdown ? h.markdown.slice(0, 280) : undefined),
  }));
}

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

  const caps: Record<Category, { ready: boolean; reason?: string }> = {
    hiring: firecrawl ? { ready: true } : { ready: false, reason: "Firecrawl required for hiring search" },
    linkedin_intent: firecrawl ? { ready: true } : { ready: false, reason: "Firecrawl required for LinkedIn intent search" },
    competitor: firecrawl ? { ready: true } : { ready: false, reason: "Firecrawl required for competitor search" },
    workflow_trend: firecrawl ? { ready: true } : { ready: false, reason: "Firecrawl required for workflow trends" },
    people: apifyToken && apifyEnabled ? { ready: true } : { ready: false, reason: "Apify people search not configured" },
  };

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

  async function runCategory(cat: Category, queries: string[], wanted: number) {
    if (wanted <= 0) return [] as ScannedSignal[];
    if (!caps[cat].ready) {
      perCategory[cat] = { found: 0, accepted: 0, status: "setup_needed", reason: caps[cat].reason };
      return [];
    }
    perCategory[cat].status = "ready";
    const perQuery = Math.max(3, Math.ceil(wanted * 1.5));
    const collected: ScannedSignal[] = [];
    for (const q of queries) {
      const hits = await firecrawlSearch(q, perQuery);
      collected.push(...hitsToSignals(cat, "firecrawl_search", hits));
    }
    perCategory[cat].found = collected.length;
    return collected;
  }

  const [hiringHits, intentHits, compHits, workflowHits] = await Promise.all([
    runCategory("hiring", hiringQueries(prefs), mix.hiring),
    runCategory("linkedin_intent", intentQueries(prefs), mix.linkedin_intent),
    runCategory("competitor", competitorQueries(prefs), mix.competitor),
    runCategory("workflow_trend", workflowQueries(prefs), mix.workflow_trend),
  ]);
  if (mix.people > 0) perCategory.people = { found: 0, accepted: 0, status: "setup_needed", reason: caps.people.reason };

  // Score + dedupe per category, then take top N each
  const accepted: any[] = [];
  for (const [cat, candidates] of [
    ["hiring", hiringHits], ["linkedin_intent", intentHits],
    ["competitor", compHits], ["workflow_trend", workflowHits],
  ] as [Category, ScannedSignal[]][]) {
    const wanted = mix[cat];
    if (wanted <= 0) continue;
    const fresh = dedupeSignals(candidates, existingKeys);
    const scored = fresh.map((s) => ({ s, e: evaluateSignalQuality({ signal: s, companyBrain: profile, signalPreferences: prefs as any, sourceType: cat }) }))
      .filter((x) => x.e.accepted)
      .sort((a, b) => b.e.score - a.e.score)
      .slice(0, wanted);
    perCategory[cat].accepted = scored.length;
    for (const { s, e } of scored) {
      existingKeys.add(signalDedupeKey(s));
      accepted.push({
        workspace_id,
        source: s.source_provider,
        signal_type: cat,
        signal_label: cat.replace(/_/g, " "),
        title: (s.title ?? "").slice(0, 500) || `${cat} signal`,
        description: (s.description ?? "").slice(0, 1000),
        source_url: s.source_url ?? null,
        confidence: e.score / 100,
        created_by: userId,
        raw: {
          ...(s.raw ?? {}),
          score: e.score,
          priority: e.priority === "high" ? "hot" : e.priority === "medium" ? "warm" : "maybe",
          why_it_matters: e.reason,
          matched_icp: e.matched_icp,
          missing_context: e.missing_context,
          next_action: e.next_action,
          status: "new",
          source_provider: s.source_provider,
          post_snippet: s.post_snippet ?? null,
        },
      });
    }
  }

  if (accepted.length > 0) {
    const { error: insErr } = await admin.from("signals").insert(accepted);
    if (insErr) {
      console.error("signals insert failed", insErr);
      return json({ error: "Failed to save signals", detail: insErr.message }, 500);
    }
  }

  return json({
    ok: true,
    inserted: accepted.length,
    per_category: perCategory,
    capabilities: caps,
    mode,
  });
});

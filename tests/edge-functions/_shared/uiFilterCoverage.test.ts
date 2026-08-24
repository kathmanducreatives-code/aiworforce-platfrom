// PHASE 4 — EVERY UI FILTER HAS A REAL COLLECTOR, OR IS HONESTLY DISABLED.
//
// ── THE COMPLAINT THIS ANSWERS ──────────────────────────────────────────────
//
// The audit's finding was that "the UI offers filters (`funding`, `workflows`,
// `people`) with nothing behind them". A filter that returns zero is
// indistinguishable, to the person looking at it, from a category nobody has
// collected yet — and one of those is a bug while the other is just Tuesday.
//
// So the filter list and the collector list are checked against each other
// here, from their own sources. A filter added to the UI with nothing that
// collects it fails this test, and a collector that is retired without its
// filter being reconsidered fails it too.
//
// ── WHAT COUNTS AS A COLLECTOR ──────────────────────────────────────────────
//
// Either of two things, and both are read from code rather than listed here:
//
//   * a Radar source the scan planner still ENABLES — Radar owns the market and
//     social surfaces, and no capability replaces them;
//   * a monitoring signal `signalCollectability` says can actually be
//     established, which is derived from the real graph and the real
//     engine-driven list.
//
// PURE. No network, no provider, no model, no database.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildRadarScanPlan } from "../../../supabase/functions/_shared/radarScanPlanner.ts";
import { compileCompanyBrainContext } from "../../../supabase/functions/_shared/companyBrainCompiler.ts";
import { signalCollectability } from "../../../supabase/functions/_shared/signalCollectability.ts";

const FILTERS_SRC = await Deno.readTextFile(
  new URL("../../../src/components/signals/workspace/SignalsFilters.tsx", import.meta.url),
);

/** The filter ids the UI actually offers, read from the UI. */
function uiFilters(): string[] {
  const block = FILTERS_SRC.slice(
    FILTERS_SRC.indexOf("const SECONDARY_OPTIONS"),
    FILTERS_SRC.indexOf("interface Props"),
  );
  return [...block.matchAll(/id:\s*'([a-z_]+)'/g)].map((m) => m[1]);
}

/**
 * Radar sources that still EXIST as collectors.
 *
 * Not "enabled for this fixture". Several sources are gated on a Company Brain
 * preference — `linkedin_comments` needs comment topics — so a workspace that
 * has not configured one sees an empty category for a reason the workspace
 * controls. That is a setup state, not a missing collector, and conflating the
 * two would make this test fail for workspaces rather than for code.
 *
 * A RETIRED source does not count. It says so in its own reason, which is why
 * Phase 3H kept the plan entries instead of deleting them.
 */
function radarCollectors(): Set<string> {
  return new Set(
    radarPlan().source_plan
      .filter((p) => !/retired in phase/i.test(p.reason))
      .map((p) => p.source),
  );
}

/** Radar sources the planner enables for a fully configured workspace. */
function enabledRadarSources(): Set<string> {
  return new Set(radarPlan().source_plan.filter((p) => p.enabled).map((p) => p.source));
}

function radarPlan() {
  const brain = compileCompanyBrainContext({
    workspace_id: "ws",
    profile: {
      company: { name: "Agentory", stage: "seed", location: "United States", category: "B2B SaaS" },
      gtm: { motion: "outbound" },
      icp: { industries: ["B2B SaaS"], geography: "United States", company_size: "10-200" },
      competitors: { known: ["Clay", "Apollo"] },
      signal_preferences: {
        workflow_topics: ["outbound automation"],
        linkedin_topics: ["founder-led sales"],
      },
    },
  });
  return buildRadarScanPlan(brain, { firecrawlReady: true, apifyReady: true });
}

/**
 * What collects each filter, or null when nothing does.
 *
 * `saved`, `reviewed`, `ignored` and `all` are VIEWS over signals already
 * collected, not categories of their own — they need no collector, and saying
 * so explicitly is what stops them being counted as coverage.
 */
const VIEWS = new Set(["all", "saved", "reviewed", "ignored"]);

const RADAR_SOURCE_FOR_FILTER: Readonly<Record<string, string>> = Object.freeze({
  linkedin: "linkedin_posts",
  comments: "linkedin_comments",
  workflows: "workflow_trends",
});

/**
 * Filters collected by a Radar ADAPTER rather than a planned source.
 *
 * `people` is the decision-maker search: it runs from `run-radar-scan` directly
 * against its own Apify adapter, not through the scan plan, so it appears in no
 * `source_plan`. Read from the scan's source so a removed adapter fails here.
 */
const ADAPTER_FOR_FILTER: Readonly<Record<string, string>> = Object.freeze({
  people: "peopleAdapterStatus",
});

const RADAR_SCAN_SRC = await Deno.readTextFile(
  new URL("../../../supabase/functions/run-radar-scan/index.ts", import.meta.url),
);

Deno.test("1. every UI filter is a view, or something collects it", () => {
  const radar = radarCollectors();
  const missing: string[] = [];

  for (const f of uiFilters()) {
    if (VIEWS.has(f)) continue;

    const radarSource = RADAR_SOURCE_FOR_FILTER[f];
    const byRadar = radarSource ? radar.has(radarSource) : false;
    const adapter = ADAPTER_FOR_FILTER[f];
    const byAdapter = adapter ? RADAR_SCAN_SRC.includes(adapter) : false;
    // A monitoring signal named the same as the filter, collectible for ANY
    // subject kind, counts too.
    const byMonitoring = (["icp", "tracked_company", "competitor"] as const)
      .some((k) => signalCollectability(f, k).collectible);

    if (!byRadar && !byAdapter && !byMonitoring) missing.push(f);
  }

  assertEquals(
    missing, [],
    `these filters have nothing behind them: ${missing.join(", ")}. Either wire a ` +
    `collector or remove the filter — a category that can only ever be empty is ` +
    `worse than no category.`,
  );
});

Deno.test("2. funding is the one the audit named, and it now has a collector", () => {
  assert(uiFilters().includes("funding"), "the funding filter is still offered");
  // Radar's funding source was RETIRED in Phase 3H — it could not name the
  // company it was about — so the collector must be the capability engine.
  assertEquals(enabledRadarSources().has("funding"), false, "Radar no longer collects funding");
  const c = signalCollectability("funding", "icp");
  assert(c.collectible, `nothing collects funding: ${c.reason}`);
  assertEquals(c.proven_by, "funding_signal_discovery");
});

Deno.test("3. a retired Radar source does not count as coverage", () => {
  // The failure this guards: retiring a source while its filter stays, so the
  // filter silently becomes permanently empty.
  const collectors = radarCollectors();
  const enabled = enabledRadarSources();
  for (const retired of ["hiring", "funding"]) {
    assertEquals(enabled.has(retired), false, `${retired} must not be enabled`);
    assertEquals(collectors.has(retired), false, `${retired} is retired and must not count`);
  }
  // A source gated on a Brain preference is NOT retired — it is unconfigured,
  // which is the workspace's state and not the code's.
  assertEquals(enabled.has("linkedin_comments"), false, "needs comment topics");
  assertEquals(collectors.has("linkedin_comments"), true, "but it is still a collector");
});

Deno.test("4. the views are views, and are not miscounted as collectors", () => {
  for (const v of ["saved", "reviewed", "ignored", "all"]) {
    assert(VIEWS.has(v));
    // None of them is a signal anything collects — if one ever becomes a real
    // category it must acquire a collector rather than inherit this exemption.
    for (const k of ["icp", "tracked_company", "competitor"] as const) {
      assertEquals(
        signalCollectability(v, k).collectible, false,
        `${v} is a view, not a collectible signal`,
      );
    }
  }
});

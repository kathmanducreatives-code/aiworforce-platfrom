// Radar source registry + honest per-source readiness. Pure (no React/network) —
// Deno-testable. Describes each Scout Radar source, which provider powers it, and
// whether it is currently runnable given real provider readiness + enable flags.
//
// Rule: never claim a capability is blocked when a working fallback exists. Hiring
// and posts have a Firecrawl fallback, so they are "ready" (basic) on Firecrawl
// alone and only "richer" with Apify. Comments/people have no fallback and require
// Apify. Nothing here runs a provider — it only reports status.

export type RadarSourceKey =
  | "hiring"
  | "linkedin_posts"
  | "comments"
  | "competitor"
  | "funding"
  | "workflow"
  | "people";

export type RadarProvider = "firecrawl" | "apify" | "apify_optional";
export type SourceState = "ready" | "ready_basic" | "setup_needed" | "flag_off";

export interface RadarSourceDef {
  key: RadarSourceKey;
  label: string;
  /** Primary provider that gives the best-fidelity signals. */
  provider: RadarProvider;
  /** True when Firecrawl search can produce a lower-fidelity version. */
  firecrawlFallback: boolean;
  /** Comments can only run once a post URL is known. */
  requiresPostUrl: boolean;
  /** Default per-scan cap (persisted signals from this source). */
  defaultCap: number;
  description: string;
}

// Registry — the six target sources plus people (verified-workflow only).
export const RADAR_SOURCES: RadarSourceDef[] = [
  { key: "hiring", label: "Hiring", provider: "apify", firecrawlFallback: true, requiresPostUrl: false, defaultCap: 10,
    description: "ICP/competitor companies hiring growth, sales, RevOps or ops roles." },
  { key: "linkedin_posts", label: "LinkedIn posts", provider: "apify", firecrawlFallback: true, requiresPostUrl: false, defaultCap: 10,
    description: "Recent posts in your niche revealing pain, demand or competitor mentions." },
  { key: "comments", label: "Comments", provider: "apify", firecrawlFallback: false, requiresPostUrl: true, defaultCap: 30,
    description: "Pain and intent in comments under a known relevant post." },
  { key: "competitor", label: "Competitors", provider: "firecrawl", firecrawlFallback: true, requiresPostUrl: false, defaultCap: 15,
    description: "Competitor launches, pricing, changelog, careers and content changes." },
  { key: "funding", label: "Funding", provider: "apify_optional", firecrawlFallback: true, requiresPostUrl: false, defaultCap: 10,
    description: "Recently funded ICP companies now building revenue (source-proofed)." },
  { key: "workflow", label: "Workflows", provider: "firecrawl", firecrawlFallback: true, requiresPostUrl: false, defaultCap: 10,
    description: "Category/workflow trends relevant to your Company Brain." },
  { key: "people", label: "People", provider: "apify", firecrawlFallback: false, requiresPostUrl: false, defaultCap: 0,
    description: "Decision-maker discovery — verified company workflows only, not broad scanning." },
];

export interface SourceStatus {
  key: RadarSourceKey;
  label: string;
  provider: RadarProvider;
  state: SourceState;
  /** Human-readable, capability-specific explanation. */
  reason: string;
  /** True when a scan can produce signals for this source right now. */
  runnable: boolean;
}

export interface ReadinessInput {
  firecrawlReady: boolean;
  apifyReady: boolean;
  /** Per-source enable flags; default enabled when omitted. */
  flags?: Partial<Record<RadarSourceKey, boolean>>;
}

function statusFor(def: RadarSourceDef, input: ReadinessInput): SourceStatus {
  const base = { key: def.key, label: def.label, provider: def.provider };
  const enabled = input.flags?.[def.key] ?? true;
  if (!enabled) {
    return { ...base, state: "flag_off", runnable: false, reason: `${def.label} source is turned off.` };
  }

  const apifyPrimary = def.provider === "apify" || def.provider === "apify_optional";

  // Apify is fully ready → best fidelity.
  if (apifyPrimary && input.apifyReady) {
    return { ...base, state: "ready", runnable: true, reason: `Ready via Apify${def.firecrawlFallback ? " (+ Firecrawl)" : ""}.` };
  }

  // Firecrawl-only providers.
  if (def.provider === "firecrawl") {
    return input.firecrawlReady
      ? { ...base, state: "ready", runnable: true, reason: "Ready via Firecrawl search." }
      : { ...base, state: "setup_needed", runnable: false, reason: "Firecrawl API key required." };
  }

  // Apify-primary with a Firecrawl fallback (hiring, posts, funding).
  if (def.firecrawlFallback && input.firecrawlReady) {
    return { ...base, state: "ready_basic", runnable: true,
      reason: `Basic coverage via Firecrawl. Full ${def.label.toLowerCase()} scraping needs Apify.` };
  }

  // Apify-primary, no fallback available (comments, people) or Firecrawl also missing.
  if (def.requiresPostUrl) {
    return { ...base, state: "setup_needed", runnable: false,
      reason: "Needs an Apify token and a known post URL." };
  }
  return { ...base, state: "setup_needed", runnable: false,
    reason: `Needs an Apify token for LinkedIn ${def.label.toLowerCase()}.` };
}

/** Honest per-source status for the whole radar. */
export function computeSourceStatuses(input: ReadinessInput): SourceStatus[] {
  return RADAR_SOURCES.map((def) => statusFor(def, input));
}

/** Keys of sources a scan can actually run right now. */
export function runnableSourceKeys(input: ReadinessInput): RadarSourceKey[] {
  return computeSourceStatuses(input).filter((s) => s.runnable).map((s) => s.key);
}

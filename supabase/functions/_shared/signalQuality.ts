// Phase 6 — Signal quality scoring for the ICP-aware radar.
// Pure function: no imports, no I/O. Safe to unit-test under Deno + Node.

export type SignalSourceType =
  | "hiring"
  | "linkedin_intent"
  | "competitor"
  | "workflow_trend"
  | "people";

export interface RawSignalInput {
  title?: string;
  description?: string;
  source_url?: string;
  source?: string;
  signal_label?: string;
  created_at?: string;
  account_name?: string;
  role_title?: string;
  location?: string;
  competitor_name?: string;
  matched_query?: string;
  post_snippet?: string;
  raw?: Record<string, unknown>;
}

export interface SignalPreferences {
  keywords?: string[];
  competitors?: string[];
  hiring_roles?: string[];
  linkedin_topics?: string[];
  workflow_topics?: string[];
  geographies?: string[];
  industries?: string[];
  pain_points?: string[];
  disqualifiers?: string[];
  default_mix?: {
    hiring?: number;
    linkedin_intent?: number;
    competitors?: number;
    workflows?: number;
    people?: number;
  };
  frequency?: "weekly" | "daily" | "manual";
  strict_geography?: boolean;
}

export interface CompanyBrainLite {
  icp?: {
    industries?: string[];
    buyer_roles?: string[];
    geography?: string;
    pain_points?: string[];
    disqualifiers?: string[];
  };
  competitors?: { known?: string[]; adjacent?: string[] };
  positioning?: { promise?: string };
}

export interface SignalEvaluation {
  accepted: boolean;
  priority: "high" | "medium" | "low";
  score: number;
  reason: string;
  matched_icp: string[];
  missing_context: string[];
  next_action: string;
}

const INTENT_VERBS = [
  "looking for", "hiring", "frustrated", "need help", "anyone use",
  "alternative to", "switching from", "automate", "manual", "scaling",
  "we just", "we're building", "asking for", "recommend",
];

const SOURCE_CONFIDENCE: Record<string, number> = {
  hiring: 0.85,
  linkedin_intent: 0.55,
  competitor: 0.65,
  workflow_trend: 0.50,
  people: 0.60,
};

const HASH_BUCKET_NAMES = ["hiring", "linkedin_intent", "competitor", "workflow_trend", "people"];

function norm(s: unknown): string { return typeof s === "string" ? s.toLowerCase() : ""; }
function toArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];
}
function hasAny(haystack: string, needles: string[]): string | null {
  const h = haystack.toLowerCase();
  for (const n of needles) { if (n && h.includes(n.toLowerCase())) return n; }
  return null;
}

function recencyScore(iso: string | undefined): number {
  if (!iso) return 0.5;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 0.5;
  const ageHours = (Date.now() - t) / 3_600_000;
  if (ageHours <= 24) return 1;
  if (ageHours <= 24 * 7) return 0.8;
  if (ageHours <= 24 * 30) return 0.5;
  return 0.25;
}

function nextActionFor(type: SignalSourceType): string {
  switch (type) {
    case "hiring": return "Find decision-maker";
    case "linkedin_intent": return "Draft comment or save lead";
    case "competitor": return "Research company and draft counter-positioning";
    case "workflow_trend": return "Save as workflow idea";
    case "people": return "Enrich and add to CRM";
  }
}

export function evaluateSignalQuality(args: {
  signal: RawSignalInput;
  companyBrain: CompanyBrainLite | null | undefined;
  signalPreferences: SignalPreferences | null | undefined;
  sourceType: SignalSourceType;
}): SignalEvaluation {
  const { signal, companyBrain, signalPreferences, sourceType } = args;
  const brain = companyBrain ?? {};
  const prefs = signalPreferences ?? {};

  const text = [
    signal.title, signal.description, signal.post_snippet, signal.signal_label,
    signal.role_title, signal.account_name, signal.competitor_name, signal.matched_query,
  ].filter(Boolean).join(" ").toLowerCase();

  const matched: string[] = [];
  const missing: string[] = [];

  // ---- disqualifiers (hard reject) ----
  const allDisq = [...toArr(prefs.disqualifiers), ...toArr(brain.icp?.disqualifiers)];
  const disqHit = hasAny(text, allDisq);
  if (disqHit) {
    return {
      accepted: false, priority: "low", score: 0,
      reason: `Matches disqualifier "${disqHit}"`,
      matched_icp: [], missing_context: [], next_action: "Ignore",
    };
  }

  // ---- no actionable content reject ----
  if (!signal.title && !signal.description && !signal.post_snippet) {
    return {
      accepted: false, priority: "low", score: 0,
      reason: "Empty signal (no title, description, or snippet)",
      matched_icp: [], missing_context: ["title", "description"], next_action: "Ignore",
    };
  }

  let score = 0;
  score += (SOURCE_CONFIDENCE[sourceType] ?? 0.5) * 25; // 0-25
  score += recencyScore(signal.created_at) * 15;        // 0-15

  // industries
  const industries = [...toArr(prefs.industries), ...toArr(brain.icp?.industries)];
  const indHit = hasAny(text, industries);
  if (indHit) { score += 15; matched.push(`industry:${indHit}`); }

  // buyer roles / hiring roles
  const roles = sourceType === "hiring"
    ? [...toArr(prefs.hiring_roles), ...toArr(brain.icp?.buyer_roles)]
    : toArr(brain.icp?.buyer_roles);
  const roleHit = hasAny(text, roles);
  if (roleHit) { score += 15; matched.push(`role:${roleHit}`); }

  // competitors
  const competitors = [
    ...toArr(prefs.competitors),
    ...toArr(brain.competitors?.known),
    ...toArr(brain.competitors?.adjacent),
  ];
  const compHit = hasAny(text, competitors);
  if (compHit) {
    score += sourceType === "competitor" ? 20 : 10;
    matched.push(`competitor:${compHit}`);
  } else if (sourceType === "competitor" && competitors.length > 0) {
    missing.push("competitor mention");
  }

  // keywords / linkedin topics / workflow topics / pain points
  const topicPool = [
    ...toArr(prefs.keywords),
    ...toArr(sourceType === "linkedin_intent" ? prefs.linkedin_topics : []),
    ...toArr(sourceType === "workflow_trend" ? prefs.workflow_topics : []),
    ...toArr(prefs.pain_points),
    ...toArr(brain.icp?.pain_points),
  ];
  const topicHit = hasAny(text, topicPool);
  if (topicHit) { score += 10; matched.push(`topic:${topicHit}`); }

  // intent verbs (for linkedin / competitor / workflow)
  if (sourceType !== "hiring" && sourceType !== "people") {
    const intentHit = hasAny(text, INTENT_VERBS);
    if (intentHit) { score += 8; matched.push(`intent:${intentHit}`); }
  }

  // geography
  const geos = [...toArr(prefs.geographies), brain.icp?.geography].filter((s): s is string => !!s);
  if (geos.length > 0) {
    const geoHit = hasAny(text, geos);
    if (geoHit) { score += 5; matched.push(`geo:${geoHit}`); }
    else if (prefs.strict_geography) {
      return {
        accepted: false, priority: "low", score,
        reason: "Geography does not match strict radar settings",
        matched_icp: matched, missing_context: ["geography"], next_action: "Ignore",
      };
    } else {
      missing.push("geography");
    }
  }

  // weak floor
  if (score < 25) {
    return {
      accepted: false, priority: "low", score,
      reason: "Score below acceptance threshold",
      matched_icp: matched, missing_context: missing, next_action: "Ignore",
    };
  }

  const priority: "high" | "medium" | "low" =
    score >= 65 ? "high" : score >= 45 ? "medium" : "low";

  const reasonParts: string[] = [];
  if (matched.length) reasonParts.push(`Matched ${matched.length} ICP signal${matched.length > 1 ? "s" : ""}`);
  reasonParts.push(`source confidence ${(SOURCE_CONFIDENCE[sourceType] * 100).toFixed(0)}%`);
  const reason = reasonParts.join(" · ");

  return {
    accepted: true,
    priority,
    score: Math.round(score),
    reason,
    matched_icp: matched,
    missing_context: missing,
    next_action: nextActionFor(sourceType),
  };
}

/** Default 10-signal mix: 3 hiring / 3 linkedin / 2 competitor / 2 workflow. */
export const DEFAULT_SIGNAL_MIX = {
  hiring: 3,
  linkedin_intent: 3,
  competitor: 2,
  workflow_trend: 2,
  people: 0,
} as const;

export function resolveSignalMix(prefs: SignalPreferences | null | undefined): Record<string, number> {
  const m = prefs?.default_mix ?? {};
  const mix = {
    hiring: m.hiring ?? DEFAULT_SIGNAL_MIX.hiring,
    linkedin_intent: m.linkedin_intent ?? DEFAULT_SIGNAL_MIX.linkedin_intent,
    competitor: m.competitors ?? DEFAULT_SIGNAL_MIX.competitor,
    workflow_trend: m.workflows ?? DEFAULT_SIGNAL_MIX.workflow_trend,
    people: m.people ?? DEFAULT_SIGNAL_MIX.people,
  };
  return mix;
}

/** Stable de-dupe key: prefer source_url, fall back to title hash. */
export function signalDedupeKey(s: RawSignalInput): string {
  if (s.source_url) return `url:${s.source_url.trim().toLowerCase()}`;
  const t = `${s.title ?? ""}|${s.account_name ?? ""}|${s.competitor_name ?? ""}`.toLowerCase().trim();
  return `t:${t}`;
}

export function dedupeSignals<T extends RawSignalInput>(
  candidates: T[],
  existingKeys: ReadonlySet<string>,
): T[] {
  const seen = new Set(existingKeys);
  const out: T[] = [];
  for (const s of candidates) {
    const key = signalDedupeKey(s);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

// re-exported for clarity in test
export const _HASH_BUCKET_NAMES = HASH_BUCKET_NAMES;

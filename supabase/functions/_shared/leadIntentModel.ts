// Separated Find Leads intent + source routing. Pure / import-free.
//
// Root cause it fixes: "find founders …" conflated the target PERSONA with the
// SOURCE STRATEGY, so the system ran a person-profile search and returned
// profile-only "leads" with no verified company or signal. This module keeps
// persona, company profile, signal and role family as SEPARATE concepts and
// routes signal-based requests account-first (companies → verify signal →
// resolve the decision maker). Profile-first is allowed only for a direct
// named-company lookup.

// ── R1 CLASSIFICATION: COMPATIBILITY ────────────────────────────────────────
//
// Live non-test callers: run-agent/index.ts, orchestrate/index.ts. Same split as
// leadIntent.ts: the persona/target extraction duplicates what the Mission now
// carries, while the source-strategy routing is code's own decision and stays.
//
// DELETE-LATER applies to the extraction half only, after R2. Not dead today.

import { requestedRoleFamily, type RoleFamily } from "./roleFamilyMatcher.ts";

export type SourceStrategy = "account_first" | "profile_first";
export type DecisionMakerStrategy = "resolve_after_account" | "direct_lookup" | "none";

export interface SeparatedIntent {
  original_query: string;
  target_personas: string[];               // WHO to contact (Founder/CEO/…)
  target_company_profile: {
    categories: string[];
    company_size?: { min?: number; max?: number };
  };
  requested_signal: "required" | "preferred" | "none";
  requested_role_family: RoleFamily | null; // hiring role family, if any
  role_exactness: "hard" | "soft" | "none";
  geography: { values: string[]; hard: boolean };
  hard_exclusions: string[];
  evidence_requirements: string[];
  source_strategy: SourceStrategy;
  decision_maker_strategy: DecisionMakerStrategy;
  result_limit: number;
  relaxation_policy: {
    geography: "never" | "last_resort";
    role_family: "never" | "adjacent_watch_only";
    size: "soft" | "hard";
  };
}

const lc = (s: string) => s.toLowerCase();

const PERSONA_PATTERNS: Array<{ re: RegExp; personas: string[] }> = [
  { re: /\b(co[- ]?founders?|founders?)\b/i, personas: ["Founder", "Co-Founder", "CEO"] },
  { re: /\bceos?\b/i, personas: ["CEO", "Founder"] },
  { re: /\bhead of (sales|revenue|growth)\b/i, personas: ["Head of Sales", "Head of Revenue", "Head of Growth"] },
  { re: /\bhead of talent\b/i, personas: ["Head of Talent", "Founder"] },
];

const SIGNAL_PHRASES = /\b(reason to talk|why now|ready to buy|buying signal|hot leads?|hiring|recently funded|raised|growth activity|product launch|outbound expansion|scaling|clear reason)\b/i;

// A profile-first lookup is only for named companies ("at Acme, Globex").
const NAMED_COMPANY_LOOKUP = /\b(profiles? of|linkedin profiles?|find the (founder|ceo)s? (of|at))\b/i;

export interface BrainForIntent {
  industries?: string[];
  disqualifiers?: string[];
  geography?: string | string[];
  buyer_roles?: string[];
}

export function separateIntent(opts: { message: string; brain?: BrainForIntent | null; parsedCategories?: string[]; parsedGeographyHard?: boolean; parsedLocations?: string[]; hardExclusions?: string[] }): SeparatedIntent {
  const message = (opts.message ?? "").trim();
  const brain = opts.brain ?? null;

  // Personas (who to contact) — never a source strategy.
  const target_personas: string[] = [];
  for (const p of PERSONA_PATTERNS) if (p.re.test(message)) for (const x of p.personas) if (!target_personas.includes(x)) target_personas.push(x);
  if (target_personas.length === 0 && brain?.buyer_roles?.length) target_personas.push(...brain.buyer_roles);

  // Requested hiring role family + exactness.
  const requested_role_family = requestedRoleFamily(message);
  const role_exactness: SeparatedIntent["role_exactness"] = requested_role_family ? "hard" : "none";

  // Signal requirement.
  const requested_signal: SeparatedIntent["requested_signal"] = SIGNAL_PHRASES.test(message) ? "required" : "none";

  // Geography (hard when explicitly named unless opt-out). Prefer caller-parsed
  // locations; otherwise self-detect a named geography from the message so the
  // hard-filter guard never depends on an upstream parser being wired.
  const NAMED_GEO = /\b(united states|usa|\bus\b|united kingdom|\buk\b|canada|germany|france|netherlands|europe|emea|apac|india|australia|singapore|new york|san francisco|london)\b/i;
  const optOut = /\b(anywhere|global(ly)?|worldwide)\b/i.test(message);
  const detectedLocations = opts.parsedLocations && opts.parsedLocations.length
    ? opts.parsedLocations
    : (NAMED_GEO.test(message) ? [(message.match(NAMED_GEO)![0])] : []);
  const geoHard = opts.parsedGeographyHard ?? (detectedLocations.length > 0 && !optOut);
  const geography = { values: detectedLocations, hard: geoHard };

  // Source routing — THE key decision.
  // A direct named-company profile lookup → profile_first.
  // Anything signal/persona-based → account_first (companies → signal → person).
  const source_strategy: SourceStrategy = NAMED_COMPANY_LOOKUP.test(message) ? "profile_first" : "account_first";
  const decision_maker_strategy: DecisionMakerStrategy =
    source_strategy === "profile_first" ? "direct_lookup"
      : (target_personas.length ? "resolve_after_account" : "none");

  // Evidence requirements grow with a required signal.
  const evidence_requirements = ["company_identity", "source_url"];
  if (requested_signal === "required") evidence_requirements.push("company_level_signal", "signal_evidence_url");
  if (requested_role_family) evidence_requirements.push("exact_role_family_job_post");
  if (decision_maker_strategy !== "none") evidence_requirements.push("decision_maker_profile_url");

  const hard_exclusions = [...new Set([...(opts.hardExclusions ?? []), ...(brain?.disqualifiers ?? [])])];

  const countMatch = message.match(/\b(?:find|up to|get)\s+(\d{1,3})\b/i);
  const result_limit = countMatch ? Math.max(1, Math.min(50, Number(countMatch[1]))) : 5;

  return {
    original_query: message,
    target_personas,
    target_company_profile: { categories: opts.parsedCategories ?? brain?.industries ?? [] },
    requested_signal,
    requested_role_family,
    role_exactness,
    geography,
    hard_exclusions,
    evidence_requirements,
    source_strategy,
    decision_maker_strategy,
    result_limit,
    relaxation_policy: {
      geography: geoHard ? "never" : "last_resort",
      role_family: requested_role_family ? "adjacent_watch_only" : "never",
      size: "soft",
    },
  };
}

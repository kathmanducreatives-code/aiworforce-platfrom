// ONE COMMERCIAL VOCABULARY, FOR THE WHOLE FUNNEL.
//
// TEST continuation 90bad481 discovered 50 companies, read 177 embedded YC roles,
// scored 15 as commercially eligible, shortlisted 10, resolved and enriched 7 —
// and sent ZERO to the Company Brain. Not one rejection: `qualified_company_keys`
// and `unknown_company_keys` were both empty, because the Brain's eligible set
// was empty.
//
// THE CAUSE WAS TWO CONTRADICTORY ROLE VOCABULARIES.
//
// `leadCommercialPrequalification` accepted Tier A/B roles — "Head of Sales",
// "GTM Engineer", "Founding Account Executive". `hiring_verification` then
// filtered the SAME YC evidence through `DEFAULT_ROLE_PACKS`, whose Sales-Ops
// pack is literally:
//
//     ["Sales Operations Manager", "Sales Operations Lead",
//      "Head of Sales Operations", "Director of Sales Operations"]
//
// None of the shortlisted roles match. So the pipeline scored each company on one
// vocabulary and then verified it on another, discarded the free evidence it had
// already paid for, bought a LinkedIn job search per company instead, filtered
// those through the same narrow packs (3 searches, 12 rows, 0 kept), and hit the
// execution deadline at 109,009 ms with four companies never reached.
//
// This module is the single vocabulary. Prequalification, hiring verification,
// broadening rounds and the Workbench explanation all read it. A role list that
// exists in two places is a role list that will disagree in two places.
//
// PURE. No network, no provider, no database.

export const COMMERCIAL_POLICY_VERSION = "commercial-signal-policy-v1" as const;

export type SignalTier = "A" | "B" | "C";
export type TitleClass = SignalTier | "technical" | "other";

/**
 * TIER A — strong enough on its own.
 *
 * A company hiring one of these is standing up or rebuilding a commercial
 * motion. That is the buying trigger, whether or not the title contains the
 * literal words "Sales Operations".
 */
export const TIER_A_TITLES: readonly string[] = [
  "sales operations", "revenue operations", "gtm operations",
  "sales strategy and operations", "revenue strategy and operations",
  "sales strategy & operations", "revenue strategy & operations",
  "founding account executive", "founding sales representative",
  "founding sdr", "founding bdr", "first sales hire",
  "head of sales", "vp of sales", "vp sales", "vice president of sales",
  "gtm lead", "gtm engineer", "go-to-market lead",
  "deal desk", "sales enablement operations",
];

/** TIER B — real commercial hiring, but needs a second signal to stand alone. */
export const TIER_B_TITLES: readonly string[] = [
  "account executive", "corporate account executive", "enterprise account executive",
  "sdr", "bdr", "sales development representative", "business development representative",
  "sales director", "director of sales",
  "head of growth", "growth lead", "demand generation", "growth marketing",
  "marketing operations", "partnerships", "sales enablement", "enterprise sales",
  "head of customer success", "vp customer success", "director of customer success",
];

/** TIER C — relevant, but only ever WATCH/REVIEW on its own. */
export const TIER_C_TITLES: readonly string[] = [
  "business operations", "strategy and operations", "strategy & operations",
  "customer operations", "head of operations", "chief of staff",
  "customer success",
];

/** Never commercial evidence by itself, at any tier. */
export const TECHNICAL_TITLES: readonly string[] = [
  "software engineer", "full stack", "fullstack", "backend", "back-end",
  "frontend", "front-end", "ml engineer", "machine learning", "infrastructure",
  "product engineer", "designer", "devops", "platform engineer", "data engineer",
  "computer vision", "deep learning", "security engineer", "qa engineer",
  "founding engineer", "forward deployed engineer", "member of technical staff",
];

const lc = (v: unknown) => typeof v === "string" ? v.trim().toLowerCase() : "";

/**
 * The role list this run qualifies against.
 *
 * ONE VOCABULARY PER RUN — see the module header. This is not a second list
 * competing with the tiers below; it REPLACES them for the run when the Mission
 * named its own roles, and is absent otherwise. The decision is made once, in
 * `missionQualificationContext.buildQualificationContext`, and travels with the
 * context so prequalification and hiring verification cannot diverge.
 */
export interface RoleVocabulary {
  source: "mission" | "default_commercial";
  /** Normalized title fragments that qualify. Empty for `default_commercial`. */
  required_titles: readonly string[];
}

/**
 * Which tier does this job title belong to?
 *
 * COMMERCIAL TIERS ARE CHECKED BEFORE TECHNICAL, so "Sales Engineer" is not
 * discarded as engineering and "Founding Account Executive" is not discarded for
 * containing "founding".
 *
 * WHEN THE MISSION NAMED ITS OWN ROLES, THEY ARE THE VOCABULARY.
 *
 * TEST run cf6cce3d asked for companies hiring software engineers and qualified
 * none: "Software Engineer" is in `TECHNICAL_TITLES`, `technical` never produces
 * a qualifying tier, so 42 companies were excluded as `technical_only` — the
 * exact companies the Mission asked for. The commercial ladder below encodes
 * Agentory's own buyer, which is the right default and the wrong answer to a
 * Mission that named a different role.
 *
 * With a Mission vocabulary the commercial ladder is not consulted at all: a
 * matching title is tier A, everything else is `other` (or `technical` for
 * labelling). Without one, behaviour is byte-identical to before.
 */
export function classifyTitle(title: unknown, vocab?: RoleVocabulary | null): TitleClass {
  const t = lc(title);
  if (!t) return "other";
  if (vocab && vocab.source === "mission") {
    if (vocab.required_titles.some((k) => k && t.includes(k))) return "A";
    return TECHNICAL_TITLES.some((k) => t.includes(k)) ? "technical" : "other";
  }
  if (TIER_A_TITLES.some((k) => t.includes(k))) return "A";
  if (TIER_B_TITLES.some((k) => t.includes(k))) return "B";
  if (TIER_C_TITLES.some((k) => t.includes(k))) return "C";
  if (TECHNICAL_TITLES.some((k) => t.includes(k))) return "technical";
  return "other";
}

// ------------------------------------------------------- broadening rounds ----

/**
 * Ordered broadening. Round 1 is the user's literal intent; later rounds widen
 * the ROLE vocabulary only.
 *
 * Hard mission constraints — geography, B2B relevance, active company, employee
 * ceiling, identity correctness — are NEVER relaxed by a round. Broadening that
 * quietly drops a constraint stops answering the question that was asked.
 */
export interface BroadeningRound {
  round: 1 | 2 | 3 | 4;
  label: string;
  titles: readonly string[];
  /** The best tier a company found in this round can claim from role alone. */
  max_tier_from_role: SignalTier;
}

export const BROADENING_ROUNDS: readonly BroadeningRound[] = [
  {
    round: 1, label: "exact intent", max_tier_from_role: "A",
    titles: ["sales operations", "revenue operations", "gtm operations",
      "sales strategy and operations", "revenue strategy and operations"],
  },
  {
    round: 2, label: "strong adjacent commercial building", max_tier_from_role: "A",
    titles: ["head of sales", "vp sales", "vp of sales", "vice president of sales",
      "founding account executive", "founding sdr", "founding bdr",
      "gtm engineer", "first sales hire"],
  },
  {
    round: 3, label: "broader commercial expansion", max_tier_from_role: "B",
    titles: ["account executive", "sdr", "bdr", "sales director",
      "head of growth", "growth lead", "demand generation",
      "marketing operations", "partnerships"],
  },
  {
    round: 4, label: "review / watch signals", max_tier_from_role: "C",
    titles: ["business operations", "strategy and operations",
      "chief of staff", "customer operations", "head of operations"],
  },
];

/** The earliest round whose vocabulary contains this title, or null. */
export function roundForTitle(title: unknown): 1 | 2 | 3 | 4 | null {
  const t = lc(title);
  if (!t) return null;
  for (const r of BROADENING_ROUNDS) {
    if (r.titles.some((k) => t.includes(k))) return r.round;
  }
  return null;
}

// ---------------------------------------------------- hiring verification ----

/** Non-role evidence that lets a lone Tier B stand up. */
export type SupportingSignal =
  | "multiple_commercial_openings"
  | "recent_funding"
  | "market_expansion"
  | "product_launch"
  | "new_geography"
  | "commercial_leader_appointed"
  | "visible_team_growth"
  | "another_active_gtm_opening"
  | "founder_led_pipeline_need";

export interface CommercialJob {
  title: string;
  url?: string | null;
  location?: string | null;
  tier: TitleClass;
  round: 1 | 2 | 3 | 4 | null;
}

export type HiringVerdict =
  /** Proven from evidence already held. No paid call. */
  | "hiring_verified"
  /** Plausible, but one more fact is wanted before it counts. */
  | "hiring_verification_needed"
  /** Relevant, never auto-qualifying and never auto-rejecting. */
  | "watch"
  /** No relevant commercial signal at all. */
  | "hiring_not_verified";

export interface HiringAssessment {
  verdict: HiringVerdict;
  tier: SignalTier | null;
  strongest: CommercialJob | null;
  commercial_jobs: CommercialJob[];
  supporting_signals: SupportingSignal[];
  evidence_source: "yc_open_jobs" | "external_job_search" | "none";
  /** True only when the free evidence genuinely cannot settle it. */
  needs_external_verification: boolean;
  reason: string;
}

/**
 * Classify every job in an `openJobs` array. Never just the first.
 *
 * THE VOCABULARY TRAVELS. This used to call `classifyTitle(j?.title)` with no
 * second argument, which is the module header's own incident reproduced by an
 * omitted parameter: prequalification scored on the MISSION's role list while
 * `assessHiring` — the caller of this function — re-judged the same YC evidence
 * on the default commercial ladder. For a mission whose required role IS
 * "software engineer", every title came back `technical`, every verdict came
 * back `hiring_not_verified`, and `reachesCompanyBrain` refused the exact
 * companies the mission asked for.
 *
 * `round` is the GTM BROADENING ladder and has no meaning under a mission
 * vocabulary — a mission-decided title is round-less by construction, so it is
 * null rather than forced into a ladder it does not belong to. It is display
 * metadata only (see `leadCapabilityEngine`'s portfolio projection).
 */
export function classifyJobs(
  jobs: ReadonlyArray<{ title?: string | null; url?: string | null; location?: string | null }>,
  vocab?: RoleVocabulary | null,
): CommercialJob[] {
  const missionScoped = vocab?.source === "mission";
  return (jobs ?? [])
    .map((j) => ({
      title: String(j?.title ?? "").trim(),
      url: j?.url ?? null,
      location: j?.location ?? null,
      tier: classifyTitle(j?.title, vocab),
      round: missionScoped ? null : roundForTitle(j?.title),
    }))
    .filter((j) => j.title.length > 0);
}

/**
 * Decide hiring verification from evidence ALREADY HELD.
 *
 * This is the function whose absence cost the audited run everything. A current
 * Tier A role is proof on its own; a Tier B role with a second signal is proof; a
 * lone Tier B is a question, not a rejection; Tier C is a watch item. Paid
 * external verification is a FALLBACK for the lone-Tier-B case only — never the
 * default, and never a re-check of evidence the free pass already settled.
 */
export function assessHiring(
  jobs: ReadonlyArray<{ title?: string | null; url?: string | null; location?: string | null }>,
  supporting: readonly SupportingSignal[] = [],
  opts: {
    source?: "yc_open_jobs" | "external_job_search";
    /**
     * THE RUN'S SINGLE ROLE VOCABULARY, decided once from the Mission.
     *
     * Omitted, behaviour is byte-identical to before: the default commercial
     * ladder answers, which is correct for a missionless run. Supplied, it is
     * the SAME list prequalification scored on — that identity is the whole
     * point, and its absence is what this module's header describes.
     */
    vocab?: RoleVocabulary | null;
  } = {},
): HiringAssessment {
  const all = classifyJobs(jobs, opts.vocab);
  const source = opts.source ?? "yc_open_jobs";
  const commercial = all.filter((j) => j.tier === "A" || j.tier === "B" || j.tier === "C");
  const a = all.filter((j) => j.tier === "A");
  const b = all.filter((j) => j.tier === "B");
  const c = all.filter((j) => j.tier === "C");

  // MULTIPLE COMMERCIAL OPENINGS IS ITSELF A SUPPORTING SIGNAL, derived here so
  // callers do not each have to remember to pass it.
  const derived: SupportingSignal[] = [...supporting];
  if (a.length + b.length >= 2 && !derived.includes("multiple_commercial_openings")) {
    derived.push("multiple_commercial_openings");
  }

  const base = { commercial_jobs: commercial, supporting_signals: derived, evidence_source: source } as const;

  if (a.length > 0) {
    return {
      ...base, verdict: "hiring_verified", tier: "A", strongest: a[0],
      needs_external_verification: false,
      reason: `Tier A commercial role "${a[0].title}" is sufficient evidence on its own.`,
    };
  }
  if (b.length > 0 && derived.length > 0) {
    return {
      ...base, verdict: "hiring_verified", tier: "B", strongest: b[0],
      needs_external_verification: false,
      reason: `Tier B role "${b[0].title}" with supporting evidence (${derived.join(", ")}).`,
    };
  }
  if (b.length > 0) {
    return {
      ...base, verdict: "hiring_verification_needed", tier: "B", strongest: b[0],
      needs_external_verification: true,
      reason: `Lone Tier B role "${b[0].title}" — one more signal would settle it.`,
    };
  }
  if (c.length > 0) {
    return {
      ...base, verdict: "watch", tier: "C", strongest: c[0],
      needs_external_verification: false,
      reason: `Only Tier C signal "${c[0].title}" — relevant, but not qualifying on its own.`,
    };
  }
  const technical = all.filter((j) => j.tier === "technical").length;
  // THE REASON MUST NAME THE VOCABULARY IT JUDGED ON.
  //
  // "technical hiring is never commercial evidence" is a statement about
  // Agentory's own buyer. Said to a mission that ASKED for engineers it is
  // simply false, and it was the sentence on 33 exclusion rows in TEST run
  // d787cfc7 — companies excluded for hiring exactly what was requested.
  const missionScoped = opts.vocab?.source === "mission";
  const wanted = opts.vocab?.required_titles ?? [];
  return {
    ...base, verdict: "hiring_not_verified", tier: null, strongest: null,
    evidence_source: commercial.length ? source : "none",
    needs_external_verification: false,
    reason: missionScoped
      ? `No open role matches the mission's required role${
        wanted.length ? ` (${wanted.join(", ")})` : ""
      }${all.length ? `; ${all.length} other opening(s) present` : ""}.`
      : technical > 0
      ? `${technical} technical role(s) only — technical hiring is never commercial evidence.`
      : "No relevant commercial role found in the available evidence.",
  };
}

/**
 * Should a paid external job search run for this company?
 *
 * ONLY for a lone Tier B. Everything else is already settled by free evidence,
 * and re-checking it is what bought three useless LinkedIn searches and spent
 * the wall clock four other companies needed.
 */
export function needsPaidJobVerification(a: HiringAssessment): boolean {
  return a.verdict === "hiring_verification_needed";
}

/** Does this assessment let the company proceed to the Company Brain? */
export function reachesCompanyBrain(a: HiringAssessment): boolean {
  return a.verdict === "hiring_verified" ||
    a.verdict === "hiring_verification_needed" ||
    a.verdict === "watch";
}

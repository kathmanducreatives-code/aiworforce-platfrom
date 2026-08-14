// GPT MISSION INTELLIGENCE — THE FREE STAGE THAT DECIDES WHO IS WORTH PAYING FOR.
//
// WHAT THIS REPLACES, AND WHY IT HAD TO GO.
//
// `prequalifyYcCompanies` decided eligibility with `classifyTitle`, a SUBSTRING
// MATCH over a fixed vocabulary. A Mission asking for companies "hiring
// software engineers" produced the single fragment "software engineer", so:
//
//     Senior Software Engineer   → matched
//     ML Engineer                → technical  → EXCLUDED
//     Founding Engineer          → technical  → EXCLUDED
//     Member of Technical Staff  → technical  → EXCLUDED
//
// A company was then dropped BEFORE any paid stage and before any model saw it,
// on a judgement dressed as a mechanical filter. That is precisely the decision
// the Mission evaluator exists to make, taken by a string comparison, at the one
// point in the pipeline where it is irreversible.
//
// The answer is not a longer keyword list. Every extension of that list is
// another guess about a Mission nobody has read yet. GPT reads the Mission and
// the company together and answers the only question that matters here:
//
//     "Is this company plausibly worth paying to investigate for THIS Mission?"
//
// ── WHAT THIS IS NOT ─────────────────────────────────────────────────────────
//
// NOT the qualification decision. Triage answers "worth investigating?", the
// evaluator answers "does it satisfy the Mission?". Triage sees discovery-time
// data only — no LinkedIn identity, no enrichment, no verified headcount — and
// a stage that cannot see the evidence must not be allowed to qualify anything.
// Its verdicts are RELEVANT / UNCERTAIN / IRRELEVANT, deliberately not
// pass/fail, so the two can never be confused in telemetry or in code.
//
// ── COST ─────────────────────────────────────────────────────────────────────
//
// BATCHED. Companies go out in groups, so a hundred candidates cost a handful
// of calls rather than a hundred. This runs on the cheap tier and its whole
// purpose is to make the EXPENSIVE stages cheaper by pointing them at the right
// companies.
//
// PURE. No provider import, no network, no database.

import type { QualificationContext } from "./missionQualificationContext.ts";

export const MISSION_TRIAGE_VERSION = "mission-triage-v1" as const;
export const MISSION_TRIAGE_INPUT_VERSION = "mission-triage-input-v1" as const;

/**
 * How many companies go into one triage call.
 *
 * Large enough that a hundred candidates cost four calls, small enough that one
 * malformed response cannot cost the whole pool its triage — a dropped batch
 * degrades to `uncertain` for 25 companies, not for all of them.
 */
export const TRIAGE_BATCH_SIZE = 25;

/**
 * Is this company worth spending money to investigate?
 *
 *   relevant    plausibly satisfies the Mission — investigate first
 *   uncertain   cannot tell from discovery data alone — investigate if budget allows
 *   irrelevant  clearly not what the Mission asked for — do not pay for it
 *
 * UNCERTAIN IS THE SAFE DEFAULT AND IT IS NOT A REJECTION. Anything the model
 * fails to answer for lands here, because "we could not tell" must cost a
 * company its priority, never its place in the run.
 */
export type TriageRelevance = "relevant" | "uncertain" | "irrelevant";

export interface TriageVerdict {
  company_key: string;
  relevance: TriageRelevance;
  /** 0-1. How sure the model is, used to order within a relevance tier. */
  confidence: number;
  /**
   * 0-100. How strong this company's Mission signal looks — the hiring
   * evidence, the stage, the shape of the business. Orders the shortlist.
   */
  signal_strength: number;
  /** Short, human-readable, and shown in telemetry. Never a decision. */
  reasons: string[];
  /** Roles the model read as satisfying the Mission's stated intent. */
  matched_roles: string[];
}

export interface TriageCompanyInput {
  company_key: string;
  name: string | null;
  domain: string | null;
  description: string | null;
  industries: string[];
  employee_count: number | null;
  location: string | null;
  /** Job titles as the provider wrote them. NEVER pre-filtered by keyword. */
  open_roles: string[];
}

export interface MissionTriageInput {
  schema_version: typeof MISSION_TRIAGE_INPUT_VERSION;
  instruction: string;
  mission: Record<string, unknown>;
  companies: TriageCompanyInput[];
}

/**
 * Build one batch's input.
 *
 * The Mission block is the SAME compiled context every other stage reads, so
 * triage cannot answer a different question from the one the evaluator will
 * later be asked. `role_vocabulary` is passed as a HINT and labelled as one —
 * it is what the deterministic matcher would have used, and the model is told
 * explicitly that it is not a whitelist.
 */
export function buildMissionTriageInput(i: {
  ctx: QualificationContext;
  companies: readonly TriageCompanyInput[];
}): MissionTriageInput {
  const { ctx } = i;
  return {
    schema_version: MISSION_TRIAGE_INPUT_VERSION,
    instruction:
      "Decide which of these companies are worth paying to investigate for the " +
      "mission. You are NOT deciding whether they qualify.",
    mission: {
      original_user_query: ctx.original_user_query,
      target_entity: ctx.target_entity,
      hard_constraints: ctx.hard_constraints,
      soft_preferences: ctx.soft_preferences,
      verticals: ctx.verticals,
      stages: ctx.stages,
      locations: ctx.locations,
      employee_range: ctx.employee_range,
      // A HINT, NOT A WHITELIST — see the prompt.
      role_hint: ctx.role_vocabulary,
      mission_owns: ctx.mission_owns,
    },
    companies: i.companies.map((c) => ({
      ...c,
      // BOUNDED. A company with 200 listings must not crowd out the other 24 in
      // its batch; the first 25 titles are more than enough to judge intent.
      open_roles: c.open_roles.slice(0, 25),
    })),
  };
}

export const MISSION_TRIAGE_PROMPT = [
  "You triage companies for a lead-generation mission.",
  "",
  "THE QUESTION: for each company, is it worth SPENDING MONEY to investigate",
  "further for this mission? You are not deciding whether it qualifies — a later",
  "stage does that with far better evidence. You are deciding where to spend.",
  "",
  "You see discovery-time data only: name, domain, self-reported description,",
  "industries, self-reported headcount, location and open role titles. You do",
  "NOT see verified headcount, LinkedIn data or enriched evidence. Judge",
  "accordingly, and prefer 'uncertain' to a confident guess.",
  "",
  "ROLES ARE SEMANTIC, NOT KEYWORDS. If the mission asks for companies hiring",
  "software engineers, then ML Engineer, AI Engineer, Backend Engineer,",
  "Founding Engineer, Member of Technical Staff and Senior Software Engineer all",
  "satisfy it. `role_hint` shows what a keyword matcher would have looked for —",
  "it is a hint about intent, NOT a whitelist. Do not reject a role for being",
  "absent from it, and do not accept a role merely for appearing in it. Read the",
  "mission's actual intent.",
  "",
  "VERDICTS:",
  "  relevant    plausibly satisfies the mission — worth paying for",
  "  uncertain   cannot tell from this data — worth paying for if budget allows",
  "  irrelevant  clearly not what the mission asked for",
  "",
  "Use 'irrelevant' ONLY when you can say what the mission asked for and why",
  "this company plainly is not it — a staffing agency when the mission wants",
  "product companies, a consumer app when it wants B2B infrastructure, no",
  "relevant hiring at all when hiring is the mission's stated signal. Missing or",
  "thin data is 'uncertain', never 'irrelevant'. Excluding a company here is",
  "final: nothing downstream can recover it.",
  "",
  "confidence is 0-1. signal_strength is 0-100 and expresses how strong this",
  "company's mission signal looks; it orders spending, so use the whole range.",
  "",
  "Return STRICT JSON, one entry per company, using the exact company_key given:",
  '{"verdicts":[{"company_key":"","relevance":"relevant|uncertain|irrelevant",',
  '"confidence":0.0,"signal_strength":0,"reasons":[""],"matched_roles":[""]}]}',
  "",
  "No prose, no markdown, no commentary outside the JSON.",
].join("\n");

export type TriageParseStatus = "valid" | "repaired" | "invalid_all_uncertain";

export interface ParsedMissionTriage {
  verdicts: Map<string, TriageVerdict>;
  parse_status: TriageParseStatus;
  raw_shape: {
    received: number;
    expected: number;
    /** Keys the model returned that were not in the batch. Dropped. */
    unknown_keys: string[];
    /** Keys the batch asked about that the model never answered. */
    missing_keys: string[];
    repaired_fields: string[];
  };
}

/** UNCERTAIN, with a reason. The shape every failure degrades to. */
export function uncertainVerdict(company_key: string, why: string): TriageVerdict {
  return {
    company_key, relevance: "uncertain", confidence: 0, signal_strength: 0,
    reasons: [why], matched_roles: [],
  };
}

const RELEVANCE: ReadonlySet<string> = new Set(["relevant", "uncertain", "irrelevant"]);

function num(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

function strArr(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, max);
}

/**
 * Parse a triage response, fail-closed toward UNCERTAIN.
 *
 * THE ONE RULE: nothing a malformed response does may EXCLUDE a company. An
 * unparseable batch, a missing entry, an unrecognised relevance value — every
 * one of them yields `uncertain`, which costs a company its priority and never
 * its place. Excluding here is irreversible, so it may only ever happen because
 * the model explicitly said `irrelevant` about a company it was actually asked
 * about.
 *
 * `expectedKeys` is authoritative: verdicts for companies outside the batch are
 * dropped, because a model that invents a company_key must not be able to reach
 * into a pool it was never shown.
 */
export function parseMissionTriageStrict(
  raw: unknown, expectedKeys: readonly string[],
): ParsedMissionTriage {
  const expected = new Set(expectedKeys);
  const verdicts = new Map<string, TriageVerdict>();
  const unknown_keys: string[] = [];
  const repaired_fields: string[] = [];

  const allUncertain = (why: string): ParsedMissionTriage => {
    for (const k of expectedKeys) verdicts.set(k, uncertainVerdict(k, why));
    return {
      verdicts,
      parse_status: "invalid_all_uncertain",
      raw_shape: {
        received: 0, expected: expectedKeys.length,
        unknown_keys: [], missing_keys: [...expectedKeys], repaired_fields: [],
      },
    };
  };

  let o = raw;
  if (typeof o === "string") {
    try { o = JSON.parse(o); } catch { return allUncertain("triage_response_not_json"); }
  }
  if (!o || typeof o !== "object") return allUncertain("triage_response_not_an_object");

  const list = (o as { verdicts?: unknown }).verdicts;
  if (!Array.isArray(list)) return allUncertain("triage_response_missing_verdicts");

  let received = 0;
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const key = String(e.company_key ?? "").trim();
    if (!key) continue;
    received++;
    if (!expected.has(key)) { unknown_keys.push(key); continue; }
    if (verdicts.has(key)) continue;                      // first answer wins

    const rawRel = String(e.relevance ?? "").trim().toLowerCase();
    let relevance: TriageRelevance;
    if (RELEVANCE.has(rawRel)) {
      relevance = rawRel as TriageRelevance;
    } else {
      // AN UNREADABLE VERDICT IS UNCERTAIN, NEVER IRRELEVANT.
      relevance = "uncertain";
      repaired_fields.push(`relevance:${key}`);
    }
    verdicts.set(key, {
      company_key: key,
      relevance,
      confidence: num(e.confidence, 0, 1, 0),
      signal_strength: Math.round(num(e.signal_strength, 0, 100, 0)),
      reasons: strArr(e.reasons, 5),
      matched_roles: strArr(e.matched_roles, 10),
    });
  }

  // ANYTHING THE MODEL DID NOT ANSWER FOR STAYS IN THE RUN.
  const missing_keys: string[] = [];
  for (const k of expectedKeys) {
    if (!verdicts.has(k)) {
      missing_keys.push(k);
      verdicts.set(k, uncertainVerdict(k, "triage_returned_no_verdict"));
    }
  }

  const clean = unknown_keys.length === 0 && missing_keys.length === 0 &&
    repaired_fields.length === 0;
  return {
    verdicts,
    parse_status: clean ? "valid" : "repaired",
    raw_shape: {
      received, expected: expectedKeys.length,
      unknown_keys, missing_keys, repaired_fields,
    },
  };
}

/** Split a pool into triage batches. */
export function triageBatches<T>(
  items: readonly T[], size: number = TRIAGE_BATCH_SIZE,
): T[][] {
  const n = Math.max(1, Math.trunc(size));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

/** Task-level counts. Zero triaged is a real outcome, not a missing measurement. */
export function summariseTriage(
  verdicts: Iterable<TriageVerdict>,
): Record<string, number> {
  const out = { relevant: 0, uncertain: 0, irrelevant: 0, total: 0 };
  for (const v of verdicts) {
    out.total++;
    out[v.relevance]++;
  }
  return out;
}

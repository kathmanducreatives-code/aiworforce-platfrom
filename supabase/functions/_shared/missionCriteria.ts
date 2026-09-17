// LEAD V2 P1 — MISSION MEANING, EXPLICIT AND STABLE.
//
// A mission used to carry its meaning across half a dozen carriers —
// `company_profile`, `required_signals`, `hard_constraints`, `soft_preferences`,
// `field_provenance`, `required_signal_terms`, `unrepresented_requirements` —
// and nothing said, in one place, what the user demanded versus preferred,
// what was inferred, what the Company Brain added, and which windows applied.
// Two readings of the same sentence could therefore disagree silently: the
// canonical smoke mission sometimes carried `hard_constraints.stage = "seed"`
// and sometimes did not, depending only on what the model wrote.
//
// This module gives every compiled mission one canonical representation:
//
//   goal · requested_count · criteria[] · canonical signals (+ aliases)
//
// where each criterion has a KIND (hard / target / opportunity_signal /
// hypothesis), a SOURCE (user_explicit / user_inferred / company_brain_policy /
// company_brain_preference / system_default), a time window where relevant and
// a confidence when inferred. Rules follow the plan's "Compilation rules" table:
// GPT proposes, code decides, the card confirms.
//
// ── WHAT P1 CHANGES ON THE EXISTING CARRIERS, AND WHY ONLY THIS ─────────────
//
// Criteria are the meaning. The legacy carriers still drive execution until
// P2 makes ProviderCallSpec authoritative, so P1 rewrites a carrier only where
// the carrier would otherwise contradict the stated meaning:
//   - required_signals: the leadership misread, hypothesis-only signals, and
//     user-stated signals the model dropped (locked rule 2: code owns truth);
//   - timeframe_days: the visible default window, except hiring (below);
//   - hard_constraints.stage vs soft_preferences.stage: ONLY/must → hard;
//     prefer/unqualified → target (plan example table);
//   - unrepresented_requirements: unrecognised signal language is recorded.
// Every rewrite is returned as a named change for `validator_changes`.
//
// HIRING'S DEFAULT WINDOW IS SHOWN, NOT CARRIED. A 30-day posting window on the
// hiring signal would reach evaluator prompts as "within 30 days" while no
// hiring source in the V2 route reads a posting date (YC `openJobs` carry
// none). Stating it as applied would be the silent mismatch this phase removes,
// so the card says it is a default not yet enforced; P3's job route enforces it.
//
// Pure. No network, no model, no database. Not part of `missionHash`.

import {
  canonicalSignalType, isHiringSignal,
  type FieldProvenance, type LeadMissionV1, type MissionSignal,
} from "./leadMission.ts";
import { readSignalPhrase, type SignalQualifier } from "./missionSignalDescriptor.ts";
import {
  CANONICAL_SIGNAL_KINDS, DEFAULT_SIGNAL_WINDOWS, EXEC_TITLE_RE, aliasKindFor,
  descriptorForReading, explicitWindowDays, kindForEvent, readCanonicalSignals,
  readHypotheses, unmappedSignalLanguage,
  type CanonicalSignalKind, type CanonicalSignalReading, type HypothesisReading, type WindowBasis,
} from "./signalKinds.ts";

export const MISSION_SEMANTICS_VERSION = "mission-semantics-v1" as const;

export type CriterionKind = "hard" | "target" | "opportunity_signal" | "hypothesis";
export type CriterionSource =
  | "user_explicit"
  | "user_inferred"
  | "company_brain_policy"
  | "company_brain_preference"
  | "system_default";

export type CriterionDimension =
  | CanonicalSignalKind
  | "geography" | "industry" | "business_model" | "company_size" | "company_stage"
  | "known_companies" | "exclusion" | "constraint"
  | "unrecognised_signal" | "unrepresentable_evidence";

export interface CriterionTimeWindow {
  days: number;
  basis: WindowBasis;
  source: CriterionSource;
  /** The phrase class a default is for. */
  rule?: string;
  /** False when the window is shown but no current step enforces it. */
  enforced: boolean;
}

export type CriterionStatus = "ok" | "unrecognised" | "unrepresentable" | "unprovable_today";

export interface MissionCriterion {
  id: string;
  kind: CriterionKind;
  dimension: CriterionDimension;
  value: unknown;
  /** One line for the card. */
  label: string;
  source: CriterionSource;
  time_window?: CriterionTimeWindow;
  /** Required when source = user_inferred. */
  confidence?: number;
  elevated_by?: "only" | "must" | "strictly" | "exactly" | "exclusively" | "excluding" | null;
  user_phrase: string;
  rationale: string;
  status: CriterionStatus;
}

export interface CanonicalSignalRecord {
  kind: CanonicalSignalKind;
  subkind?: string;
  /** The carrier event on `required_signals`. */
  legacy_event: string;
  subject: string;
  phrase: string;
  /** The alias that read it: "reader", a rule name, or "model" for GPT-only. */
  alias: string;
  source: CriterionSource;
}

export interface StageIntent {
  value: string;
  phrase: string;
  kind: "hard" | "target";
  elevated_by: MissionCriterion["elevated_by"];
  hedged: boolean;
}

export interface MissionSemanticsRecord {
  version: typeof MISSION_SEMANTICS_VERSION;
  /** The user's words. Immutable, like `original_user_query`. */
  goal: string;
  requested_count: number | null;
  canonical_signals: CanonicalSignalRecord[];
  hypotheses: HypothesisReading[];
  unmapped_signal_language: string[];
  stage: StageIntent | null;
  /** Where each signal's window came from, by canonical kind. */
  window_sources: Record<string, { source: CriterionSource; confidence?: number; rule?: string }>;
  /** Named rewrites of legacy carriers, also pushed to `validator_changes`. */
  corrections: string[];
}

// ── READING THE USER'S WORDS ────────────────────────────────────────────────

const ELEVATION_RE = /\b(only|must(?:\s+be)?|strictly|exactly|exclusively)\b/i;
/**
 * The plan's rule: "a phrase with a temporal word and no window is incomplete".
 * No temporal word, no default window — an unstated window must not become a
 * constraint (R1 contract).
 */
const TEMPORAL_CUE_RE =
  /\b(?:recent(?:ly)?|just|currently|actively|lately|newly|new|now|soon|this\s+(?:week|month|quarter|year)|in\s+the\s+(?:last|past))\b/i;
const HEDGE_RE = /\b(prefer(?:ably|red|ence for)?|ideally|bonus if|nice to have|if possible)\b/i;

const STAGE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bpre-?seed\b/i, "pre-seed"],
  [/\bseed(?:[- ]stage)?\b/i, "seed"],
  [/\bseries\s+([a-e])\b/i, "series_"],
  [/\bearly[- ]stage\b/i, "early_stage"],
];

/** Funding rounds, which no current discovery source proves per company. */
const ROUND_STAGES = new Set(["pre-seed", "seed", "series_a", "series_b", "series_c", "series_d", "series_e"]);

/**
 * A company-stage requirement the user stated, and how strongly.
 *
 * "raised a seed round" is a FUNDING qualifier, not a stage criterion, so a
 * stage word inside a funding phrase is left to the signal.
 */
export function readStageIntent(query: string): StageIntent | null {
  const text = String(query ?? "");
  for (const [re, value] of STAGE_PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    const around = text.slice(Math.max(0, m.index - 24), m.index + m[0].length + 8).toLowerCase();
    if (/\b(?:raised|raising|closed)\b|\bround\b/.test(around)) continue;
    const v = value === "series_" ? `series_${m[1].toLowerCase()}` : value;
    const before = text.slice(Math.max(0, m.index - 40), m.index);
    const clause = text.slice(Math.max(0, m.index - 60), Math.min(text.length, m.index + m[0].length + 60));
    const elevated = before.match(ELEVATION_RE);
    const hedged = HEDGE_RE.test(clause);
    const elevatedBy = elevated
      ? (elevated[1].toLowerCase().startsWith("must") ? "must" : elevated[1].toLowerCase()) as StageIntent["elevated_by"]
      : null;
    const phraseStart = elevated ? Math.max(0, m.index - 40) + (elevated.index ?? 0) : m.index;
    return {
      value: v,
      phrase: text.slice(phraseStart, m.index + m[0].length).trim(),
      kind: elevatedBy && !hedged ? "hard" : "target",
      elevated_by: elevatedBy && !hedged ? elevatedBy : null,
      hedged,
    };
  }
  return null;
}

/** Everything P1 reads out of the sentence, in one pass. */
export function readMissionLanguage(query: string) {
  const readings = readCanonicalSignals(query);
  const hypotheses = readHypotheses(query);
  return {
    readings,
    hypotheses,
    unmapped: unmappedSignalLanguage(query, readings, hypotheses),
    stage: readStageIntent(query),
    explicit_window_days: explicitWindowDays(query),
  };
}

const eventOf = (s: Partial<MissionSignal>): string =>
  String(s.event ?? canonicalSignalType(String(s.type ?? "")));

/**
 * The canonical kind a carried signal expresses. An unrecognised label the
 * model wrote ("social_post") is read through the same reader and aliases, so a
 * signal already carried under an odd name is not added a second time.
 */
const kindOfSignal = (s: Partial<MissionSignal>): CanonicalSignalKind | null => {
  const direct = kindForEvent(eventOf(s));
  if (direct) return direct;
  const label = String(s.type ?? s.phrase ?? "").replace(/[_-]+/g, " ").trim();
  if (!label) return null;
  return kindForEvent(readSignalPhrase(label)?.event) ?? aliasKindFor(label);
};

function signalWords(s: Partial<MissionSignal>): string {
  return [
    s.phrase ?? "", ...(s.qualifier?.role_terms ?? []), ...(s.role_families ?? []),
  ].join(" ");
}

// ── THE SEMANTIC PASS (compile time) ────────────────────────────────────────

export interface SemanticsInput {
  query: string;
  mission: LeadMissionV1;
  /** The validated model proposal's signal-level facts, when a model ran. */
  proposal?: { signal_recency_days: number | null; confidence: number } | null;
}

/**
 * Make the mission's meaning explicit, and correct the carriers that would
 * contradict it. Returns the mission (with `mission_semantics` and `criteria`)
 * and the named changes.
 */
export function compileMissionSemantics(i: SemanticsInput): { mission: LeadMissionV1; changes: string[] } {
  const query = String(i.query ?? i.mission.original_user_query ?? "");
  const lang = readMissionLanguage(query);
  const changes: string[] = [];
  const userKinds = new Set(lang.readings.map((r) => r.kind));
  let signals: MissionSignal[] = (i.mission.required_signals ?? []).map((s) => ({ ...s }));

  // 1. "just hired a VP Sales" is a leadership change, never an open-role search.
  if (userKinds.has("leadership_change")) {
    signals = signals.filter((s) => {
      if (!isHiringSignal(s)) return true;
      if (EXEC_TITLE_RE.test(signalWords(s)) || !userKinds.has("hiring")) {
        changes.push(`semantic_correction:hiring->leadership_change:${JSON.stringify(s.phrase ?? s.type)}`);
        return false;
      }
      return true;
    });
  }

  // 2. A hypothesis is not a verified signal. A signal the model added only
  //    because of "likely to need …" is not required.
  if (lang.hypotheses.length > 0) {
    signals = signals.filter((s) => {
      const k = kindOfSignal(s);
      if (k && !userKinds.has(k)) {
        changes.push(`hypothesis_not_a_verified_signal:${k}:${JSON.stringify(s.phrase ?? s.type)}`);
        return false;
      }
      return true;
    });
  }

  // 3. A signal the user stated is required, whatever the model wrote.
  for (const r of lang.readings) {
    if (signals.some((s) => kindOfSignal(s) === r.kind)) continue;
    signals.push(descriptorForReading(r) as unknown as MissionSignal);
    changes.push(`semantic_signal_added:${r.kind}:${JSON.stringify(r.phrase)}`);
  }

  // 4. Every signal with a temporal meaning gets a visible window.
  const windowSources: MissionSemanticsRecord["window_sources"] = {};
  signals = signals.map((s) => {
    const k = kindOfSignal(s);
    if (!k || k === "technology") return s;
    if (lang.explicit_window_days != null) {
      windowSources[k] = { source: "user_explicit" };
      if (s.timeframe_days !== lang.explicit_window_days) {
        changes.push(`window_from_user_words:${k}:${lang.explicit_window_days}d`);
      }
      return { ...s, timeframe_days: lang.explicit_window_days };
    }
    if (s.timeframe_days != null) {
      windowSources[k] = i.proposal?.signal_recency_days != null &&
          i.proposal.signal_recency_days === s.timeframe_days
        ? { source: "user_inferred", confidence: i.proposal.confidence }
        : { source: "system_default", rule: "carried from the compiled mission" };
      return s;
    }
    const d = DEFAULT_SIGNAL_WINDOWS[k];
    if (!d) return s;
    if (!TEMPORAL_CUE_RE.test(query)) return s; // no temporal word: nothing to default
    windowSources[k] = { source: "system_default", rule: d.rule };
    if (k === "hiring") return s; // shown, not carried — see the header
    changes.push(`window_defaulted:${k}:${d.days}d`);
    return { ...s, timeframe_days: d.days };
  });

  // 5. ONLY seed-stage is hard; prefer / unqualified seed-stage is a target.
  const hard: Record<string, unknown> = { ...(i.mission.hard_constraints ?? {}) };
  const soft: Record<string, unknown> = { ...(i.mission.soft_preferences ?? {}) };
  if (lang.stage) {
    if (lang.stage.kind === "hard") {
      const prior = (hard.stage as { value?: unknown } | undefined)?.value ?? hard.stage;
      if (prior !== lang.stage.value) {
        changes.push(`stage_hard_from_user_words:${lang.stage.value}:${lang.stage.elevated_by}`);
      }
      hard.stage = {
        operator: "equals", value: lang.stage.value,
        reason: `the request says "${lang.stage.phrase}"`,
      };
      if (soft.stage) delete soft.stage;
    } else {
      if (hard.stage) {
        changes.push(`stage_hard_constraint_demoted_to_target:${lang.stage.value}:` +
          (lang.stage.hedged ? "hedged" : "not_elevated"));
        delete hard.stage;
      }
      soft.stage = {
        value: lang.stage.value,
        reason: lang.stage.hedged
          ? `the request says "${lang.stage.phrase}" — a preference`
          : `stated without only/must — a target, not a hard constraint`,
      };
    }
  } else if (hard.stage) {
    changes.push("stage_hard_constraint_demoted_to_target:model_inferred");
    soft.stage = { value: (hard.stage as { value?: unknown })?.value ?? hard.stage,
      reason: "inferred by the model; the request states no stage" };
    delete hard.stage;
  }

  // 5b. "first growth marketer" / "founding AE": the hire is the first in its
  //     function. Read from the user's words only, attached to the hiring
  //     requirement it qualifies — never inferred, never a separate signal.
  const firstHire = firstInFunctionPhrase(query);
  if (firstHire) {
    let attached = false;
    signals = signals.map((s) => {
      if (!isHiringSignal(s)) return s;
      attached = true;
      const q = (s.qualifier ?? {}) as SignalQualifier;
      if (q.first_in_function) return s;
      changes.push(`first_in_function_from_user_words:${JSON.stringify(firstHire)}`);
      return { ...s, qualifier: { ...q, first_in_function: { phrase: firstHire, source: "user_explicit" } } };
    });
    if (!attached) changes.push(`first_in_function_without_hiring_signal:${JSON.stringify(firstHire)}`);
  }

  // 6. Signal language nothing could read is recorded, never dropped.
  const unrepresented = [...(i.mission.unrepresented_requirements ?? [])];
  for (const phrase of lang.unmapped) {
    const sentence = `"${phrase}" — not a signal this system recognises yet`;
    if (!unrepresented.includes(sentence)) {
      unrepresented.push(sentence);
      changes.push(`unrecognised_signal_recorded:${JSON.stringify(phrase)}`);
    }
  }

  const canonical: CanonicalSignalRecord[] = signals.flatMap((s) => {
    const k = kindOfSignal(s);
    if (!k) return [];
    const r = lang.readings.find((x) => x.kind === k);
    return [{
      kind: k,
      ...(r?.subkind ? { subkind: r.subkind } : {}),
      legacy_event: eventOf(s),
      subject: String(s.subject ?? r?.subject ?? "company"),
      phrase: String(r?.phrase ?? s.phrase ?? s.type),
      alias: r?.alias ?? "model",
      source: r ? "user_explicit" : "user_inferred",
    }];
  });

  const semantics: MissionSemanticsRecord = {
    version: MISSION_SEMANTICS_VERSION,
    goal: i.mission.original_user_query || query,
    requested_count: i.mission.requested_count ?? null,
    canonical_signals: canonical,
    hypotheses: lang.hypotheses,
    unmapped_signal_language: lang.unmapped,
    stage: lang.stage,
    window_sources: windowSources,
    corrections: changes,
  };
  const mission: LeadMissionV1 = {
    ...i.mission,
    required_signals: signals,
    hard_constraints: hard,
    soft_preferences: soft,
    ...(unrepresented.length ? { unrepresented_requirements: unrepresented } : {}),
    mission_semantics: semantics,
  };
  return { mission: { ...mission, criteria: deriveMissionCriteria(mission) }, changes };
}

// ── DERIVING CRITERIA (any time; after every Brain merge) ───────────────────

const sourceFromProvenance = (
  p: FieldProvenance | undefined, valueInQuery: boolean,
): CriterionSource => {
  switch (p) {
    case "explicit_user_request":
    case "workflow_edit": return "user_explicit";
    case "company_brain": return "company_brain_preference";
    case "company_brain_policy": return "company_brain_policy";
    case "system_default": return "system_default";
    case "gpt_inference": return valueInQuery ? "user_explicit" : "user_inferred";
    default: return valueInQuery ? "user_explicit" : "user_inferred";
  }
};

const slug = (v: unknown) =>
  String(typeof v === "string" ? v : JSON.stringify(v)).toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 60);

const SIGNAL_LABEL: Record<CanonicalSignalKind, string> = {
  hiring: "Hiring",
  funding: "Funding",
  product_launch: "Product launch",
  expansion: "Expansion",
  headcount_growth: "Headcount growth",
  leadership_change: "Leadership change",
  technology: "Technology",
  social_activity: "LinkedIn / social activity",
  company_profile: "Company profile",
};

const SOURCE_LABEL: Record<CriterionSource, string> = {
  user_explicit: "you said this",
  user_inferred: "inferred",
  company_brain_policy: "Company Brain rule",
  company_brain_preference: "from your Company Brain",
  system_default: "default",
};

/**
 * "first growth marketer", "founding AE", "our first sales hire". The word must
 * qualify a role, so "first round", "first-party data" and "first 30 days" do
 * not read as a first hire.
 */
const FIRST_IN_FUNCTION_RE =
  /\b(?:first|first-ever|founding)\s+(?:(?:in-house|full-time|dedicated|b2b|saas)\s+)?((?:[a-z&/-]+\s+){0,2}?(?:marketer|marketing\s+(?:hire|lead|manager)|growth(?:\s+(?:marketer|hire|lead|manager))?|sales(?:\s+(?:hire|rep|lead))?|seller|salesperson|ae|account\s+executive|sdr|bdr|engineer|designer|product\s+manager|pm|recruiter|hr|people\s+(?:hire|lead)|ops\s+hire|operations\s+(?:hire|lead)|customer\s+success(?:\s+(?:hire|manager|lead))?|cs\s+hire|data\s+(?:hire|scientist|engineer|analyst)|finance\s+(?:hire|lead)|content\s+(?:marketer|writer|hire)|hire))\b/i;

export function firstInFunctionPhrase(query: string): string | null {
  const m = FIRST_IN_FUNCTION_RE.exec(String(query ?? ""));
  return m ? m[0].trim() : null;
}

function signalDetail(k: CanonicalSignalKind, s: Partial<MissionSignal>, subkind?: string): string {
  const q = (s.qualifier ?? {}) as SignalQualifier & { direction?: string };
  const bits: string[] = [];
  if (q.role_terms?.length) bits.push(q.role_terms.join(", "));
  else if (s.role_families?.length) bits.push(s.role_families.join(", "));
  if (q.first_in_function) bits.push("first hire in the function");
  if (q.round_type) bits.push(q.round_type);
  if (q.region) bits.push(q.region);
  if (q.topic) bits.push(`about ${q.topic}`);
  if (subkind === "geographic_expansion" && !q.region) bits.push("new office / location");
  if (subkind === "market_expansion") bits.push("new market");
  if (s.subject && s.subject !== "company" && k !== "leadership_change") bits.push(`by ${s.subject}`);
  return `${SIGNAL_LABEL[k]}${bits.length ? `: ${bits.join(" · ")}` : ""}`;
}

/**
 * The criteria a mission states, derived from its fields and semantics.
 *
 * Callable on any mission: one compiled before P1 (no `mission_semantics`)
 * is read from its original query on the fly, so the card can show it too.
 */
export function deriveMissionCriteria(mission: LeadMissionV1): MissionCriterion[] {
  const query = String(mission.original_user_query ?? "");
  const q = query.toLowerCase();
  const inQuery = (v: unknown) => typeof v === "string" && v.trim().length > 1 && q.includes(v.toLowerCase());
  const sem = mission.mission_semantics;
  const lang = sem ? null : readMissionLanguage(query);
  const readings: CanonicalSignalReading[] = lang?.readings ?? [];
  const userKinds = new Set<string>(
    sem ? sem.canonical_signals.filter((c) => c.source === "user_explicit").map((c) => c.kind)
      : readings.map((r) => r.kind));
  const hypotheses = sem?.hypotheses ?? lang?.hypotheses ?? [];
  const unmapped = sem?.unmapped_signal_language ?? lang?.unmapped ?? [];
  const stageIntent = sem ? sem.stage : lang?.stage ?? null;
  const prov = mission.field_provenance ?? {};
  const cp = mission.company_profile ?? { business_models: [], verticals: [], stages: [], locations: [] };
  const conf = Number.isFinite(mission.confidence) ? mission.confidence : undefined;
  const out: MissionCriterion[] = [];
  const push = (c: Omit<MissionCriterion, "id" | "status"> & { status?: CriterionStatus }) => {
    const id = `${c.dimension}:${slug(c.value)}`;
    if (out.some((x) => x.id === id)) return;
    out.push({
      ...c, id, status: c.status ?? "ok",
      ...(c.source === "user_inferred" && c.confidence == null && conf != null ? { confidence: conf } : {}),
    });
  };

  // ── Company profile ──
  const profileList = (
    dimension: CriterionDimension, field: string, values: readonly string[], label: string,
  ) => {
    for (const v of values) {
      const source = sourceFromProvenance(prov[field], inQuery(v));
      push({
        kind: source === "user_explicit" ? "hard" : "target",
        dimension, value: v, label: `${label}: ${v}`, source,
        user_phrase: inQuery(v) ? v : "",
        rationale: source === "user_explicit"
          ? "stated in the request"
          : source === "company_brain_preference"
          ? "your Company Brain's ICP; you did not state it in this request"
          : "inferred from the request; never a hard requirement",
      });
    }
  };
  if ((cp.known_companies ?? []).length) {
    push({
      kind: "hard", dimension: "known_companies", value: cp.known_companies,
      label: `Companies you supplied: ${cp.known_companies!.join(", ")}`,
      source: "user_explicit", user_phrase: "", rationale: "the request names these companies",
    });
  }
  profileList("industry", "company_profile.verticals", cp.verticals ?? [], "Industry");
  profileList("business_model", "company_profile.business_models", cp.business_models ?? [], "Business model");
  profileList("geography", "company_profile.locations", cp.locations ?? [], "Geography");

  for (const st of cp.stages ?? []) {
    const source = sourceFromProvenance(prov["company_profile.stages"], true);
    if (stageIntent && st === "startup") {
      // The noun ("startups") is the company kind; the stage word is below.
      push({ kind: "hard", dimension: "company_stage", value: "startup", label: "Company kind: startup",
        source: "user_explicit", user_phrase: "startup", rationale: "the company kind in the request" });
      continue;
    }
    push({
      kind: source === "company_brain_preference" ? "target" : "hard",
      dimension: "company_stage", value: st, label: `Company kind: ${st}`, source,
      user_phrase: source === "user_explicit" ? st : "",
      rationale: source === "company_brain_preference"
        ? "your Company Brain's ICP" : "the company kind in the request",
    });
  }
  if (stageIntent) {
    const funded = (mission.required_signals ?? []).some((s) => kindOfSignal(s) === "funding");
    const unprovable = ROUND_STAGES.has(stageIntent.value) && !funded;
    push({
      kind: stageIntent.kind, dimension: "company_stage", value: stageIntent.value,
      label: `Stage: ${stageIntent.value.replace(/_/g, " ")}` +
        (stageIntent.kind === "hard" ? ` ("${stageIntent.phrase}")` : ""),
      source: "user_explicit", elevated_by: stageIntent.elevated_by,
      user_phrase: stageIntent.phrase,
      rationale: stageIntent.kind === "hard"
        ? `"${stageIntent.phrase}" makes it a requirement`
        : stageIntent.hedged ? "stated as a preference" : "stated without only/must, so a target",
      status: unprovable ? "unprovable_today" : "ok",
    });
  }

  const er = cp.employee_range;
  if (er && (er.min != null || er.max != null)) {
    const source = sourceFromProvenance(prov["company_profile.employee_range"],
      /\b\d{1,5}\s*(?:-|to|–)\s*\d{1,5}\b|\bemployees?\b/.test(q));
    push({
      kind: source === "user_explicit" || source === "company_brain_policy" ? "hard" : "target", dimension: "company_size",
      value: { min: er.min ?? null, max: er.max ?? null },
      label: `Company size: ${er.min ?? 0}–${er.max ?? "∞"} employees`, source, user_phrase: "",
      rationale: source === "company_brain_policy"
        ? "your Company Brain's size rule, enforced on every mission"
        : source === "company_brain_preference"
        ? "your Company Brain's size band; you did not state one" : "stated in the request",
    });
  }

  // ── Other constraints the model proposed ──
  const handled = new Set(["company_profile.locations", "stage", "geography", "location", "locations",
    "company_type", "company_types", "industry", "industries", "vertical", "verticals"]);
  for (const [field, raw] of Object.entries(mission.hard_constraints ?? {})) {
    if (handled.has(field)) continue;
    const c = (raw ?? {}) as { operator?: string; value?: unknown; reason?: string };
    const value = c.value ?? raw;
    const values = Array.isArray(value) ? value.map(String) : [String(value ?? "")];
    const stated = values.some(inQuery);
    const excluding = /not|exclud/i.test(String(c.operator ?? ""));
    push({
      kind: stated || excluding ? "hard" : "target",
      dimension: excluding ? "exclusion" : "constraint", value: { field, value },
      label: `${excluding ? "Excluding" : field.replace(/[._]/g, " ")}: ${values.join(", ")}`,
      source: stated ? "user_explicit" : "user_inferred",
      elevated_by: excluding ? "excluding" : null,
      user_phrase: stated ? values.find(inQuery) ?? "" : "",
      rationale: stated ? "stated in the request"
        : "proposed by the model without the request's words; never a hard requirement",
    });
  }
  for (const [field, raw] of Object.entries(mission.soft_preferences ?? {})) {
    if (field === "stage" && stageIntent) continue;
    const c = (raw ?? {}) as { value?: unknown };
    const value = c.value ?? raw;
    const values = Array.isArray(value) ? value.map(String) : [String(value ?? "")];
    push({
      kind: "target", dimension: field === "stage" ? "company_stage" : "constraint",
      value: { field, value }, label: `${field.replace(/[._]/g, " ")}: ${values.join(", ")} (preference)`,
      source: values.some(inQuery) ? "user_explicit" : "user_inferred",
      user_phrase: values.find(inQuery) ?? "", rationale: "a preference, which can rank but never reject",
    });
  }

  // ── Signals ──
  for (const s of mission.required_signals ?? []) {
    const k = kindOfSignal(s);
    if (!k) {
      push({
        kind: "target", dimension: "unrecognised_signal", value: s.phrase ?? s.type,
        label: `Signal not recognised: "${s.phrase ?? s.type}"`, source: "user_inferred",
        user_phrase: String(s.phrase ?? ""), status: "unrecognised",
        rationale: "no canonical signal kind matches these words; nothing will prove it",
      });
      continue;
    }
    const rec = sem?.canonical_signals.find((c) => c.kind === k);
    const reading = readings.find((r) => r.kind === k);
    const phrase = String(rec?.phrase ?? reading?.phrase ?? s.phrase ?? s.type);
    const idx = phrase ? q.indexOf(phrase.toLowerCase()) : -1;
    const elevated = idx > 0 ? q.slice(Math.max(0, idx - 30), idx).match(/\b(must(?: currently)?(?: be)?|only|required to|strictly)\b[^.]*$/) : null;
    const source: CriterionSource = userKinds.has(k) ? "user_explicit" : "user_inferred";
    const def = DEFAULT_SIGNAL_WINDOWS[k];
    const ws = sem?.window_sources?.[k];
    const carried = s.timeframe_days != null;
    const time_window: CriterionTimeWindow | undefined = carried
      ? {
        days: s.timeframe_days!, basis: def?.basis ?? "observed",
        source: ws?.source ?? (lang?.explicit_window_days != null ? "user_explicit" : "system_default"),
        ...(ws?.rule ? { rule: ws.rule } : def ? { rule: def.rule } : {}), enforced: false,
      }
      // Hiring's default is display-only (never carried), so it is shown even
      // without a temporal word — the plan's own "hiring growth marketers" example.
      : def && k !== "technology" && (TEMPORAL_CUE_RE.test(query) || k === "hiring")
      ? { days: def.days, basis: def.basis, source: "system_default", rule: def.rule, enforced: false }
      : undefined;
    push({
      kind: elevated ? "hard" : "target",
      dimension: k, value: { event: eventOf(s), subject: s.subject ?? "company", qualifier: s.qualifier ?? {} },
      label: signalDetail(k, s, rec?.subkind ?? reading?.subkind),
      source, ...(time_window ? { time_window } : {}),
      ...(elevated ? { elevated_by: elevated[1].startsWith("must") ? "must" : elevated[1] as MissionCriterion["elevated_by"] } : {}),
      user_phrase: source === "user_explicit" ? phrase : "",
      rationale: source === "user_explicit"
        ? "an observable signal the request asks for"
        : "added by the model's reading; the request's words do not state it",
    });
  }

  // ── Hypotheses and their proxy signals ──
  for (const h of hypotheses) {
    push({
      kind: "hypothesis", dimension: "company_profile", value: h.phrase,
      label: `Hypothesis: ${h.phrase}`, source: "user_explicit", user_phrase: h.phrase,
      rationale: "an opportunity thesis to test — can rank a company, never reject one, and is not a verified signal",
    });
    if (h.role_families.length || h.role_terms.length) {
      const role = h.role_terms[0] ?? h.role_families[0];
      const proxies: Array<[CriterionDimension, string, string]> = [
        ["funding", "Funding in the last 180 days", "a recent round often precedes the first hires in a function"],
        ["hiring", `Hiring adjacent to ${role}`, "adjacent openings suggest the function is being built"],
        ["company_profile", `No existing ${role} leader`, "team-composition evidence, checked only for shortlisted companies"],
      ];
      for (const [dimension, label, why] of proxies) {
        push({
          kind: "opportunity_signal", dimension, value: { proxy_for: h.phrase, label },
          label: `${label} (proxy)`, source: "system_default", user_phrase: "",
          rationale: `proxy for "${h.phrase}": ${why}; can rank, never reject`,
        });
      }
    }
  }

  // ── What the request said that nothing will prove ──
  for (const phrase of unmapped) {
    push({
      kind: "target", dimension: "unrecognised_signal", value: phrase,
      label: `Signal not recognised: "${phrase}"`, source: "user_explicit", user_phrase: phrase,
      status: "unrecognised", rationale: "not a signal this system recognises yet; nothing will prove it",
    });
  }
  for (const sentence of mission.unrepresented_requirements ?? []) {
    if (unmapped.some((p) => sentence.includes(`"${p}"`))) continue;
    push({
      kind: "target", dimension: "unrepresentable_evidence", value: sentence,
      label: sentence, source: "user_explicit", user_phrase: "", status: "unrepresentable",
      rationale: "evidence the system has no vocabulary or source for",
    });
  }
  return out;
}

/** Attach freshly derived criteria (after a Company Brain merge, say). */
export function attachMissionCriteria<T extends LeadMissionV1>(mission: T): T {
  return { ...mission, criteria: deriveMissionCriteria(mission) };
}

/** The canonical representation, as one object. */
export function canonicalMissionView(mission: LeadMissionV1) {
  const criteria = mission.criteria ?? deriveMissionCriteria(mission);
  return {
    goal: mission.mission_semantics?.goal ?? mission.original_user_query,
    requested_count: mission.requested_count ?? null,
    criteria,
    canonical_signals: mission.mission_semantics?.canonical_signals ?? [],
  };
}

// ── THE CARD ─────────────────────────────────────────────────────────────────

export interface CriteriaSections {
  version: typeof MISSION_SEMANTICS_VERSION;
  hard: string[];
  target: string[];
  opportunity_signals: string[];
  hypotheses: string[];
  time_windows: string[];
  unsupported: string[];
}

const SIGNAL_DIMENSIONS = new Set<string>(CANONICAL_SIGNAL_KINDS.filter((k) => k !== "company_profile"));

function sourceSuffix(c: MissionCriterion): string {
  const base = SOURCE_LABEL[c.source];
  return c.source === "user_inferred" && c.confidence != null
    ? `${base} (confidence ${c.confidence.toFixed(2)})` : base;
}

/**
 * What the confirmation card shows, grouped the way the user reads a request.
 *
 * `extraUnsupported` carries Stage 0's own gaps (the feasibility report), so
 * requirements the plan cannot prove appear beside those the language could
 * not express — one list of "will not be established".
 */
export function criteriaSections(
  mission: LeadMissionV1, extraUnsupported: readonly string[] = [],
): CriteriaSections {
  const criteria = mission.criteria ?? deriveMissionCriteria(mission);
  const sections: CriteriaSections = {
    version: MISSION_SEMANTICS_VERSION,
    hard: [], target: [], opportunity_signals: [], hypotheses: [], time_windows: [], unsupported: [],
  };
  const add = (list: string[], line: string) => { if (line && !list.includes(line)) list.push(line); };
  for (const c of criteria) {
    const isSignal = SIGNAL_DIMENSIONS.has(c.dimension);
    if (c.status !== "ok") {
      const why = c.status === "unprovable_today"
        ? `${c.label} (${c.kind}) — no current source proves it`
        : c.label;
      add(sections.unsupported, why);
      if (c.status !== "unprovable_today") continue;
    }
    if (c.kind === "hypothesis") add(sections.hypotheses, `${c.label.replace(/^Hypothesis: /, "")} · to be tested, never required`);
    else if (c.kind === "opportunity_signal") add(sections.opportunity_signals, `${c.label} · can rank, never reject`);
    else if (isSignal) add(sections.opportunity_signals, `${c.label} · ${c.kind === "hard" ? "required" : "target"} · ${sourceSuffix(c)}`);
    else if (c.kind === "hard") add(sections.hard, `${c.label} · ${sourceSuffix(c)}`);
    else add(sections.target, `${c.label} · ${sourceSuffix(c)}`);
    if (c.time_window) {
      const w = c.time_window;
      const how = w.source === "system_default" ? `default for "${w.rule ?? "recent"}"`
        : w.source === "user_explicit" ? "you said this" : "inferred";
      add(sections.time_windows,
        `${SIGNAL_LABEL[c.dimension as CanonicalSignalKind] ?? c.label}: last ${w.days} days · ${how}` +
        (c.dimension === "hiring" && w.source === "system_default" ? " · shown, not yet enforced" : ""));
    }
  }
  for (const g of extraUnsupported) add(sections.unsupported, String(g));
  return sections;
}

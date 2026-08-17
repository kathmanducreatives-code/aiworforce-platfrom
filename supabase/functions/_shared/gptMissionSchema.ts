// THE MISSION PROPOSAL SCHEMA — DERIVED FROM THE PARSER, NOT INVENTED.
//
// ── WHY THIS FILE EXISTS AND WHY IT IS BORING ───────────────────────────────
//
// `gptStructured` sends `strict: true`, so OpenAI enforces this schema before
// the model's answer is ever returned. That makes the schema a second statement
// of what a valid proposal is — `parseMissionProposal` being the first — and
// two statements of the same rule drift.
//
// The failure mode of drift here is nasty and quiet: a field the parser reads
// but the schema omits can never be emitted, so the parser's careful handling
// of it becomes dead code and the constraint silently disappears from every
// mission. That is how "AI" would go missing again, one refactor from now.
//
// Every field below was read out of `parseMissionProposal` line by line, and
// `gptMissionSchema.test.ts` asserts the two stay aligned by comparing this
// schema's property list against the keys the parser actually reads. Add a
// field to the parser without adding it here and that test fails.
//
// ── STRICT-MODE RULES THAT SHAPE WHAT IS BELOW ──────────────────────────────
//
// OpenAI structured outputs require, at every object level:
//   * `additionalProperties: false`
//   * EVERY property listed in `required` — optionality is expressed as a
//     nullable type, never by omission
// So "the model may omit this" is spelled `["string", "null"]`, and the parser's
// defensive readers (`strArray`, `numOrNull`) already treat null as empty.

import { MISSION_STRATEGIES, REQUESTED_OUTPUTS } from "./leadMission.ts";
import { PUBLIC_CAPABILITY_IDS } from "./leadCapabilityCatalogue.ts";
import { SOURCE_STRATEGIES } from "./leadMissionCompiler.ts";

export const GPT_MISSION_SCHEMA_VERSION = "gpt-mission-schema-v1" as const;

const strings = (description: string) => ({
  type: "array" as const, items: { type: "string" as const }, description,
});

const nullableInt = (description: string) => ({
  type: ["integer", "null"] as const, description,
});

const employeeRange = (description: string) => ({
  type: "object" as const,
  additionalProperties: false,
  required: ["min", "max"],
  description,
  properties: {
    min: { type: ["integer", "null"] as const },
    max: { type: ["integer", "null"] as const },
  },
});

/**
 * A constraint value.
 *
 * `anyOf` rather than a single type because the parser stores this verbatim and
 * downstream gates compare it directly: a geography constraint is a string
 * ARRAY (`["United States"]` on the 2026-08-17 run), while an employee-count
 * constraint is a number. Forcing one type would corrupt the other.
 */
const constraintValue = {
  anyOf: [
    { type: "string" as const },
    { type: "number" as const },
    { type: "boolean" as const },
    { type: "null" as const },
    { type: "array" as const, items: { type: "string" as const } },
  ],
};

/** Every top-level key `parseMissionProposal` reads. Kept in parser order. */
export const MISSION_PROPOSAL_PROPERTIES = {
  requested_opportunity_count: {
    type: ["integer", "null"] as const,
    description:
      "How many opportunities the request asks for. An explicit null means the " +
      "request named no number — never invent one.",
  },
  requested_contact_ready_count: nullableInt(
    "How many must be contact-ready, when the request distinguishes this.",
  ),
  company_types: strings(
    "The kind of company asked for, in the USER'S OWN TERMS. For 'AI startups' " +
    "this is ['AI', 'startup'] — never a house ICP the request did not mention.",
  ),
  geographies: strings("Places named in the request, e.g. ['United States']."),
  employee_range: employeeRange(
    "Company size IF the request states one. Both null when it does not — do " +
    "not supply a default range.",
  ),
  decision_maker_roles: strings("Roles to reach, when the request names them."),
  hard_constraints: {
    type: "array" as const,
    description: "Requirements that must hold. A candidate failing one is out.",
    items: {
      type: "object" as const,
      additionalProperties: false,
      required: ["field", "operator", "value", "reason"],
      properties: {
        field: { type: "string" as const },
        operator: { type: "string" as const },
        value: constraintValue,
        reason: { type: "string" as const },
      },
    },
  },
  soft_preferences: {
    type: "array" as const,
    description: "Preferences that improve ranking but never exclude.",
    items: {
      type: "object" as const,
      additionalProperties: false,
      required: ["field", "value", "reason"],
      properties: {
        field: { type: "string" as const },
        value: constraintValue,
        reason: { type: "string" as const },
      },
    },
  },
  preferred_signals: strings("Signals that best evidence this request, e.g. ['hiring']."),
  adjacent_signals: strings("Signals that are acceptable supporting evidence."),
  excluded_signals: strings("Signals that must not be treated as evidence here."),
  allowed_broadening: {
    type: "object" as const,
    additionalProperties: false,
    required: ["role_families", "company_types", "geographies", "employee_range"],
    description: "What may be widened if the request cannot be filled as stated.",
    properties: {
      role_families: strings(""),
      company_types: strings(""),
      geographies: strings(""),
      employee_range: employeeRange(""),
    },
  },
  disallowed_broadening: strings("Dimensions that must never be widened."),
  required_evidence: strings("Evidence a candidate must carry to qualify."),
  required_capabilities: {
    ...strings("Pipeline stages this request needs, from the catalogue only."),
    items: { type: "string" as const, enum: [...PUBLIC_CAPABILITY_IDS] },
  },
  preferred_source_strategy: {
    ...strings("How to source, from the fixed vocabulary only."),
    items: { type: "string" as const, enum: [...SOURCE_STRATEGIES] },
  },
  evaluation_instructions: {
    type: "string" as const,
    description: "How a later stage should judge a candidate against THIS request.",
  },
  founder_unlock_recommended: {
    type: "boolean" as const,
    description: "Whether founder contact details are worth paying for here.",
  },
  confidence: {
    type: "number" as const,
    description: "0..1 — how confident this reading of the request is.",
  },
  unknowns: strings("What the request leaves genuinely ambiguous."),
  known_companies: strings("Companies the request NAMES. Empty if it names none."),
  signal_recency_days: nullableInt("How recent a signal must be, when stated."),
  required_signal_terms: strings(
    "The user's own role and signal words, VERBATIM — e.g. ['software engineers']. " +
    "These reach the search directly, so do not paraphrase or generalise them.",
  ),
  no_broadening_requested: {
    type: "boolean" as const,
    description: "True when the request explicitly forbids widening.",
  },
  geography_is_hard: {
    type: "boolean" as const,
    description: "True when the named geography is a requirement, not a preference.",
  },
  prohibitions: strings("Actions the request forbids."),
  strategies: {
    ...strings("Execution strategies, from the fixed vocabulary only."),
    items: { type: "string" as const, enum: [...MISSION_STRATEGIES] },
  },
  output_intent: {
    type: ["string", "null"] as const,
    enum: [...REQUESTED_OUTPUTS, null],
    description: "What the user wants back.",
  },
} as const;

/** The names, exported so the alignment test can compare against the parser. */
export const MISSION_PROPOSAL_FIELDS = Object.keys(
  MISSION_PROPOSAL_PROPERTIES,
) as readonly string[];

export const GPT_MISSION_SCHEMA = {
  name: "lead_mission_proposal",
  schema: {
    type: "object",
    additionalProperties: false,
    // STRICT MODE REQUIRES ALL OF THEM. Optionality is a nullable type above,
    // never an omission — see the header.
    required: [...MISSION_PROPOSAL_FIELDS],
    properties: MISSION_PROPOSAL_PROPERTIES,
  },
} as unknown as { name: string; schema: Record<string, unknown> };

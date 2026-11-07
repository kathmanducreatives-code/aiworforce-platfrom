// CONTRACT v4 INTERPRETATION: the model's ONE structured reading → a validated Mission Contract.
//
// The model answers a closed-vocabulary schema with no free-form field: there is no
// second channel (no `hard_constraints[{field, operator, value}]`, no `company_types`
// beside the industries) for a restatement to arrive through — the bug class behind 54
// of the 58 failures in live study run #24 cannot occur here.
//
// Deterministic validation (`contractFromProposal`):
//   * every item quotes the user's words, and a quote not in the request is REJECTED
//     (the existing typo-tolerant `validateUnderstanding`; titles and places are checked
//     against their registries) — a requirement the user never stated is never admitted;
//   * windows the user stated come from `signal_windows`; any other window is the named
//     system default (`DEFAULT_SIGNAL_WINDOWS`, the one default table), recorded as an
//     assumption the approval card shows;
//   * what the vocabulary cannot express becomes an `unsupported` requirement (disclosed;
//     a required one blocks approval) — never dropped, never silently enforced;
//   * ambiguities block approval (the user is asked).
//
//   * an explicit restriction the contract does not represent (an audience word, an
//     exclusion, a negatively written bound — coverage.ts) blocks approval as a question.
//
// The original sentence is used to check quotes and to find what must be covered. It
// never adds a requirement: an uncovered restriction is asked, never guessed.

import { AUDIENCE_REQUIRE_RE, audienceDescriptor, audienceIntent } from "../missionCriteria.ts";
import { coverageQuestions } from "./coverage.ts";

const AUDIENCE_NEGATION_RE = /\b(?:exclude[sd]?|excluding|no|not|non|without|except|avoid|never|other\s+than)\b/i;
import { DEFAULT_SIGNAL_WINDOWS, type CanonicalSignalKind } from "../signalKinds.ts";
import { SIGNAL_WINDOWS_PROPERTY } from "../missionInterpretationContract.ts";
import { canonicalTitleOf } from "../roleFamilies.ts";
import {
  familyOfTitle, parseUnderstanding, spanInRequest, titleTerm, UNDERSTANDING_INSTRUCTION, UNDERSTANDING_SCHEMA,
  validateUnderstanding,
} from "../missionUnderstanding.ts";
import {
  assumptionsOf, type MissionContract, MISSION_CONTRACT_VERSION, type Necessity, type Origin, type Requirement, type SignalWindow,
} from "./contract.ts";

export const CONTRACT_INTERPRETER_VERSION = "gpt-contract-v4" as const;

/** Dimensions a user may forbid relaxing (the planner's canonical broadening vocabulary). */
export const BROADENING_DIMENSIONS = ["geography", "industry", "business_model", "stage", "size", "role", "recency"] as const;

/** The ONE schema the model answers (OpenAI strict mode: every key required, closed enums). */
export const GPT_CONTRACT_SCHEMA_V4 = Object.freeze({
  type: "object" as const,
  additionalProperties: false,
  required: ["understanding", "signal_windows", "deliverable", "company_size", "funding_stages", "forbid_broadening"],
  properties: {
    understanding: UNDERSTANDING_SCHEMA,
    signal_windows: SIGNAL_WINDOWS_PROPERTY,
    deliverable: {
      type: "object" as const, additionalProperties: false, required: ["entity", "count", "count_span", "person_roles"],
      properties: {
        entity: { type: "string" as const, enum: ["company", "person"], description: "What the user wants back: companies, or people at companies." },
        count: { type: ["integer", "null"] as const, description: "How many results the user asked for; null when no number is stated." },
        count_span: { type: ["string", "null"] as const, description: "The user's words for the count, copied exactly; null when none." },
        person_roles: { type: "array" as const, items: { type: "string" as const }, description: "The people to return (e.g. 'founder', 'VP Sales'), only when the user wants people." },
      },
    },
    company_size: {
      type: ["object", "null"] as const, additionalProperties: false, required: ["min", "max", "necessity", "span"],
      description: "The employee count the user stated, or null. 'Preferred' when hedged ('ideally', 'prefer').",
      properties: {
        min: { type: ["integer", "null"] as const }, max: { type: ["integer", "null"] as const },
        necessity: { type: "string" as const, enum: ["required", "preferred"] },
        span: { type: "string" as const },
      },
    },
    funding_stages: {
      type: "array" as const, description: "Company funding stages the user named ('Series A', 'seed'), each with its words.",
      items: {
        type: "object" as const, additionalProperties: false, required: ["stage", "necessity", "span"],
        properties: { stage: { type: "string" as const }, necessity: { type: "string" as const, enum: ["required", "preferred"] }, span: { type: "string" as const } },
      },
    },
    forbid_broadening: {
      type: "array" as const, items: { type: "string" as const, enum: [...BROADENING_DIMENSIONS] },
      description: "Dimensions the user said must not be relaxed ('only', 'must', 'strictly').",
    },
  },
});

export const CONTRACT_INSTRUCTION = [
  UNDERSTANDING_INSTRUCTION,
  "Answer ONLY in the schema: every requirement is expressed once, in its own field. There is no free-form constraint field —",
  "anything the vocabulary cannot express goes in understanding.unsupported with the user's words, never elsewhere.",
  "Put each stated timeframe in signal_windows; never invent one.",
  // TEST dry run 2026-11-06: "describes the companies" was read as "is not a requirement",
  // and B2B was omitted or filed as unsupported. An audience word IS expressible.
  "An audience word (B2B, B2C, D2C, consumer) is a business model: put it in understanding.industries with the user's words,",
  "never in unsupported and never omitted. Include 'only'/'must' in its span when the user says so; 'no B2C' is necessity excluded.",
  "Every exclusion the user states ('excluding X', 'but not X', 'no X', 'without X', 'except X') must appear: an excluded role in roles",
  "(relation excluded, abbreviations like 'SDRs' resolved to their title), an excluded place or industry with necessity excluded.",
].join(" ");

export interface ContractProposalV4 {
  understanding: unknown;
  signal_windows: { event: string; days: number | null; phrase: string; signal: string | null }[];
  deliverable: { entity: "company" | "person"; count: number | null; count_span: string | null; person_roles: string[] };
  company_size: { min: number | null; max: number | null; necessity: "required" | "preferred"; span: string } | null;
  funding_stages: { stage: string; necessity: "required" | "preferred"; span: string }[];
  forbid_broadening: string[];
}

export interface InterpretationResult {
  contract: MissionContract;
  /** Items refused because they did not quote the request, or named an unknown title / place. */
  rejected: { item: string; reason: string }[];
}

const slug = (s: string) => s.toLowerCase().normalize("NFKC").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 60) || "x";
const userOrigin = (span: string): Origin => ({ source: "user_explicit", span, policy: null });
/** The named policy that makes a descriptive audience ("B2B companies") a preference. */
export const AUDIENCE_POLICY = "audience_descriptor_is_preference";

/** The model's v4 proposal → a validated contract (deterministic; see the header). */
export function contractFromProposal(query: string, p: ContractProposalV4, opts: { model?: string | null } = {}): InterpretationResult {
  const raw = parseUnderstanding(p.understanding);
  if (!raw) throw new Error("the model's answer carries no understanding");
  // A ROLE THE USER NAMED IS NEVER DROPPED (live study v4, M07 repeat 3: the model quoted
  // "SDRs" as excluded but gave no role id; validation rejected it and the user's exclusion
  // vanished). The registry resolves the user's own word first; a role it cannot identify
  // becomes a question that blocks approval, never a silent omission.
  // AN AUDIENCE WORD IS EXPRESSIBLE (TEST dry run 2026-11-06: "B2B" filed as unsupported was
  // shown as "Not checked" and never enforced). The model's own unsupported item whose words
  // are only an audience descriptor is read as the business model it is — unless the
  // request excludes that audience, where including it would invert the meaning (the
  // coverage check below then asks instead).
  const audienceItems = raw.unsupported.filter((x) => {
    const a = audienceDescriptor(x.span);
    return a !== null && !AUDIENCE_NEGATION_RE.test(x.span) && audienceIntent(query, a) !== "exclude";
  });
  const parsed = {
    ...raw,
    roles: raw.roles.map((r) => (!r.title && !r.family ? { ...r, title: canonicalTitleOf(r.span) } : r)),
    industries: [...raw.industries, ...audienceItems.map((x) => ({ span: x.span, industry: audienceDescriptor(x.span) === "b2b" ? "B2B" : x.span.trim(), necessity: "required" as const }))],
    unsupported: raw.unsupported.filter((x) => !audienceItems.includes(x)),
  };
  const u = validateUnderstanding(query, parsed);
  const rejected = [...u.rejected];
  const unidentifiedRoles = rejected.filter((x) => x.reason === "no_role_id").map((x) => x.item.replace(/^role:/, ""));
  const reqs: Requirement[] = [];
  const ids = new Set<string>();
  const idOf = (base: string) => { let id = base, n = 2; while (ids.has(id)) id = `${base}:${n++}`; ids.add(id); return id; };
  const base = (id: string, necessity: Necessity, origin: Origin, label: string, rationale: string) =>
    ({ id: idOf(id), necessity, origin, evaluability: "ok" as const, alternatives: null, display: { label, rationale } });

  // ── Places ──
  for (const pl of u.places) {
    const place = pl.place ? placeLabel(pl.place) : String(pl.other_place ?? "").trim();
    if (!place) continue;
    if (pl.necessity === "excluded") {
      reqs.push({ ...base(`exclusion:geography:${slug(place)}`, "required", userOrigin(pl.span), `Excluding: ${place}`, `excluded in the request ("${pl.span}")`),
        dimension: "exclusion", field: "excluded_geographies", values: [place] });
      continue;
    }
    reqs.push({ ...base(`geography:${slug(place)}`, pl.necessity, userOrigin(pl.span),
      `${pl.scope === "headquarters" ? "Headquarters" : "Geography"}: ${place}`, `stated in the request ("${pl.span}")`),
      dimension: "geography", polarity: "include", place, scope: pl.scope });
  }

  // ── Industries and business models ──
  for (const ind of u.industries) {
    if (ind.necessity === "excluded") {
      reqs.push({ ...base(`exclusion:industry:${slug(ind.industry)}`, "required", userOrigin(ind.span), `Excluding: ${ind.industry}`, `excluded in the request ("${ind.span}")`),
        dimension: "exclusion", field: "excluded_company_types", values: [ind.industry] });
      continue;
    }
    const facet = audienceDescriptor(ind.industry) !== null ? "business_model" : "industry";
    // AN AUDIENCE DESCRIPTOR DESCRIBES; IT GATES ONLY IN THE USER'S OWN STRONG WORDS (owner
    // rule, corpus M01): "US B2B companies" ranks by B2B, "only B2B" requires it. Decided on
    // the item's OWN quoted span, never by re-reading the sentence; recorded as an assumption.
    const descriptive = facet === "business_model" && ind.necessity === "required" && !AUDIENCE_REQUIRE_RE.test(ind.span);
    const necessity: Necessity = descriptive ? "preferred" : ind.necessity;
    const origin: Origin = descriptive ? { source: "user_explicit", span: ind.span, policy: AUDIENCE_POLICY } : userOrigin(ind.span);
    reqs.push({ ...base(`${facet}:${slug(ind.industry)}`, necessity, origin,
      `${facet === "industry" ? "Industry" : "Business model"}: ${ind.industry}`, `stated in the request ("${ind.span}")`),
      dimension: "industry", facet, polarity: "include", value: ind.industry });
  }

  // ── Size and stages ──
  if (p.company_size && (p.company_size.min !== null || p.company_size.max !== null)) {
    const s = p.company_size;
    if (!s.span || !spanInRequest(query, s.span)) rejected.push({ item: `company_size:${JSON.stringify(s.span)}`, reason: "quote_not_in_request" });
    else {
      const label = `Company size: ${s.min ?? "any"}–${s.max ?? "any"} employees`;
      reqs.push({ ...base(`company_size:${s.min ?? "x"}_${s.max ?? "x"}`, s.necessity, userOrigin(s.span), label, `stated in the request ("${s.span}")`),
        dimension: "company_size", min: s.min, max: s.max });
    }
  }
  for (const st of p.funding_stages) {
    if (!spanInRequest(query, st.span)) { rejected.push({ item: `funding_stage:${JSON.stringify(st.span)}`, reason: "quote_not_in_request" }); continue; }
    reqs.push({ ...base(`company_stage:${slug(st.stage)}`, st.necessity, userOrigin(st.span), `Stage: ${st.stage}`, `stated in the request ("${st.span}")`),
      dimension: "company_stage", stage: st.stage });
  }

  // ── Signals (hiring carries the roles) ──
  const reqRoles = u.roles.filter((r) => r.relation === "required");
  const excRoles = u.roles.filter((r) => r.relation === "excluded");
  const signals = [...u.signals];
  // ROLES QUALIFY A HIRING SIGNAL; THEY NEVER CREATE ONE. "growing the sales team" names a
  // team for a growth signal (M20, live run #24): no hiring requirement is invented. Roles
  // the reading ties to no hiring signal are disclosed (shown, never executed).
  if ((reqRoles.length || excRoles.length) && !signals.some((s) => s.kind === "hiring")) {
    for (const r of [...reqRoles, ...excRoles]) {
      reqs.push({ ...base(`unsupported:role:${slug(r.span)}`, "required", userOrigin(r.span), `Not checked: ${r.span}`,
        "a role the reading ties to no hiring signal; no evidence dimension measures it on its own"),
        evaluability: "unrepresentable", dimension: "unsupported", polarity: r.relation === "excluded" ? "exclude" : "include", compiledAs: "disclosed", value: r.span });
    }
  }
  const signalIds: string[] = [];
  for (const s of signals) {
    const stated = p.signal_windows.find((w) => w.event === s.kind && typeof w.days === "number" && spanInRequest(query, w.phrase));
    const def = DEFAULT_SIGNAL_WINDOWS[s.kind as CanonicalSignalKind];
    const window: SignalWindow | null = stated
      ? { days: stated.days!, basis: def?.basis ?? "observed", origin: { source: "user_explicit", span: stated.phrase, policy: def?.rule ?? null }, enforced: null }
      : def ? { days: def.days, basis: def.basis, origin: { source: "system_default", span: "", policy: def.rule }, enforced: null } : null;
    const hiring = s.kind === "hiring";
    const terms = hiring ? [...new Set(reqRoles.filter((r) => r.title).map((r) => titleTerm(r.title!)))] : [];
    const families = hiring ? [...new Set(reqRoles.map((r) => r.family ?? (r.title ? familyOfTitle(r.title) : null)).filter((f): f is string => !!f))] : [];
    const excluded = hiring ? [...new Set(excRoles.map((r) => (r.title ? titleTerm(r.title) : r.span)))] : [];
    const label = hiring && terms.length ? `Hiring: ${terms.join(" or ")}` : hiring && families.length ? `Hiring: ${families.join(" or ")}` : `Signal: ${s.kind}`;
    const r: Requirement = {
      ...base(`${s.kind}:${slug(s.span)}`, s.necessity, userOrigin(s.span), label, `a signal the request requires ("${s.span}")`),
      dimension: "signal", kind: s.kind, event: s.kind, subject: "company", topics: [],
      roleTerms: hiring && terms.length ? terms : null, roleFamilies: hiring && families.length ? families : null,
      excludedRoleTerms: hiring && excluded.length ? excluded : null, roleMatch: hiring && terms.length > 1 ? u.role_match : null,
      qualifiers: {}, qualifierPresent: true, window,
    };
    reqs.push(r);
    if (s.necessity === "required") signalIds.push(r.id);
  }
  const anyOf: string[][] = [];
  if (u.signal_logic === "any" && signalIds.length > 1) {
    anyOf.push(signalIds);
    const kinds = signalIds.map((id) => (reqs.find((r) => r.id === id) as Extract<Requirement, { dimension: "signal" }>).kind);
    for (const r of reqs) if (signalIds.includes(r.id)) r.alternatives = kinds.map((k) => `signal:${k}`);
  }

  // ── What the vocabulary cannot express: disclosed at approval, never dropped, never executed ──
  for (const x of u.unsupported) {
    reqs.push({ ...base(`unsupported:${slug(x.span)}`, "required", userOrigin(x.span), `Not checked: ${x.span}`, x.why || "not expressible in the mission vocabulary"),
      evaluability: "unrepresentable", dimension: "unsupported", polarity: "include", compiledAs: "disclosed", value: x.span });
  }

  const count = p.deliverable.count !== null && Number.isInteger(p.deliverable.count) && p.deliverable.count > 0 ? p.deliverable.count : null;
  const contract: MissionContract = {
    version: MISSION_CONTRACT_VERSION,
    objective: query,
    deliverable: { entity: p.deliverable.entity, count, personRoles: p.deliverable.entity === "person" ? [...p.deliverable.person_roles] : [] },
    forbidBroadening: p.forbid_broadening.filter((d) => (BROADENING_DIMENSIONS as readonly string[]).includes(d)),
    requirements: reqs,
    anyOf,
    assumptions: assumptionsOf(reqs),
    ambiguities: [
      ...u.ambiguities.map((a) => ({ span: a.span, question: a.question })),
      ...unidentifiedRoles.map((span) => ({ span: JSON.parse(span) as string,
        question: `Which job title do you mean by ${span}? I couldn't match it to a role I can check, and I won't run without it.` })),
    ],
    authorizedActions: ["discover", "verify"],
    budget: null,
    completion: { targetCount: count, stopWhen: "target_reached_or_budget_exhausted" },
    provenance: { interpreter: "gpt_contract_v4", model: opts.model ?? null, from: null },
  };
  // NOTHING THE USER STATED EXPLICITLY MAY VANISH (coverage.ts): an audience word or a
  // negative constraint the contract does not represent — omitted by the model, rejected
  // by validation, or only disclosed — is a blocking question, never a silent omission.
  // One question per thing: a restriction already asked about ("growth hackers") is not asked twice.
  const asked = contract.ambiguities.map((a) => a.span.replace(/^"|"$/g, ""));
  for (const q of coverageQuestions(query, contract)) if (!asked.some((a) => spanInRequest(q.span, a))) contract.ambiguities.push(q);
  return { contract, rejected };
}

const placeLabel = (id: string) => (id.length <= 4 ? id.toUpperCase() : id.replace(/\b\w/g, (c) => c.toUpperCase()));

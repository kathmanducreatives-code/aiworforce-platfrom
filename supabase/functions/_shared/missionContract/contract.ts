// THE MISSION CONTRACT — the one authoritative statement of what a user asked for.
//
// Architecture review 2026-11 (ADR-001): one typed representation of intent, produced
// once, validated here, approved by its hash, and the only thing execution reads.
// Nothing downstream re-reads the user's sentence to decide a requirement: `objective`
// is kept for display and audit only.
//
// Shape rules that keep meaning from drifting:
//   * every requirement has a stable id, a necessity (required | preferred) and an
//     origin (the user's words, a model inference, a Company Brain rule, or a named
//     system default) — a default is always visible as one;
//   * absence is not negation: a dimension the contract does not mention is
//     unrestricted, and an exclusion is always an explicit requirement (polarity
//     "exclude");
//   * a preference never gates: only `necessity: "required"` can reject a candidate;
//   * a requirement the system cannot establish is kept as `unsupported` — disclosed,
//     never dropped, never silently enforced, and a REQUIRED one blocks approval;
//   * everything the engine acts on is in the contract, so `contractHash` (canonical
//     JSON, sorted keys) is a complete approval identity.
//
// Pure: no I/O.

export const MISSION_CONTRACT_VERSION = "mission-contract-v1" as const;

export type Necessity = "required" | "preferred";
export type Polarity = "include" | "exclude";

/** Who stated a requirement. Mirrors the compiler's criterion sources one-to-one. */
export type OriginSource = "user_explicit" | "user_inferred" | "company_brain_policy" | "company_brain_preference" | "system_default";
export interface Origin {
  source: OriginSource;
  /** The user's own words when there are any ("" when the request has no span for it). */
  span: string;
  /** For a system default: the named rule that applied it ("currently / actively hiring"). */
  policy: string | null;
  /** The model's confidence, when the requirement was inferred (compiler `confidence`). */
  confidence?: number | null;
  /** The user's emphasis that made it hard ("only", "must", "excluding"…; compiler `elevated_by`). */
  elevatedBy?: string | null;
}

/** A dated window a signal must fall in. `origin.source === "system_default"` ⇒ an assumption. */
export interface SignalWindow {
  days: number;
  basis: string;
  origin: Origin;
  /** False when the window is shown but no current step enforces it (compiler's `enforced`). */
  enforced: boolean | null;
}

/** Whether today's evidence can establish the requirement (compiler criterion status). */
export type Evaluability = "ok" | "unprovable_today" | "unrepresentable" | "unrecognised";

interface Base {
  id: string;
  necessity: Necessity;
  origin: Origin;
  evaluability: Evaluability;
  /**
   * The alternatives this requirement is one of, as stated ("AI or developer tools"):
   * any of them satisfies the group. Null for an ordinary requirement.
   */
  alternatives: string[] | null;
  /** Card text. Display only: excluded from the approval hash. */
  display: { label: string; rationale: string };
}

/** Dated company events a requirement can ask for. */
export type SignalKind = string;

export type Requirement =
  | (Base & { dimension: "geography"; polarity: Polarity; place: string; scope: "headquarters" | "presence" | null })
  | (Base & { dimension: "company_size"; min: number | null; max: number | null })
  /** An industry or a business model ("B2B"); `facet` keeps which evidence answers it. */
  | (Base & { dimension: "industry"; facet: "industry" | "business_model"; polarity: Polarity; value: string })
  | (Base & { dimension: "company_stage"; stage: unknown })
  | (Base & { dimension: "known_companies"; companies: string[] })
  /**
   * A dated event about the company. For hiring, the roles are kept VERBATIM (the engine
   * matches titles by these strings); `qualifiers` holds any other kind-specific detail
   * the compiler recorded (headcount `direction`, expansion `region`, …) so nothing is lost.
   */
  | (Base & {
    dimension: "signal"; kind: SignalKind; event: string; subject: string;
    /** Topics of a social-activity signal, in the user's words. */
    topics: string[];
    roleTerms: string[] | null; roleFamilies: string[] | null; excludedRoleTerms: string[] | null; roleMatch: string | null;
    /** Kind-specific detail beyond roles (headcount `direction`, expansion `region`…). */
    qualifiers: Record<string, unknown>;
    /** Whether the compiled event carried a qualifier object at all (kept for an exact round trip). */
    qualifierPresent: boolean;
    window: SignalWindow | null;
  })
  /**
   * Stated, but no supported evidence dimension can establish it. Kept exactly as the
   * compiler recorded it (`compiledAs`), disclosed, never silently enforced.
   */
  /** An explicit exclusion of companies ("no agencies", "not in Canada"), as the engine checks it. */
  | (Base & { dimension: "exclusion"; field: string; values: unknown })
  | (Base & {
    dimension: "unsupported"; polarity: Polarity;
    /**
     * `disclosed`: the interpreter said the vocabulary cannot express it ("growth of one
     * team"). It is shown at approval and NEVER executed — approving a card that shows it
     * is the user's explicit resolution. The others are criteria a legacy compiler emitted
     * (kept as such so a stored mission round-trips exactly).
     */
    compiledAs: "constraint" | "unrecognised_signal" | "unrepresentable_evidence" | "disclosed";
    value: unknown;
  });

export type Dimension = Requirement["dimension"];
export type AuthorizedAction = "discover" | "verify" | "enrich" | "contact";

export interface MissionContract {
  version: typeof MISSION_CONTRACT_VERSION;
  /** The user's request, verbatim. Display and audit only — never a source of requirements. */
  objective: string;
  /** `count: null` = the user stated no quantity (the planner's default applies, shown at approval). */
  deliverable: { entity: string; count: number | null; personRoles: string[] };
  /** Dimensions the user forbade relaxing ("only", "must", "don't broaden"). */
  forbidBroadening: string[];
  requirements: Requirement[];
  /**
   * Groups of requirement ids satisfied by ANY member ("raised funding OR hiring",
   * "AI or developer tools"). Each group is one requirement; members are alternatives.
   */
  anyOf: string[][];
  /** Every system default applied, so the approval card shows it. Derived from origins. */
  assumptions: { requirementId: string; policy: string; text: string }[];
  /** Questions whose answer changes who qualifies. Non-empty ⇒ not approvable. */
  ambiguities: { span: string; question: string }[];
  authorizedActions: AuthorizedAction[];
  /** Spending ceilings, set when a plan is approved (null = not yet bounded). */
  budget: { maxApifyUsd: number; maxLeadoceanRecords: number } | null;
  completion: { targetCount: number | null; stopWhen: "target_reached_or_budget_exhausted" };
  /** How this contract was produced. NOT hashed: provenance, not meaning. */
  provenance: { interpreter: "gpt_contract_v4" | "compiled_mission_boundary"; model: string | null; from: string | null };
}

// ── Invariants ───────────────────────────────────────────────────────────────

export interface ContractProblem { code: string; requirementId: string | null; detail: string }

const lower = (s: string) => s.trim().toLowerCase();

/** Every structural and semantic invariant a contract must satisfy. Empty ⇒ valid. */
export function contractProblems(c: MissionContract): ContractProblem[] {
  const out: ContractProblem[] = [];
  const p = (code: string, requirementId: string | null, detail: string) => out.push({ code, requirementId, detail });
  if (c.version !== MISSION_CONTRACT_VERSION) p("version", null, `unknown version ${String(c.version)}`);
  if (c.deliverable.count !== null && (!Number.isInteger(c.deliverable.count) || c.deliverable.count < 1)) {
    p("count", null, "the deliverable count must be a positive integer, or null when none was stated");
  }
  // A mission with no requirement at all cannot be frozen, and an unfrozen mission is
  // re-derived from the sentence by legacy readers: refuse it (ask), never run it.
  if (!c.requirements.length) p("empty_mission", null, "the mission states no requirement; ask what qualifies a result");
  const ids = new Set<string>();
  for (const r of c.requirements) {
    if (!r.id || ids.has(r.id)) p("duplicate_id", r.id, "requirement ids must be unique and non-empty");
    ids.add(r.id);
    if (r.origin.source === "system_default" && !r.origin.policy) p("default_policy", r.id, "a system default must name its policy");
    switch (r.dimension) {
      case "geography":
        if (!r.place.trim()) p("empty", r.id, "a geography requirement names no place");
        break;
      case "company_size":
        if (r.min === null && r.max === null) p("empty", r.id, "a size requirement with no bound");
        if (r.min !== null && r.max !== null && r.min > r.max) p("contradiction", r.id, `size min ${r.min} > max ${r.max}`);
        break;
      case "industry":
        if (!r.value.trim()) p("empty", r.id, "an industry requirement names no industry");
        break;
      case "signal":
        // A sanity bound, not a policy: stored history holds windows up to 3 years.
        if (r.window && (!Number.isFinite(r.window.days) || r.window.days < 1 || r.window.days > 3650)) p("window", r.id, `window ${r.window.days} days is out of range`);
        for (const t of r.excludedRoleTerms ?? []) {
          if ((r.roleTerms ?? []).some((x) => lower(x) === lower(t))) p("contradiction", r.id, `role "${t}" is both required and excluded`);
        }
        break;
      case "known_companies":
        if (!r.companies.length) p("empty", r.id, "no company named");
        break;
    }
  }
  // The same place / industry both required and excluded is a contradiction, never guessed away.
  for (const dim of ["geography", "industry"] as const) {
    const inc = new Set<string>(), exc = new Set<string>();
    for (const r of c.requirements) {
      if (r.dimension !== dim || r.necessity !== "required") continue;
      (r.polarity === "include" ? inc : exc).add(lower(r.dimension === "geography" ? r.place : r.value));
    }
    for (const v of exc) if (inc.has(v)) p("contradiction", null, `${dim} "${v}" is both required and excluded`);
  }
  for (const g of c.anyOf) {
    if (g.length < 2) p("any_of", null, "an any-of group needs at least two requirements");
    for (const id of g) if (!ids.has(id)) p("any_of", id, "an any-of group names an unknown requirement");
  }
  if (canonicalJson(assumptionsOf(c.requirements)) !== canonicalJson(c.assumptions)) {
    p("assumptions", null, "assumptions must list exactly the system defaults the requirements carry");
  }
  if (!c.authorizedActions.includes("discover")) p("actions", null, "a lead mission must at least be authorised to discover");
  if (c.completion.targetCount !== c.deliverable.count) p("completion", null, "the completion target must equal the deliverable count");
  return out;
}

/** The assumptions a set of requirements implies: every system-default origin or window. */
export function assumptionsOf(rs: readonly Requirement[]): MissionContract["assumptions"] {
  const out: MissionContract["assumptions"] = [];
  for (const r of rs) {
    // A system default, or a named policy applied to the user's words (e.g. a descriptive audience).
    if (r.origin.source === "system_default" || (r.dimension !== "signal" && r.origin.policy)) {
      out.push({ requirementId: r.id, policy: r.origin.policy ?? "", text: r.display.label });
    }
    if (r.dimension === "signal" && r.window?.origin.source === "system_default") {
      out.push({ requirementId: r.id, policy: r.window.origin.policy ?? "", text: `${r.kind}: last ${r.window.days} days (default)` });
    }
  }
  return out;
}

/** Approvable: valid, no open ambiguity, and no REQUIRED requirement the system cannot establish. */
export function approvability(c: MissionContract): { ok: true } | { ok: false; reasons: string[] } {
  const reasons = [
    ...contractProblems(c).map((x) => `${x.code}${x.requirementId ? `(${x.requirementId})` : ""}: ${x.detail}`),
    ...c.ambiguities.map((a) => `ambiguity: ${a.question}`),
    ...c.requirements.filter((r) => r.dimension === "unsupported" && r.compiledAs !== "disclosed" && r.necessity === "required" && r.polarity === "include")
      .map((r) => `a required requirement no evidence can establish: ${r.display.label}`),
  ];
  return reasons.length ? { ok: false, reasons } : { ok: true };
}

// ── Canonical serialization and the approval identity ───────────────────────

/** Canonical JSON: object keys sorted at every level; arrays keep their order. */
export function canonicalJson(v: unknown): string {
  return JSON.stringify(v, (_k, val) => val && typeof val === "object" && !Array.isArray(val)
    ? Object.fromEntries(Object.keys(val).sort().map((k) => [k, (val as Record<string, unknown>)[k]]))
    : val);
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Exactly what is approved: everything execution may act on. Provenance and card text
 * are excluded (how a contract was produced, or worded, does not change what it asks
 * for). Requirements are ordered by id and any-of groups normalised, so an equivalent
 * contract hashes the same.
 */
export function hashedView(c: MissionContract) {
  const { provenance: _p, ...rest } = c;
  return {
    ...rest,
    requirements: c.requirements.map(({ display: _d, ...r }) => r).sort(byId),
    anyOf: c.anyOf.map((g) => [...g].sort()).sort((a, b) => (a.join("|") < b.join("|") ? -1 : a.join("|") > b.join("|") ? 1 : 0)),
    assumptions: [...c.assumptions].sort((a, b) => (canonicalJson(a) < canonicalJson(b) ? -1 : 1)),
  };
}

export async function contractHash(c: MissionContract): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(hashedView(c))));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Requirements shown at approval but never executed (see `compiledAs: "disclosed"`). */
export function disclosures(c: MissionContract): Requirement[] {
  return c.requirements.filter((r) => r.dimension === "unsupported" && r.compiledAs === "disclosed");
}

/** True when a requirement becomes an executable criterion. */
export const isExecutable = (r: Requirement) => !(r.dimension === "unsupported" && r.compiledAs === "disclosed");

/**
 * The gating requirements execution must enforce, as stable identities: what no later
 * step may add, drop, strengthen or weaken. Keyed by id; the value is the requirement's
 * meaning (no card text).
 */
export function hardRequirementSet(c: MissionContract): Map<string, string> {
  return new Map(c.requirements.filter((r) => r.necessity === "required" && isExecutable(r))
    .map(({ display: _d, ...r }) => [r.id, canonicalJson(r)]));
}

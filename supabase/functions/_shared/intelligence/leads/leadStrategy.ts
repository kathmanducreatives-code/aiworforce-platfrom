// THE LEAD INITIAL STRATEGY — what Claude is allowed to return.
//
// A strategy is SEMANTIC: role meaning, company interpretation, and searches
// expressed as capability keys with titles/keywords/locations. It is never a
// provider request. The compiler (leadStrategyCompiler.ts) turns an APPROVED
// strategy into provider input using the existing adapters, so nothing Claude
// writes reaches a provider verbatim.
//
// PURE. Shape validation only — policy lives in leadStrategyValidation.ts.

export type LeadSearchPurpose =
  | "discover_hiring_companies"
  | "qualify_companies"
  | "find_decision_makers"
  | "resolve_identity";

export const LEAD_SEARCH_PURPOSES: readonly LeadSearchPurpose[] = [
  "discover_hiring_companies", "qualify_companies", "find_decision_makers", "resolve_identity",
];

export type TitleRelationship = "exact" | "safe_synonym";

export interface LeadSynonymTitle {
  title: string;
  language: string;
  relationship: TitleRelationship;
  confidence: number;
}

export interface LeadAdjacentTitle {
  title: string;
  reason: string;
  confidence: number;
}

export interface LeadRoleOntology {
  canonical_concept: string;
  department?: string;
  function?: string;
  seniority: string[];
  team_stage?: string;
  exact_titles: string[];
  safe_synonyms: LeadSynonymTitle[];
  adjacent_titles: LeadAdjacentTitle[];
  excluded_titles: string[];
}

export interface LeadCompanyInterpretation {
  verticals: string[];
  company_types: string[];
  positive_keywords: string[];
  negative_keywords: string[];
}

export interface LeadSearch {
  purpose: LeadSearchPurpose;
  capability_key: string;
  titles?: string[];
  keywords?: string[];
  locations?: string[];
  languages?: string[];
  result_target: number;
  posting_window_days?: number;
  rationale: string;
}

export interface LeadExpectedFunnel {
  raw_results: number;
  relevant_jobs: number;
  qualified_companies: number;
  verified_people: number;
  contact_ready_leads: number;
}

export interface LeadInitialStrategy {
  role_ontology: LeadRoleOntology;
  company_interpretation: LeadCompanyInterpretation;
  searches: LeadSearch[];
  exclusions: {
    titles: string[];
    companies: string[];
    industries: string[];
  };
  expected_funnel: LeadExpectedFunnel;
  confidence: number;
}

// ------------------------------------------------------------------ bounds ----

export const STRATEGY_BOUNDS = {
  maxTitles: 12,
  maxSynonyms: 12,
  maxAdjacent: 8,
  maxKeywords: 12,
  maxLocations: 8,
  maxSearches: 6,
  maxTitleChars: 60,
  maxTextChars: 240,
  maxResultTarget: 200,
} as const;

function str(v: unknown, max: number): string {
  const s = String(v ?? "").trim();
  return s.length > max ? s.slice(0, max) : s;
}

function strList(v: unknown, maxItems: number, maxChars: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const raw of v) {
    const s = str(raw, maxChars);
    if (!s) continue;
    if (out.some((x) => x.toLowerCase() === s.toLowerCase())) continue;
    out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

function clamp01(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function nonNegInt(v: unknown, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.floor(n), max);
}

/**
 * SHAPE validation, with bounding applied on the way through.
 *
 * Returns the bounded value rather than the raw one, so a downstream consumer can
 * never see an unbounded array — the bounded object is the only thing that exists
 * after this point. Policy (is this title allowed? is the budget respected?) is a
 * separate pass.
 */
export function parseLeadStrategy(
  candidate: unknown,
): { ok: true; strategy: LeadInitialStrategy } | { ok: false; problem: string } {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { ok: false, problem: "strategy_not_an_object" };
  }
  const c = candidate as Record<string, unknown>;

  const ro = c.role_ontology;
  if (!ro || typeof ro !== "object" || Array.isArray(ro)) {
    return { ok: false, problem: "role_ontology_missing" };
  }
  const r = ro as Record<string, unknown>;

  const canonical = str(r.canonical_concept, STRATEGY_BOUNDS.maxTextChars);
  if (!canonical) return { ok: false, problem: "canonical_concept_missing" };

  const searchesRaw = c.searches;
  if (!Array.isArray(searchesRaw) || searchesRaw.length === 0) {
    return { ok: false, problem: "searches_missing" };
  }

  const searches: LeadSearch[] = [];
  for (const s of searchesRaw.slice(0, STRATEGY_BOUNDS.maxSearches)) {
    if (!s || typeof s !== "object") return { ok: false, problem: "search_not_an_object" };
    const x = s as Record<string, unknown>;
    const purpose = String(x.purpose ?? "");
    if (!LEAD_SEARCH_PURPOSES.includes(purpose as LeadSearchPurpose)) {
      return { ok: false, problem: `search_purpose_invalid:${purpose || "empty"}` };
    }
    const capability_key = str(x.capability_key, 64);
    if (!capability_key) return { ok: false, problem: "search_capability_key_missing" };

    searches.push({
      purpose: purpose as LeadSearchPurpose,
      capability_key,
      ...(x.titles !== undefined ? { titles: strList(x.titles, STRATEGY_BOUNDS.maxTitles, STRATEGY_BOUNDS.maxTitleChars) } : {}),
      ...(x.keywords !== undefined ? { keywords: strList(x.keywords, STRATEGY_BOUNDS.maxKeywords, STRATEGY_BOUNDS.maxTitleChars) } : {}),
      ...(x.locations !== undefined ? { locations: strList(x.locations, STRATEGY_BOUNDS.maxLocations, STRATEGY_BOUNDS.maxTitleChars) } : {}),
      ...(x.languages !== undefined ? { languages: strList(x.languages, 6, 32) } : {}),
      result_target: nonNegInt(x.result_target, STRATEGY_BOUNDS.maxResultTarget),
      ...(x.posting_window_days !== undefined ? { posting_window_days: nonNegInt(x.posting_window_days, 365) } : {}),
      rationale: str(x.rationale, STRATEGY_BOUNDS.maxTextChars),
    });
  }

  const synonymsRaw = Array.isArray(r.safe_synonyms) ? r.safe_synonyms : [];
  const safe_synonyms: LeadSynonymTitle[] = [];
  for (const s of synonymsRaw.slice(0, STRATEGY_BOUNDS.maxSynonyms)) {
    const x = (s ?? {}) as Record<string, unknown>;
    const title = str(x.title, STRATEGY_BOUNDS.maxTitleChars);
    if (!title) continue;
    const rel = String(x.relationship ?? "safe_synonym");
    safe_synonyms.push({
      title,
      language: str(x.language, 32) || "en",
      // An unrecognised relationship is narrowed to `safe_synonym`, the weaker
      // claim — never widened to `exact`.
      relationship: rel === "exact" ? "exact" : "safe_synonym",
      confidence: clamp01(x.confidence),
    });
  }

  const adjacentRaw = Array.isArray(r.adjacent_titles) ? r.adjacent_titles : [];
  const adjacent_titles: LeadAdjacentTitle[] = [];
  for (const a of adjacentRaw.slice(0, STRATEGY_BOUNDS.maxAdjacent)) {
    const x = (a ?? {}) as Record<string, unknown>;
    const title = str(x.title, STRATEGY_BOUNDS.maxTitleChars);
    if (!title) continue;
    adjacent_titles.push({
      title,
      reason: str(x.reason, STRATEGY_BOUNDS.maxTextChars),
      confidence: clamp01(x.confidence),
    });
  }

  const ci = (c.company_interpretation ?? {}) as Record<string, unknown>;
  const ex = (c.exclusions ?? {}) as Record<string, unknown>;
  const fn = (c.expected_funnel ?? {}) as Record<string, unknown>;

  return {
    ok: true,
    strategy: {
      role_ontology: {
        canonical_concept: canonical,
        ...(str(r.department, 64) ? { department: str(r.department, 64) } : {}),
        ...(str(r.function, 64) ? { function: str(r.function, 64) } : {}),
        seniority: strList(r.seniority, 8, 32),
        ...(str(r.team_stage, 32) ? { team_stage: str(r.team_stage, 32) } : {}),
        exact_titles: strList(r.exact_titles, STRATEGY_BOUNDS.maxTitles, STRATEGY_BOUNDS.maxTitleChars),
        safe_synonyms,
        adjacent_titles,
        excluded_titles: strList(r.excluded_titles, STRATEGY_BOUNDS.maxTitles, STRATEGY_BOUNDS.maxTitleChars),
      },
      company_interpretation: {
        verticals: strList(ci.verticals, 8, 64),
        company_types: strList(ci.company_types, 8, 64),
        positive_keywords: strList(ci.positive_keywords, STRATEGY_BOUNDS.maxKeywords, STRATEGY_BOUNDS.maxTitleChars),
        negative_keywords: strList(ci.negative_keywords, STRATEGY_BOUNDS.maxKeywords, STRATEGY_BOUNDS.maxTitleChars),
      },
      searches,
      exclusions: {
        titles: strList(ex.titles, STRATEGY_BOUNDS.maxTitles, STRATEGY_BOUNDS.maxTitleChars),
        companies: strList(ex.companies, STRATEGY_BOUNDS.maxKeywords, STRATEGY_BOUNDS.maxTitleChars),
        industries: strList(ex.industries, STRATEGY_BOUNDS.maxKeywords, STRATEGY_BOUNDS.maxTitleChars),
      },
      expected_funnel: {
        raw_results: nonNegInt(fn.raw_results, 100_000),
        relevant_jobs: nonNegInt(fn.relevant_jobs, 100_000),
        qualified_companies: nonNegInt(fn.qualified_companies, 100_000),
        verified_people: nonNegInt(fn.verified_people, 100_000),
        contact_ready_leads: nonNegInt(fn.contact_ready_leads, 100_000),
      },
      confidence: clamp01(c.confidence),
    },
  };
}

/** The schema rendered into the prompt's `<output_schema>` section. */
export const LEAD_STRATEGY_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["interpretation", "strategy", "constraints_preserved", "requested_approvals", "risks"],
  properties: {
    interpretation: {
      type: "object",
      required: ["summary", "assumptions", "ambiguities", "confidence"],
      properties: {
        summary: { type: "string", maxLength: STRATEGY_BOUNDS.maxTextChars },
        assumptions: { type: "array", items: { type: "string" }, maxItems: 12 },
        ambiguities: { type: "array", items: { type: "string" }, maxItems: 12 },
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
    },
    strategy: {
      type: "object",
      required: ["role_ontology", "company_interpretation", "searches", "exclusions", "expected_funnel", "confidence"],
      properties: {
        role_ontology: {
          type: "object",
          required: ["canonical_concept", "seniority", "exact_titles", "safe_synonyms", "adjacent_titles", "excluded_titles"],
          properties: {
            canonical_concept: { type: "string" },
            department: { type: "string" },
            function: { type: "string" },
            seniority: { type: "array", items: { type: "string" } },
            team_stage: { type: "string" },
            exact_titles: { type: "array", items: { type: "string" }, maxItems: STRATEGY_BOUNDS.maxTitles },
            safe_synonyms: {
              type: "array", maxItems: STRATEGY_BOUNDS.maxSynonyms,
              items: {
                type: "object",
                required: ["title", "language", "relationship", "confidence"],
                properties: {
                  title: { type: "string" },
                  language: { type: "string" },
                  relationship: { enum: ["exact", "safe_synonym"] },
                  confidence: { type: "number", minimum: 0, maximum: 1 },
                },
              },
            },
            adjacent_titles: {
              type: "array", maxItems: STRATEGY_BOUNDS.maxAdjacent,
              items: {
                type: "object",
                required: ["title", "reason", "confidence"],
                properties: {
                  title: { type: "string" },
                  reason: { type: "string" },
                  confidence: { type: "number", minimum: 0, maximum: 1 },
                },
              },
            },
            excluded_titles: { type: "array", items: { type: "string" } },
          },
        },
        company_interpretation: {
          type: "object",
          required: ["verticals", "company_types", "positive_keywords", "negative_keywords"],
          properties: {
            verticals: { type: "array", items: { type: "string" } },
            company_types: { type: "array", items: { type: "string" } },
            positive_keywords: { type: "array", items: { type: "string" } },
            negative_keywords: { type: "array", items: { type: "string" } },
          },
        },
        searches: {
          type: "array", minItems: 1, maxItems: STRATEGY_BOUNDS.maxSearches,
          items: {
            type: "object",
            required: ["purpose", "capability_key", "result_target", "rationale"],
            properties: {
              purpose: { enum: [...LEAD_SEARCH_PURPOSES] },
              capability_key: { type: "string", description: "A key from <available_capabilities>. Never a provider, actor or URL." },
              titles: { type: "array", items: { type: "string" } },
              keywords: { type: "array", items: { type: "string" } },
              locations: { type: "array", items: { type: "string" } },
              languages: { type: "array", items: { type: "string" } },
              result_target: { type: "integer", minimum: 1, maximum: STRATEGY_BOUNDS.maxResultTarget },
              posting_window_days: { type: "integer", minimum: 1, maximum: 365 },
              rationale: { type: "string" },
            },
          },
        },
        exclusions: {
          type: "object",
          required: ["titles", "companies", "industries"],
          properties: {
            titles: { type: "array", items: { type: "string" } },
            companies: { type: "array", items: { type: "string" } },
            industries: { type: "array", items: { type: "string" } },
          },
        },
        expected_funnel: {
          type: "object",
          required: ["raw_results", "relevant_jobs", "qualified_companies", "verified_people", "contact_ready_leads"],
          properties: {
            raw_results: { type: "integer", minimum: 0 },
            relevant_jobs: { type: "integer", minimum: 0 },
            qualified_companies: { type: "integer", minimum: 0 },
            verified_people: { type: "integer", minimum: 0 },
            contact_ready_leads: { type: "integer", minimum: 0 },
          },
        },
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
    },
    constraints_preserved: { type: "array", items: { type: "string" } },
    requested_approvals: {
      type: "array",
      items: {
        type: "object",
        required: ["type", "reason"],
        properties: { type: { type: "string" }, reason: { type: "string" }, proposed_change: {} },
      },
    },
    risks: { type: "array", items: { type: "string" } },
  },
};

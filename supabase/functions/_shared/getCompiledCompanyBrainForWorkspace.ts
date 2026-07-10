// THE shared Company Brain access layer.
//
// Every feature — Leads/Workbench, Scout Radar, Content/Scribe, the agents,
// Outreach, workflows and provider query builders — must obtain the Company
// Brain through this module. It is the single place that knows how to go from
// `workspace_id` to a usable, compiled ICP.
//
//   membership check → load company_brain.profile → normalizeCompanyBrain
//   → compileCompanyBrainContext → ONE canonical object
//
// Rules (see docs/company-brain-architecture.md):
//   * Do NOT read `company_brain.profile` directly in a feature.
//   * Do NOT re-derive ICP, disqualifiers or targeting anywhere else.
//   * Do NOT add another DEFAULT_DISQUALIFIERS list.
//
// The DB client is injected (`BrainDbClient`), so this module is pure enough to
// unit-test with a stub — no Supabase, no network, no providers in tests.

import { normalizeCompanyBrain, projectV2ToLegacyIcp, type CompanyBrainV2, type LegacyIcpProjection } from "./normalizeCompanyBrain.ts";
import { compileCompanyBrainContext, type CompanyBrainContext } from "./companyBrainCompiler.ts";
import { computeCompanyBrainCompleteness, type CompletenessResult } from "./companyBrainCompleteness.ts";

/** The narrow slice of a Supabase client this module needs. */
export interface BrainDbClient {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        eq: (col: string, val: string) => { maybeSingle: () => Promise<{ data: unknown }> };
        maybeSingle: () => Promise<{ data: unknown }>;
      };
    };
  };
}

/** The ONE canonical Company Brain object every feature consumes. */
export interface CanonicalCompanyBrain {
  workspace_id: string;

  company_summary: CompanyBrainContext["company_summary"];

  /** Targeting (compiled: expansions + evidence, never fabricated). */
  target_customer: {
    industries: string[];
    business_models: string[];
    company_size: { min?: number; max?: number };
    geography: string[];
    categories: string[];
    maturity_stage: string[];
    segments: string[];
  };

  buyer_personas: CompanyBrainContext["buyer_personas"];
  pain_points: string[];
  triggers: CompanyBrainContext["buying_triggers"];
  jobs_to_watch: string[];

  disqualifiers: CompanyBrainContext["disqualifiers"];
  positive_examples: string[];
  negative_examples: string[];

  competitors: string[];
  tools: string[];

  positioning: { promise?: string; proof_themes: string[]; ctas: string[]; banned_claims: string[] };
  brand_voice: { voice_notes: string[]; banned_claims: string[] };
  content_angles: string[];

  qualification_rules: {
    required_evidence: string[];
    reject_if: string[];
    manual_review_if: string[];
  };

  /** Honesty layer — features MUST degrade on these. */
  setup_required: boolean;
  brain_confidence: CompanyBrainV2["brain_confidence"];
  missing_fields: string[];
  warnings: string[];

  /** Query terms for provider search (hiring, funding, competitor, …). */
  query_strategy: CompanyBrainContext["query_strategy"];

  /** Legacy `icp.*` view, for readers not yet migrated to this layer. */
  legacy_icp: LegacyIcpProjection;

  /** Escape hatches — prefer the fields above. */
  compiled: CompanyBrainContext;
  normalized: CompanyBrainV2;
  completeness: CompletenessResult;
}

export type BrainLoadError = "forbidden" | "not_found";

export interface BrainLoadResult {
  ok: boolean;
  brain: CanonicalCompanyBrain | null;
  error?: BrainLoadError;
}

export interface GetBrainOptions {
  /** When set, membership in `workspace_members` is verified before loading. */
  userId?: string;
  /**
   * Skip the membership check. Only legitimate for trusted server contexts that
   * have already authorized the caller (e.g. a cron job). Never from a request.
   */
  skipMembershipCheck?: boolean;
}

/** Build the canonical object from a raw profile. Pure — no DB, no network. */
export function buildCanonicalCompanyBrain(
  workspace_id: string,
  profile: Record<string, unknown> | null | undefined,
): CanonicalCompanyBrain {
  const raw = (profile ?? {}) as Record<string, unknown>;
  const normalized = normalizeCompanyBrain(raw);
  const compiled = compileCompanyBrainContext({
    workspace_id,
    profile: raw,
    signal_preferences: raw["signal_preferences"] as Record<string, unknown> | undefined,
  });
  const completeness = computeCompanyBrainCompleteness(normalized);

  return {
    workspace_id,
    company_summary: compiled.company_summary,

    target_customer: {
      industries: compiled.icp.industries,
      business_models: compiled.icp.business_models,
      company_size: { min: compiled.icp.company_size_min, max: compiled.icp.company_size_max },
      geography: compiled.icp.locations,
      categories: compiled.icp.categories,
      maturity_stage: compiled.icp.maturity_stage,
      segments: compiled.icp.target_customer_segments,
    },

    buyer_personas: compiled.buyer_personas,
    pain_points: compiled.buying_triggers.workflow_pain,
    triggers: compiled.buying_triggers,
    jobs_to_watch: compiled.jobs_to_watch,

    disqualifiers: compiled.disqualifiers,
    positive_examples: compiled.positive_examples,
    negative_examples: compiled.negative_examples,

    competitors: compiled.competitors_and_tools.competitors,
    tools: compiled.competitors_and_tools.integration_tools,

    positioning: {
      promise: compiled.company_summary.value_prop,
      proof_themes: compiled.content_strategy.proof_themes,
      ctas: compiled.content_strategy.ctas,
      banned_claims: compiled.content_strategy.banned_claims,
    },
    brand_voice: {
      voice_notes: compiled.content_strategy.voice_notes,
      banned_claims: compiled.content_strategy.banned_claims,
    },
    content_angles: compiled.buying_triggers.content_topics,

    qualification_rules: compiled.qualification_rules,

    setup_required: compiled.meta.setup_required,
    brain_confidence: compiled.meta.brain_confidence,
    missing_fields: compiled.meta.missing_fields,
    warnings: compiled.meta.warnings,

    query_strategy: compiled.query_strategy,
    legacy_icp: projectV2ToLegacyIcp(normalized),

    compiled,
    normalized,
    completeness,
  };
}

/**
 * Load + normalize + compile the Company Brain for a workspace.
 *
 * Returns `forbidden` when a `userId` is supplied and that user is not a member
 * of the workspace. A workspace with no Brain row is NOT an error — it yields a
 * conservative, empty Brain with `setup_required = true`, so callers degrade
 * instead of crashing (and never fabricate an ICP).
 */
export async function getCompiledCompanyBrainForWorkspace(
  db: BrainDbClient,
  workspace_id: string,
  opts: GetBrainOptions = {},
): Promise<BrainLoadResult> {
  if (!workspace_id) return { ok: false, brain: null, error: "not_found" };

  // 1. Membership — the only authorization gate.
  if (!opts.skipMembershipCheck) {
    if (!opts.userId) return { ok: false, brain: null, error: "forbidden" };
    const { data: member } = await db
      .from("workspace_members").select("workspace_id")
      .eq("workspace_id", workspace_id).eq("user_id", opts.userId).maybeSingle();
    if (!member) return { ok: false, brain: null, error: "forbidden" };
  }

  // 2. Load the profile JSONB.
  const { data: row } = await db
    .from("company_brain").select("profile").eq("workspace_id", workspace_id).maybeSingle();
  const profile = ((row as { profile?: Record<string, unknown> } | null)?.profile) ?? {};

  // 3–5. Normalize → compile → canonical object.
  return { ok: true, brain: buildCanonicalCompanyBrain(workspace_id, profile) };
}

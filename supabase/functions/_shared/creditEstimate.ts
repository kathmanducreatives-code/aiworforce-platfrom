// Post-lead action credit estimates. Pure / import-free (Deno + Node testable).
//
// Credits are INTERNAL "Agentory credits" — estimates, NOT vendor dollar costs.
// Nothing is charged here; if a real credit ledger exists it reserves/deducts
// only after the user confirms (handled by the caller). This module only does
// the deterministic math + builds the post-lead action card payload.

export type PostLeadAction =
  | "save_only"
  | "rank"
  | "enrich"
  | "draft_outreach"
  | "enrich_and_draft"
  | "export";

export interface CreditBreakdownLine {
  label: string;
  unit_cost: number;
  quantity: number;
  total: number;
}

export interface CreditEstimate {
  action: PostLeadAction;
  lead_count: number;
  enrichable_count?: number;
  credits: number;
  breakdown: CreditBreakdownLine[];
  note?: string;
}

export interface CreditCostConfig {
  rank_per_10_leads: number;
  firecrawl_enrichment_per_website: number;
  claude_outreach_draft_per_lead: number;
  export: number;
  save_only: number;
}

// Configurable later via env/admin config. These are estimates, not vendor costs.
export const DEFAULT_CREDIT_COSTS: CreditCostConfig = {
  rank_per_10_leads: 1,
  firecrawl_enrichment_per_website: 1,
  claude_outreach_draft_per_lead: 2,
  export: 0,
  save_only: 0,
};

function clampInt(n: number, min = 0): number {
  return Math.max(min, Math.floor(Number.isFinite(n) ? n : 0));
}

/** Rank cost is billed per 10-lead block, rounded up. 25 leads → ceil(2.5)=3. */
export function rankCredits(leadCount: number, cfg = DEFAULT_CREDIT_COSTS): number {
  const n = clampInt(leadCount);
  if (n === 0) return 0;
  return Math.ceil(n / 10) * cfg.rank_per_10_leads;
}

/** Enrichment applies only to leads that actually have a website/domain. */
export function enrichCredits(enrichableCount: number, cfg = DEFAULT_CREDIT_COSTS): number {
  return clampInt(enrichableCount) * cfg.firecrawl_enrichment_per_website;
}

export function draftCredits(leadCount: number, cfg = DEFAULT_CREDIT_COSTS): number {
  return clampInt(leadCount) * cfg.claude_outreach_draft_per_lead;
}

/** Estimate one action's credits + breakdown. */
export function estimateAction(
  action: PostLeadAction,
  leadCount: number,
  enrichableCount: number,
  cfg: CreditCostConfig = DEFAULT_CREDIT_COSTS,
): CreditEstimate {
  const n = clampInt(leadCount);
  const e = Math.min(clampInt(enrichableCount), n);
  const partialNote = e < n
    ? `Only ${e} of ${n} leads include a website, so enrichment applies to ${e} lead${e === 1 ? "" : "s"}.`
    : undefined;

  switch (action) {
    case "save_only":
      return { action, lead_count: n, credits: cfg.save_only, breakdown: [{ label: "Save to Signal Feed", unit_cost: 0, quantity: n, total: 0 }], note: "No tool runs." };
    case "export":
      return { action, lead_count: n, credits: cfg.export, breakdown: [{ label: "Keep for later review", unit_cost: 0, quantity: n, total: 0 }], note: "No tool runs." };
    case "rank": {
      const blocks = n === 0 ? 0 : Math.ceil(n / 10);
      const credits = rankCredits(n, cfg);
      return { action, lead_count: n, credits, breakdown: [{ label: "Aria ranking (per 10 leads)", unit_cost: cfg.rank_per_10_leads, quantity: blocks, total: credits }], note: "Ranks existing leads only — no Apify, Firecrawl, or outreach." };
    }
    case "enrich": {
      const credits = enrichCredits(e, cfg);
      return { action, lead_count: n, enrichable_count: e, credits, breakdown: [{ label: "Firecrawl website enrichment", unit_cost: cfg.firecrawl_enrichment_per_website, quantity: e, total: credits }], note: partialNote };
    }
    case "draft_outreach": {
      const credits = draftCredits(n, cfg);
      return { action, lead_count: n, credits, breakdown: [{ label: "Claude outreach drafts", unit_cost: cfg.claude_outreach_draft_per_lead, quantity: n, total: credits }], note: "Drafts only — approval required, nothing sent." };
    }
    case "enrich_and_draft": {
      const enrich = enrichCredits(e, cfg);
      const draft = draftCredits(n, cfg);
      return {
        action, lead_count: n, enrichable_count: e, credits: enrich + draft,
        breakdown: [
          { label: "Firecrawl website enrichment", unit_cost: cfg.firecrawl_enrichment_per_website, quantity: e, total: enrich },
          { label: "Claude outreach drafts", unit_cost: cfg.claude_outreach_draft_per_lead, quantity: n, total: draft },
        ],
        note: [partialNote, "Enrich first, then draft — approval required, nothing sent."].filter(Boolean).join(" "),
      };
    }
  }
}

export const POST_LEAD_ACTIONS: PostLeadAction[] = ["save_only", "rank", "enrich", "draft_outreach", "enrich_and_draft", "export"];

export function estimatePostLeadActions(
  leadCount: number,
  enrichableCount: number,
  cfg: CreditCostConfig = DEFAULT_CREDIT_COSTS,
): CreditEstimate[] {
  return POST_LEAD_ACTIONS.map((a) => estimateAction(a, leadCount, enrichableCount, cfg));
}

// ----- Post-lead action card payload (rendered in chat) -----

export interface PostLeadActionOption {
  action: PostLeadAction;
  label: string;
  description: string;
  runs: string;        // which tool/agent runs
  credits: number;
  enrichable_count?: number;
  breakdown: CreditBreakdownLine[];
  note?: string;
  safety_note?: string;
  requires_confirm: boolean; // paid actions confirm before running
  command: string;     // natural-language phrase dispatched on click (reuses memory handlers)
}

export interface PostLeadActionsCard {
  kind: "post_lead_actions";
  title: string;
  subtitle: string;
  lead_count: number;
  enrichable_count: number;
  lead_candidate_ids: string[];
  options: PostLeadActionOption[];
}

const META: Record<PostLeadAction, { label: string; description: string; runs: string; safety?: string; command: (n: number) => string }> = {
  save_only: { label: "Save only", description: "Save these leads to Signal Feed without extra processing.", runs: "No tool runs", command: () => "Save these leads to the Signal Feed for now." },
  rank: { label: "Rank by fit", description: "Aria ranks these leads using your Company Brain.", runs: "Aria (ranking)", command: () => "Rank these leads by fit." },
  enrich: { label: "Enrich with Firecrawl", description: "Hawk analyzes company websites and finds personalization angles.", runs: "Hawk · Firecrawl", command: (n) => `Enrich the top ${n} leads.` },
  draft_outreach: { label: "Draft outreach with Claude", description: "Penn writes approval-ready, personalized outreach using your Company Brain.", runs: "Penn · Claude", safety: "Nothing will be sent — drafts require your approval.", command: (n) => `Draft outreach to the top ${n}.` },
  enrich_and_draft: { label: "Enrich + draft", description: "Hawk enriches each company, then Penn uses Claude to write stronger personalized drafts.", runs: "Hawk · Firecrawl → Penn · Claude", safety: "Nothing will be sent — drafts require your approval.", command: (n) => `Enrich the top ${n} leads and then draft outreach to them.` },
  export: { label: "Review in Signal Feed", description: "Keep the leads saved for later review.", runs: "No tool runs", command: () => "Keep these leads saved for review later." },
};

export function buildPostLeadActionsCard(
  leadCount: number,
  enrichableCount: number,
  leadCandidateIds: string[] = [],
  cfg: CreditCostConfig = DEFAULT_CREDIT_COSTS,
): PostLeadActionsCard {
  const n = clampInt(leadCount);
  const e = Math.min(clampInt(enrichableCount), n);
  const estimates = estimatePostLeadActions(n, e, cfg);

  const options: PostLeadActionOption[] = estimates.map((est) => {
    const m = META[est.action];
    return {
      action: est.action,
      label: m.label,
      description: m.description,
      runs: m.runs,
      credits: est.credits,
      enrichable_count: est.enrichable_count,
      breakdown: est.breakdown,
      note: est.note,
      safety_note: m.safety,
      requires_confirm: est.credits > 0,
      command: m.command(n),
    };
  });

  return {
    kind: "post_lead_actions",
    title: `${n} lead${n === 1 ? "" : "s"} found`,
    subtitle: "Choose how much work you want Agentory to do next. Nothing will be sent without approval.",
    lead_count: n,
    enrichable_count: e,
    lead_candidate_ids: leadCandidateIds,
    options,
  };
}

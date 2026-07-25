// Canonical Workbench decision-maker display contract. Pure — no React, no `@/`
// imports — so it is unit-testable alongside the other src/lib models.
//
// WHY THIS EXISTS
//
// Three different decision-maker shapes reach the UI:
//
//   1. the immediate run-agent action response — CANONICAL only
//      (full_name / current_title / current_company_name / linkedin_url)
//   2. lead_candidates.raw.decision_makers written by the executor — a SUPERSET
//      (canonical + legacy name/title/company/linkedinUrl)
//   3. older persisted rows — LEGACY only (name/title/linkedinUrl)
//
// The row renderer read `top.name`, which exists in (2) and (3) but NOT in (1),
// so a successful action rendered "Verified decision-makers found: undefined"
// via template-literal interpolation.
//
// Aliases are resolved HERE and nowhere else. Components consume the canonical
// DTO only, so a future backend field rename is a one-file change.

export type DecisionMakerRowStatus =
  | 'succeeded'
  | 'no_match'
  | 'needs_manual_review'
  | 'unavailable'
  | 'timed_out'
  | 'failed'
  /** A "successful" payload we cannot display truthfully — never shown as success. */
  | 'contract_error';

export interface DisplayDecisionMaker {
  contact_id?: string;
  full_name: string;
  first_name?: string;
  last_name?: string;
  linkedin_url: string;
  current_title?: string;
  current_company_name?: string;
  role_family?: string;
  verification_status: string;
  verification_methods: string[];
  confidence?: string;
  rank: number;
  rank_reasons: string[];
  persisted: boolean;
}

export interface DecisionMakerRowView {
  status: DecisionMakerRowStatus;
  reason_code?: string;
  primary_decision_maker?: DisplayDecisionMaker;
  additional_decision_makers: DisplayDecisionMaker[];
  verified_count: number;
  manual_review_count: number;
  rejected_count: number;
  /** Set when status is contract_error, for diagnosis — never rendered raw. */
  contract_error_reason?: string;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * Deterministic name precedence:
 *   full_name → name → fullName → first_name + last_name → undefined
 *
 * Returning undefined is meaningful: the caller must degrade the row to
 * contract_error rather than print a placeholder.
 */
export function resolveDisplayName(raw: Record<string, unknown>): string | undefined {
  const direct = str(raw.full_name) ?? str(raw.name) ?? str(raw.fullName);
  if (direct) return direct;
  const first = str(raw.first_name) ?? str(raw.firstName);
  const last = str(raw.last_name) ?? str(raw.lastName);
  const joined = [first, last].filter(Boolean).join(' ').trim();
  return joined || undefined;
}

/** Canonical key wins over legacy on conflict. */
export function resolveLinkedInUrl(raw: Record<string, unknown>): string | undefined {
  return str(raw.linkedin_url) ?? str(raw.linkedinUrl) ?? str(raw.linkedInUrl) ??
    str(raw.profile_url) ?? str(raw.profileUrl);
}

export function resolveTitle(raw: Record<string, unknown>): string | undefined {
  return str(raw.current_title) ?? str(raw.title) ?? str(raw.headline);
}

export function resolveCompany(raw: Record<string, unknown>): string | undefined {
  return str(raw.current_company_name) ?? str(raw.company) ?? str(raw.company_name);
}

/**
 * Normalize ONE decision-maker record from any source into the display DTO.
 * Returns null when it cannot be displayed truthfully — a person with no
 * resolvable name or no profile link is not a usable contact.
 */
export function normalizeDecisionMaker(
  input: unknown,
  fallbackRank = 1,
): DisplayDecisionMaker | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;

  const full_name = resolveDisplayName(raw);
  const linkedin_url = resolveLinkedInUrl(raw);
  if (!full_name || !linkedin_url) return null;

  return {
    contact_id: str(raw.contact_id),
    full_name,
    first_name: str(raw.first_name) ?? str(raw.firstName),
    last_name: str(raw.last_name) ?? str(raw.lastName),
    linkedin_url,
    current_title: resolveTitle(raw),
    current_company_name: resolveCompany(raw),
    role_family: str(raw.role_family),
    verification_status: str(raw.verification_status) ?? 'verified',
    verification_methods: Array.isArray(raw.verification_methods)
      ? (raw.verification_methods as unknown[]).map((m) => String(m))
      : [],
    confidence: str(raw.confidence),
    rank: typeof raw.rank === 'number' ? raw.rank : fallbackRank,
    rank_reasons: Array.isArray(raw.rank_reasons)
      ? (raw.rank_reasons as unknown[]).map((r) => String(r))
      : [],
    persisted: raw.persisted === true,
  };
}

const KNOWN_STATUSES = new Set<string>([
  'succeeded', 'no_match', 'needs_manual_review', 'unavailable', 'timed_out', 'failed',
]);

/**
 * Build the row view from a per_lead payload (immediate response OR the
 * persisted raw record — both are supported).
 *
 * A `succeeded` payload whose people cannot be displayed becomes
 * `contract_error`. Reporting it as success is what produced the "undefined"
 * row: the status said success while the content could not be rendered.
 */
export function buildDecisionMakerRowView(payload: Record<string, unknown> | null | undefined): DecisionMakerRowView {
  const p = (payload ?? {}) as Record<string, unknown>;
  const rawStatus = str(p.status);
  const status = (rawStatus && KNOWN_STATUSES.has(rawStatus) ? rawStatus : 'failed') as DecisionMakerRowStatus;
  const reason_code = str(p.reason_code);

  const list = Array.isArray(p.decision_makers) ? (p.decision_makers as unknown[]) : [];
  const people = list
    .map((d, i) => normalizeDecisionMaker(d, i + 1))
    .filter((d): d is DisplayDecisionMaker => d !== null)
    .sort((a, b) => a.rank - b.rank);

  const base: DecisionMakerRowView = {
    status,
    reason_code,
    additional_decision_makers: [],
    verified_count: num(p.verified_profile_count),
    manual_review_count: num(p.manual_review_count),
    rejected_count: num(p.rejected_count) || num(p.rejected_profile_count),
  };

  if (status !== 'succeeded') return base;

  if (people.length === 0) {
    return {
      ...base,
      status: 'contract_error',
      contract_error_reason: list.length > 0
        ? 'decision_maker_display_contract_invalid'
        : 'succeeded_without_decision_makers',
    };
  }

  return { ...base, primary_decision_maker: people[0], additional_decision_makers: people.slice(1) };
}

// ---------------------------------------------------------------------------
// Display copy
// ---------------------------------------------------------------------------

/** Concise persona label from the role family. */
export function personaLabel(roleFamily: string | undefined): string {
  switch (roleFamily) {
    case 'founder': return 'Founder';
    case 'executive_revenue': return 'Revenue Leader';
    case 'sales_leadership': return 'Sales Leader';
    case 'growth_leadership': return 'Growth Leader';
    case 'revenue_operations': return 'RevOps Leader';
    case 'sales_operations': return 'Sales Ops Leader';
    default: return 'Decision Maker';
  }
}

/** "Founder & CEO · Harmonic Security" — omits missing halves cleanly. */
export function titleCompanyLine(dm: DisplayDecisionMaker): string {
  return [dm.current_title, dm.current_company_name].filter(Boolean).join(' · ');
}

export function verificationLine(dm: DisplayDecisionMaker): string {
  return dm.verification_status === 'verified'
    ? 'Current employer verified'
    : 'Employment not verified';
}

export type EmailState = 'not_enriched' | 'not_searched' | 'unavailable' | 'present';

/**
 * Email copy. Deliberately never "no email" — that asserts a provider proved no
 * address exists, which we have not done.
 */
export function emailStatusCopy(state: EmailState): string {
  switch (state) {
    case 'present': return 'Email available';
    case 'not_searched': return 'Email not searched';
    case 'unavailable': return 'Email enrichment unavailable';
    default: return 'Email not enriched';
  }
}

export const ROW_STATUS_HEADLINE: Record<DecisionMakerRowStatus, string> = {
  succeeded: 'Verified decision-maker found',
  no_match: 'No verified founder or GTM leader found',
  needs_manual_review: 'Profiles need review',
  unavailable: 'People search is unavailable',
  timed_out: 'Decision-maker search timed out',
  failed: 'Decision-maker search failed',
  contract_error: 'Result could not be displayed',
};

export const ROW_STATUS_DETAIL: Record<DecisionMakerRowStatus, string> = {
  succeeded: '',
  no_match: 'The search completed, but no current target-company leader passed verification.',
  needs_manual_review: 'Current employment could not be verified strongly enough.',
  unavailable: 'People search is disabled or unavailable in this environment.',
  timed_out: 'The provider did not respond in time.',
  failed: 'The provider or persistence step failed.',
  contract_error: 'The action reported success but returned no displayable contact.',
};

// ---------------------------------------------------------------------------
// Action enablement — driven by canonical status + prerequisites, never by
// decision_makers.length.
// ---------------------------------------------------------------------------

export interface RowActionAvailability {
  enrich_contact: boolean;
  research_company: boolean;
  generate_outreach: boolean;
  retry_search: boolean;
  review_profiles: boolean;
}

export function rowActionAvailability(view: DecisionMakerRowView): RowActionAvailability {
  const hasVerifiedContact = view.status === 'succeeded' && !!view.primary_decision_maker;

  return {
    // Only a verified, displayable contact may be enriched.
    enrich_contact: hasVerifiedContact,
    // Researching the company is always safe.
    research_company: true,
    // Outreach still has its own evidence gate downstream; this only reflects
    // the decision-maker prerequisite.
    generate_outreach: hasVerifiedContact,
    retry_search: view.status === 'no_match' || view.status === 'timed_out' ||
      view.status === 'failed' || view.status === 'contract_error',
    review_profiles: view.status === 'needs_manual_review' && view.manual_review_count > 0,
  };
}

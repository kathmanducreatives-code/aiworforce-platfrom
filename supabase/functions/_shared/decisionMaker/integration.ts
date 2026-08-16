// Runtime integration for find_decision_makers.
//
// Maps a live LeadRecord onto the pure pipeline, then routes each accepted
// candidate through decidePersistence before any write. Every side-effecting
// dependency — provider, contact lookup, contact write, ownership check — is
// injected, so the whole flow is exercised in tests with no network, no
// provider and no database.
//
// The pipeline's canonical status is AUTHORITATIVE. Status is never re-inferred
// from `decision_makers.length` further down the stack: that is what previously
// turned "provider disabled" into "no decision-makers found".

import { findDecisionMakers, type DecisionMakerOutcome, type PeopleSearchProvider } from "./pipeline.ts";
import { decidePersistence, type PersistenceCandidate } from "./persistenceGuard.ts";
import { normalizePersonLinkedInUrl } from "./personProfile.ts";
import type { DecisionMakerCompanyIdentityInput } from "./companyIdentity.ts";
import type { RawProviderProfile } from "./personProfile.ts";

/** Subset of the executor's LeadRecord this integration reads. */
export interface LeadRecordLike {
  lead_candidate_id: string;
  company_name?: string | null;
  website?: string | null;
  company_website?: string | null;
  domain?: string | null;
  company_linkedin_url?: string | null;
  job_title?: string | null;
  job_url?: string | null;
  employee_count?: number | null;
  poster_contact_hint?: { name?: string | null; profile_url?: string | null; title?: string | null } | null;
  company_enrichment?: {
    founders?: Array<{ name?: string | null; title?: string | null; linkedin_url?: string | null }> | null;
    executives?: Array<{ name?: string | null; title?: string | null; linkedin_url?: string | null }> | null;
  } | null;
}

export interface ExistingContact {
  id: string;
  linkedin_url: string | null;
}

/** Injected side-effect ports. None of these are called in a pure unit test. */
export interface IntegrationPorts {
  provider: PeopleSearchProvider;
  /** Existing workspace contacts, for reuse + duplicate suppression. */
  lookupContacts: (workspaceId: string) => Promise<ExistingContact[]>;
  /** Write one verified contact. Returns its id, or throws to signal failure. */
  persistContact: (candidate: PersistedContactInput) => Promise<string>;
  /** Workspace that actually owns this lead, resolved server-side. */
  resolveLeadWorkspace: (leadCandidateId: string) => Promise<string | null>;
}

export interface PersistedContactInput {
  workspace_id: string;
  lead_candidate_id: string;
  full_name: string | null;
  title: string | null;
  linkedin_url: string;
  provenance: Record<string, unknown>;
}

export interface FrontendDecisionMaker {
  contact_id?: string;
  full_name: string | null;
  linkedin_url: string | null;
  current_title: string | null;
  current_company_name: string | null;
  role_family: string;
  verification_status: string;
  verification_methods: string[];
  confidence: string;
  rank: number;
  rank_reasons: string[];
  persisted: boolean;
}

export interface IntegrationResult {
  lead_candidate_id: string;
  status: DecisionMakerOutcome;
  reason_code: string;
  retryable: boolean;
  company_identity: unknown;
  provider_attempted: string | null;
  provider_run_id: string | null;
  returned_profile_count: number;
  normalized_profile_count: number;
  verified_profile_count: number;
  rejected_profile_count: number;
  manual_review_count: number;
  persisted_count: number;
  existing_contact_count: number;
  decision_makers: FrontendDecisionMaker[];
  rejected_profiles: unknown[];
  rejection_summary: unknown;
  observability: Record<string, unknown>;
}

/**
 * Build the canonical identity input from live lead fields. Nothing is invented:
 * absent fields stay absent so the resolver can grade the identity honestly and
 * refuse an unverifiable search.
 */
export function identityInputFromLead(lead: LeadRecordLike): DecisionMakerCompanyIdentityInput {
  return {
    company_name: lead.company_name ?? undefined,
    company_linkedin_url: lead.company_linkedin_url ?? undefined,
    domain: lead.domain ?? undefined,
    website: lead.website ?? lead.company_website ?? undefined,
  };
}

/**
 * Map existing person evidence into a shortcut candidate. A job poster is only a
 * HINT — it still passes normalization, employer verification, role
 * classification and the persistence guard exactly like a search result.
 */
export function knownPersonFromLead(lead: LeadRecordLike): RawProviderProfile | null {
  const poster = lead.poster_contact_hint;
  if (poster?.name && normalizePersonLinkedInUrl(poster.profile_url)) {
    return {
      full_name: poster.name,
      linkedin_url: poster.profile_url,
      current_title: poster.title ?? null,
      // Deliberately NO current_company_* here: the poster record does not prove
      // employment, and asserting it would make the shortcut self-verifying.
      experience: [],
    };
  }

  const founder = lead.company_enrichment?.founders?.find((f) => f?.name && normalizePersonLinkedInUrl(f.linkedin_url));
  if (founder) {
    return {
      full_name: founder.name,
      linkedin_url: founder.linkedin_url,
      current_title: founder.title ?? null,
      experience: [],
    };
  }
  return null;
}

/**
 * Run find_decision_makers for one lead, end to end.
 */
export async function runDecisionMakerAction(
  lead: LeadRecordLike,
  ctx: { workspace_id: string },
  ports: IntegrationPorts,
): Promise<IntegrationResult> {
  const result = await findDecisionMakers(
    {
      lead_candidate_id: lead.lead_candidate_id,
      identity_input: identityInputFromLead(lead),
      employee_count: lead.employee_count ?? undefined,
      known_person: knownPersonFromLead(lead),
    },
    ports.provider,
  );

  const obs: Record<string, unknown> = { ...result.observability };
  let persisted_count = 0;
  let existing_contact_count = 0;
  let persistence_failed_count = 0;
  let skipped_unverified_count = 0;

  const frontend: FrontendDecisionMaker[] = [];

  if (result.decision_makers.length > 0) {
    const leadWorkspace = await ports.resolveLeadWorkspace(lead.lead_candidate_id);
    const existing = await ports.lookupContacts(ctx.workspace_id);
    const existingUrls = existing.map((c) => c.linkedin_url ?? "").filter(Boolean);
    const byUrl = new Map<string, string>();
    for (const c of existing) {
      const u = normalizePersonLinkedInUrl(c.linkedin_url);
      if (u) byUrl.set(u, c.id);
    }

    for (const dm of result.decision_makers) {
      const candidate: PersistenceCandidate = {
        full_name: dm.full_name,
        linkedin_url: dm.linkedin_url,
        role_family: dm.role_family,
        verification_status: dm.verification_status,
        provenance: {
          provider: result.provider_attempted,
          actor: (result.observability.actor_selected as string | null) ?? null,
          stage: (result.observability.stage_run as string | null) ?? null,
          verification_methods: dm.verification_methods,
          // Forward the CURRENT-EMPLOYER verification so the account-association
          // resolver receives a strong signal at persistence time. Without this,
          // the contact would always resolve to needs_review and account_id would
          // never be written (the dead forward-path the pre-merge review caught).
          // `verified` means the pipeline proved this person belongs to the
          // company-scoped search's company.
          verification_status: dm.verification_status,
          current_company_name: dm.current_company_name,
        },
      };

      const decision = decidePersistence(candidate, {
        workspace_id: ctx.workspace_id,
        lead_workspace_id: leadWorkspace ?? "",
        existing_contact_urls: existingUrls,
      });

      // An already-known contact is REUSED, not re-inserted or dropped.
      if (!decision.ok && decision.reason_code === "duplicate_contact") {
        const url = normalizePersonLinkedInUrl(dm.linkedin_url);
        existing_contact_count += 1;
        frontend.push({ ...toFrontend(dm), contact_id: url ? byUrl.get(url) : undefined, persisted: true });
        continue;
      }

      if (!decision.ok) {
        skipped_unverified_count += 1;
        frontend.push({ ...toFrontend(dm), persisted: false });
        continue;
      }

      try {
        const id = await ports.persistContact({
          workspace_id: ctx.workspace_id,
          lead_candidate_id: lead.lead_candidate_id,
          full_name: dm.full_name,
          title: dm.current_title,
          linkedin_url: decision.normalized_linkedin_url,
          provenance: candidate.provenance as Record<string, unknown>,
        });
        persisted_count += 1;
        frontend.push({ ...toFrontend(dm), contact_id: id, persisted: true });
      } catch (e) {
        // Per-candidate failure: the lead is not abandoned, and the raw database
        // error is never surfaced TO THE USER.
        //
        // It is logged, though. Discarding it entirely left an operator with
        // `persistence_failed_count: 3` and no way to learn why — and this is
        // the path a changed database call shape fails down, so the count can
        // go to zero-persisted while every other counter still reads healthy.
        console.error("[decision-maker] contact persistence failed", {
          lead_candidate_id: lead.lead_candidate_id,
          error: e instanceof Error ? e.message : String(e),
        });
        persistence_failed_count += 1;
        frontend.push({ ...toFrontend(dm), persisted: false });
      }
    }
  }

  obs.existing_contact_count = existing_contact_count;
  obs.persisted_count = persisted_count;
  obs.persistence_failed_count = persistence_failed_count;
  obs.skipped_unverified_count = skipped_unverified_count;
  obs.newly_persisted_count = persisted_count;
  obs.already_existing_count = existing_contact_count;

  // Persistence can only DOWNGRADE a success, never invent one.
  let status: DecisionMakerOutcome = result.status;
  let reason_code = result.reason_code;
  let retryable = result.retryable;

  if (result.status === "succeeded") {
    const wrote = persisted_count + existing_contact_count;
    if (wrote === 0 && persistence_failed_count > 0) {
      status = "failed";
      reason_code = "persistence_failed";
      retryable = true;
    }
    // Partial failure stays succeeded — at least one contact landed — and the
    // shortfall is visible in the observability counts rather than hidden.
  }

  obs.final_outcome = status;

  return {
    lead_candidate_id: result.lead_candidate_id,
    status,
    reason_code,
    retryable,
    company_identity: result.company_identity,
    provider_attempted: result.provider_attempted,
    provider_run_id: result.provider_run_id,
    returned_profile_count: result.returned_profile_count,
    normalized_profile_count: (result.observability.normalized_count as number) ?? 0,
    verified_profile_count: result.verified_profile_count,
    rejected_profile_count: result.rejected_profile_count,
    manual_review_count: result.manual_review_count,
    persisted_count,
    existing_contact_count,
    decision_makers: frontend,
    rejected_profiles: result.rejected_profiles,
    rejection_summary: result.rejection_summary,
    observability: obs,
  };
}

/** Frontend projection — no experience blobs, no emails, no raw payload. */
function toFrontend(dm: {
  full_name: string | null; linkedin_url: string | null; current_title: string | null;
  current_company_name: string | null; role_family: string; verification_status: string;
  verification_methods: string[]; confidence: string; rank: number; rank_reasons: string[];
}): FrontendDecisionMaker {
  return {
    full_name: dm.full_name,
    linkedin_url: dm.linkedin_url,
    current_title: dm.current_title,
    current_company_name: dm.current_company_name,
    role_family: dm.role_family,
    verification_status: dm.verification_status,
    verification_methods: dm.verification_methods,
    confidence: dm.confidence,
    rank: dm.rank,
    rank_reasons: dm.rank_reasons,
    persisted: false,
  };
}

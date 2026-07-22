// THE one canonical, account-level lead read model.
//
// WHY THIS EXISTS
//   The lead layer had two diverging surfaces (Lead Library + Workbench audit,
//   2026-07-21):
//     * Workbench reads `lead_candidates` + the `raw.agentory_workbench` JSONB
//       stage envelopes (research, decision-makers, personalized opener,
//       selected recipient) with success-preserving semantics.
//     * Lead Library read `accounts` + `outreach_drafts` only, so it missed the
//       current opener, the recorded recipient, and the Workbench research
//       state — and it GUESSED the recipient from contact order.
//   Production evidence: 63 accounts / 80 lead_candidates, 12 accounts with
//   multiple plan-scoped lead rows (max 4), 3 openers in the JSONB stage that
//   were invisible to Lead Library, all 6 outreach_drafts recipient-less and 5
//   of 6 unlinked.
//
//   This module derives ONE canonical view per ACCOUNT from all of its
//   plan-scoped lead rows, so table, Lead Detail, Lead Library and CSV read the
//   same research/recipient/outreach/status. It changes no storage: it is a pure
//   read adapter over the current tables.
//
//   Boundaries (compatibility-only): it does NOT merge/delete rows, does NOT
//   assume `lead_evidence`/`signal_events` exist in production, and does NOT
//   invent freshness/title/query/author it cannot read.
//
// Pure — no React, no network, no Supabase.

import { hydrateOutreachStage } from "@/lib/outreachStageView";
import type { OutreachStageView } from "@/lib/workbenchAccountView";

// ----------------------------------------------------------------- inputs -----

/** A `lead_candidates` row as read from the DB (`raw` is the jsonb itself). */
export interface CanonicalLeadCandidate {
  id: string;
  workspace_id: string;
  account_id: string | null;
  plan_id: string | null;
  status?: string | null;
  fit_score?: number | null;
  priority?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  /** The jsonb — `raw.agentory_workbench.*` holds the canonical stages. */
  raw?: unknown;
}

export interface CanonicalAccount {
  id: string;
  workspace_id: string;
  name: string;
  domain?: string | null;
  website_url?: string | null;
  linkedin_url?: string | null;
  industry?: string | null;
  employee_count?: string | null;
  location?: string | null;
  stage?: string | null;
  source?: string | null;
  description?: string | null;
  raw?: unknown;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface CanonicalContact {
  id: string;
  workspace_id: string;
  account_id: string | null;
  full_name?: string | null;
  title?: string | null;
  linkedin_url?: string | null;
  email?: string | null;
  phone?: string | null;
  raw?: unknown;
}

export interface CanonicalOutreachDraft {
  id: string;
  workspace_id: string;
  account_id?: string | null;
  lead_candidate_id?: string | null;
  contact_id?: string | null;
  status?: string | null;
  body?: string | null;
  updated_at?: string | null;
  raw?: unknown;
}

export interface CanonicalActivityEvent {
  id: string;
  at: string;
  type: string;
  detail?: string | null;
  owner?: string | null;
  channel?: string | null;
}

export interface DeriveCanonicalLeadInput {
  workspaceId: string;
  account: CanonicalAccount;
  /** ALL lead_candidates for this account (already workspace-scoped). */
  leadCandidates: CanonicalLeadCandidate[];
  /** Contacts for this account. */
  contacts?: CanonicalContact[];
  /** Outreach drafts that are provably linked to this account/its leads. */
  outreachDrafts?: CanonicalOutreachDraft[];
  activity?: CanonicalActivityEvent[];
  /** Optional durable manual recipient override (contact id). */
  manualRecipientContactId?: string | null;
}

// ---------------------------------------------------------------- status ------
// Separate domains — one is never derived from another (audit §7).

export type CanonicalAccountStatus =
  | "new" | "qualified" | "watch" | "deprioritized" | "rejected" | "archived";

export type CanonicalResearchStatus =
  | "not_started" | "ready" | "refreshing"
  | "previous_success_retry_failed" | "stale" | "blocked";

export type CanonicalContactReadiness =
  | "no_verified_contact" | "contacts_found" | "recipient_selected" | "needs_review";

export type CanonicalOutreachStatus =
  | "not_generated" | "draft_ready"
  | "retry_failed_previous_draft_preserved" | "approved" | "sent" | "follow_up_due";

export type CanonicalEngagementStatus =
  | "not_contacted" | "contacted" | "replied" | "meeting" | "won" | "lost";

export type SelectedRecipientSource =
  | "manual" | "persisted_outreach" | "verified_recommendation" | "none";

export type ProvenanceCompleteness = "complete" | "partial" | "missing";

// --------------------------------------------------------------- output -------

export interface CanonicalDiscoverySource {
  sourceType: string | null;
  discoveryMethod: string | null;
  sourceUrl: string | null;
  providerReference: string | null;
  planId: string | null;
  taskId: string | null;
  observedAt: string | null;
  confidence: string | null;
  provenanceCompleteness: ProvenanceCompleteness;
}

export interface CanonicalSelectedRecipient {
  contactId: string | null;
  fullName: string | null;
  title: string | null;
  linkedinUrl: string | null;
  email: string | null;
  phone: string | null;
  verified: boolean;
}

export interface CanonicalLeadView {
  identity: {
    workspaceId: string;
    accountId: string;
    canonicalLeadId: string | null;
    accountName: string;
    domain: string | null;
    website: string | null;
    linkedinCompanyUrl: string | null;
  };
  leadRows: {
    allLeadCandidateIds: string[];
    selectedLeadCandidateId: string | null;
    /** The plan_id of the REPRESENTATIVE row — always paired with
     *  selectedLeadCandidateId, never an arbitrary planIds[0]. */
    selectedPlanId: string | null;
    planIds: string[];
    duplicatePlanRowCount: number;
  };
  qualification: {
    accountStatus: CanonicalAccountStatus;
    fitScore: number | null;
    verdict: string | null;
    recommendedAction: string | null;
    hardDisqualifiers: string[];
    requiresReview: boolean;
  };
  research: {
    status: CanonicalResearchStatus;
    lastSuccess: Record<string, unknown> | null;
    latestAttempt: Record<string, unknown> | null;
    attemptedAt: string | null;
    succeededAt: string | null;
    failureReason: string | null;
    reasonCode: string | null;
    stale: boolean;
  };
  contacts: {
    verifiedContacts: CanonicalSelectedRecipient[];
    contactReadiness: CanonicalContactReadiness;
    selectedRecipient: CanonicalSelectedRecipient | null;
    selectedRecipientSource: SelectedRecipientSource;
    recipientRecordedAt: string | null;
  };
  outreach: {
    status: CanonicalOutreachStatus;
    currentMessage: string | null;
    currentSuccessfulDraft: OutreachStageView | null;
    latestAttempt: { status: string | null; reasonCode: string | null } | null;
    previousSuccessPreserved: boolean;
    selectedContactId: string | null;
    generatedAt: string | null;
    companyBrainVersion: string | null;
    sent: boolean;
    /** True when an opener exists but recorded no recipient (older draft). */
    recipientUnknownForHistoricalDraft: boolean;
  };
  provenance: {
    discoverySources: CanonicalDiscoverySource[];
    searchRunIds: string[];
    providerReferences: string[];
    evidenceIds: string[];
    sourceCompleteness: ProvenanceCompleteness;
  };
  activity: {
    lastActivityAt: string | null;
    events: CanonicalActivityEvent[];
  };
  warnings: string[];
}

// ------------------------------------------------------------- primitives -----

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
/** Newer-first comparison of ISO timestamps; nulls sort last. */
function cmpDesc(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a < b ? 1 : -1;
}
/** The jsonb of a lead candidate row. Direct DB reads put the jsonb at `.raw`. */
function jsonbOf(lc: CanonicalLeadCandidate): Record<string, unknown> {
  return isObj(lc.raw) ? lc.raw : {};
}
function workbenchOf(jsonb: Record<string, unknown>): Record<string, unknown> {
  return isObj(jsonb.agentory_workbench) ? jsonb.agentory_workbench : {};
}

const SUCCESS = new Set(["succeeded", "needs_manual_review"]);

// ----------------------------------------------- per-row stage extraction -----

interface RowResearch {
  success: Record<string, unknown> | null;
  latestStatus: string | null;
  latestReasonCode: string | null;
  attemptedAt: string | null;
  succeededAt: string | null;
  failureReason: string | null;
}

function rowResearch(jsonb: Record<string, unknown>): RowResearch {
  const wb = workbenchOf(jsonb);
  const stage = isObj(wb.company_research) ? wb.company_research : {};
  const success = isObj(stage.last_success) ? (stage.last_success as Record<string, unknown>) : null;
  // Sourcing-era enrichment blob is the same information via another path.
  const enrich = isObj(jsonb.company_enrichment) ? jsonb.company_enrichment : null;
  const enrichUsable = !!enrich && str(enrich.status) === "enriched";
  return {
    success: success ?? (enrichUsable ? (enrich as Record<string, unknown>) : null),
    latestStatus: str(stage.status),
    latestReasonCode: str(stage.reason_code),
    attemptedAt: str(stage.attempted_at),
    succeededAt: str(stage.succeeded_at),
    failureReason: str(stage.failure_reason),
  };
}

interface RowOutreach {
  success: OutreachStageView | null;
  latestStatus: string | null;
  latestReasonCode: string | null;
  generatedAt: string | null;
}

function rowOutreach(jsonb: Record<string, unknown>): RowOutreach {
  const h = hydrateOutreachStage(jsonb);
  return {
    success: h.last_success,
    latestStatus: h.latest_status,
    latestReasonCode: h.latest_reason_code,
    generatedAt: h.last_success?.generated_at ?? null,
  };
}

// ------------------------------------------------- representative selection ----

/**
 * Deterministically choose the representative lead row for an account.
 * Precedence: latest successful outreach → latest successful research → a
 * persisted selected recipient → highest fit → most recently updated → id.
 */
export function selectRepresentativeLead(rows: CanonicalLeadCandidate[]): CanonicalLeadCandidate | null {
  if (rows.length === 0) return null;
  const scored = rows.map((lc) => {
    const jsonb = jsonbOf(lc);
    const o = rowOutreach(jsonb);
    const r = rowResearch(jsonb);
    return {
      lc,
      outreachAt: o.success?.opener ? (o.generatedAt ?? lc.updated_at ?? "") : null,
      researchAt: r.success ? (r.succeededAt ?? lc.updated_at ?? "") : null,
      hasRecipient: !!o.success?.selected_contact_id,
      fit: num(lc.fit_score) ?? -1,
      updatedAt: str(lc.updated_at) ?? "",
      id: lc.id,
    };
  });
  scored.sort((a, b) => {
    // 1. latest successful outreach
    if (!!a.outreachAt !== !!b.outreachAt) return a.outreachAt ? -1 : 1;
    if (a.outreachAt && b.outreachAt) { const c = cmpDesc(a.outreachAt, b.outreachAt); if (c) return c; }
    // 2. latest successful research
    if (!!a.researchAt !== !!b.researchAt) return a.researchAt ? -1 : 1;
    if (a.researchAt && b.researchAt) { const c = cmpDesc(a.researchAt, b.researchAt); if (c) return c; }
    // 3. persisted selected recipient
    if (a.hasRecipient !== b.hasRecipient) return a.hasRecipient ? -1 : 1;
    // 4. highest fit
    if (a.fit !== b.fit) return b.fit - a.fit;
    // 5. most recently updated
    const c = cmpDesc(a.updatedAt, b.updatedAt); if (c) return c;
    // 6. stable id tiebreak
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return scored[0].lc;
}

// -------------------------------------------------------------- recipient -----

function contactView(c: CanonicalContact): CanonicalSelectedRecipient {
  return {
    contactId: c.id,
    fullName: str(c.full_name),
    title: str(c.title),
    linkedinUrl: str(c.linkedin_url),
    email: str(c.email),
    phone: str(c.phone),
    verified: !!str(c.email) || !!str(c.linkedin_url),
  };
}

// ---------------------------------------------------------------- provenance --

function collectSource(lc: CanonicalLeadCandidate): CanonicalDiscoverySource | null {
  const jsonb = jsonbOf(lc);
  const sourceUrl = str(jsonb.source_url) ?? str(jsonb.input_url) ?? str(jsonb.source_proof) ?? str(jsonb.job_url);
  const providerRef = str(jsonb.provider_job_id) ?? str(jsonb.provider_ref_id) ?? str(jsonb.provider_tracking_id);
  const discoveryMethod = str(jsonb.source) ?? str(jsonb.lead_type) ?? str(jsonb.job_function);
  const sourceType = str(jsonb.source_type) ?? (str(jsonb.job_title) ? "job_posting" : null);
  const observedAt = str(jsonb.posted_at) ?? str(lc.created_at);
  const confidence = str(jsonb.confidence_level) ?? str(jsonb.match_tier);

  if (!sourceUrl && !providerRef && !discoveryMethod && !sourceType) return null;

  // A source that reached here has at least one identifying field, so it is
  // never "missing" — that verdict is reserved for an account with NO source at
  // all (computed at the provenance level below).
  const fields = [sourceUrl, providerRef, discoveryMethod, sourceType, observedAt];
  const present = fields.filter(Boolean).length;
  const completeness: ProvenanceCompleteness = present >= 4 ? "complete" : "partial";

  return {
    sourceType,
    discoveryMethod,
    sourceUrl,
    providerReference: providerRef,
    planId: str(lc.plan_id),
    taskId: str(jsonb.task_id),
    observedAt,
    confidence,
    provenanceCompleteness: completeness,
  };
}

// ---------------------------------------------------------------- derive ------

export function deriveCanonicalLeadView(input: DeriveCanonicalLeadInput): CanonicalLeadView {
  const { account } = input;
  const rows = (input.leadCandidates ?? []).filter((lc) => lc.account_id === account.id);
  const contacts = input.contacts ?? [];
  const drafts = input.outreachDrafts ?? [];
  const warnings: string[] = [];

  const representative = selectRepresentativeLead(rows);

  // ---- research: newest success across ALL rows (success-preserving) --------
  let research: CanonicalLeadView["research"] = {
    status: "not_started", lastSuccess: null, latestAttempt: null,
    attemptedAt: null, succeededAt: null, failureReason: null, reasonCode: null, stale: false,
  };
  {
    const researches = rows.map((lc) => rowResearch(jsonbOf(lc)));
    const successes = researches.filter((r) => r.success);
    successes.sort((a, b) => cmpDesc(a.succeededAt, b.succeededAt));
    const bestSuccess = successes[0] ?? null;
    // Latest attempt = the representative row's latest attempt (or newest overall).
    const attempts = [...researches].sort((a, b) => cmpDesc(a.attemptedAt, b.attemptedAt));
    const latest = attempts[0] ?? null;
    const latestFailed = !!latest && latest.latestStatus !== null
      && !SUCCESS.has(latest.latestStatus) && latest.latestStatus !== "not_started";
    const blocked = !!latest?.latestReasonCode && latest.latestReasonCode.startsWith("blocked_");

    let status: CanonicalResearchStatus;
    if (bestSuccess) status = latestFailed ? "previous_success_retry_failed" : "ready";
    else if (blocked) status = "blocked";
    else if (latestFailed) status = "not_started"; // failed, no previous success → still actionable
    else status = "not_started";

    research = {
      status,
      lastSuccess: bestSuccess?.success ?? null,
      latestAttempt: latest ? { status: latest.latestStatus, reason_code: latest.latestReasonCode } : null,
      attemptedAt: latest?.attemptedAt ?? null,
      succeededAt: bestSuccess?.succeededAt ?? null,
      failureReason: latestFailed ? (latest?.failureReason ?? latest?.latestStatus ?? null) : null,
      reasonCode: latest?.latestReasonCode ?? null,
      stale: false, // no freshness model yet — never invented
    };
  }

  // ---- outreach: newest valid Workbench opener across rows ------------------
  let outreach: CanonicalLeadView["outreach"] = {
    status: "not_generated", currentMessage: null, currentSuccessfulDraft: null,
    latestAttempt: null, previousSuccessPreserved: false, selectedContactId: null,
    generatedAt: null, companyBrainVersion: null, sent: false, recipientUnknownForHistoricalDraft: false,
  };
  {
    const outs = rows.map((lc) => ({ lc, o: rowOutreach(jsonbOf(lc)) }));
    const withOpener = outs.filter((x) => x.o.success?.opener);
    withOpener.sort((a, b) => cmpDesc(a.o.generatedAt ?? a.lc.updated_at ?? null, b.o.generatedAt ?? b.lc.updated_at ?? null));
    const best = withOpener[0] ?? null;
    const repOut = representative ? rowOutreach(jsonbOf(representative)) : null;
    const latest = repOut ?? outs.map((x) => x.o).sort((a, b) => cmpDesc(a.generatedAt, b.generatedAt))[0] ?? null;
    const latestFailed = !!latest && latest.latestStatus !== null
      && !SUCCESS.has(latest.latestStatus) && latest.latestStatus !== "not_started";

    if (best) {
      const s = best.o.success!;
      const sv = s.sent === true;
      // We only ever mark sent when the payload explicitly says so.
      const status: CanonicalOutreachStatus = sv
        ? "sent"
        : s.approval_status === "approved"
          ? "approved"
          : latestFailed
            ? "retry_failed_previous_draft_preserved"
            : "draft_ready";
      const provJsonb = jsonbOf(best.lc);
      const prov = isObj(workbenchOf(provJsonb).outreach)
        ? (workbenchOf(provJsonb).outreach as Record<string, unknown>)
        : {};
      const genProv = isObj((prov.last_success as Record<string, unknown>)?.generation_provenance)
        ? ((prov.last_success as Record<string, unknown>).generation_provenance as Record<string, unknown>)
        : {};
      outreach = {
        status,
        currentMessage: s.opener ?? null,
        currentSuccessfulDraft: s,
        latestAttempt: { status: latest?.latestStatus ?? null, reasonCode: latest?.latestReasonCode ?? null },
        previousSuccessPreserved: latestFailed,
        selectedContactId: s.selected_contact_id ?? null,
        generatedAt: s.generated_at ?? null,
        companyBrainVersion: str(genProv.company_brain_updated_at) ?? str(genProv.seller_identity_hash),
        sent: sv,
        recipientUnknownForHistoricalDraft: !!s.opener && !s.selected_recipient_name && !s.selected_contact_id,
      };
    } else {
      // No Workbench opener. Fall back to a PROVABLY linked legacy draft only.
      const linked = drafts
        .filter((d) => (representative && d.lead_candidate_id === representative.id) ||
                        rows.some((lc) => d.lead_candidate_id === lc.id) ||
                        d.account_id === account.id)
        .sort((a, b) => cmpDesc(str(a.updated_at), str(b.updated_at)))[0] ?? null;
      if (linked?.body) {
        const st = str(linked.status);
        outreach = {
          status: st === "approved" ? "approved" : st === "sent" ? "sent" : "draft_ready",
          currentMessage: linked.body,
          currentSuccessfulDraft: null,
          latestAttempt: null,
          previousSuccessPreserved: false,
          selectedContactId: str(linked.contact_id),
          generatedAt: str(linked.updated_at),
          companyBrainVersion: null,
          sent: st === "sent",
          recipientUnknownForHistoricalDraft: !linked.contact_id,
        };
      } else if (latestFailed) {
        outreach.latestAttempt = { status: latest?.latestStatus ?? null, reasonCode: latest?.latestReasonCode ?? null };
      }
    }
  }

  // ---- recipient precedence: manual → persisted opener → verified rec → none -
  const verifiedContacts = contacts
    .filter((c) => c.account_id === account.id)
    .map(contactView)
    .filter((c) => c.verified);
  const verifiedSorted = [...verifiedContacts].sort((a, b) => (a.contactId ?? "") < (b.contactId ?? "") ? -1 : 1);

  let selectedRecipient: CanonicalSelectedRecipient | null = null;
  let selectedRecipientSource: SelectedRecipientSource = "none";
  let recipientRecordedAt: string | null = null;

  const manual = input.manualRecipientContactId
    ? verifiedContacts.find((c) => c.contactId === input.manualRecipientContactId)
      ?? contacts.filter((c) => c.account_id === account.id).map(contactView)
        .find((c) => c.contactId === input.manualRecipientContactId)
    : null;

  if (manual) {
    selectedRecipient = manual;
    selectedRecipientSource = "manual";
  } else if (outreach.selectedContactId || outreach.currentSuccessfulDraft?.selected_recipient_name) {
    // Recorded on the successful opener — the recipient it was generated for.
    const byId = contacts.filter((c) => c.account_id === account.id).map(contactView)
      .find((c) => c.contactId === outreach.selectedContactId);
    selectedRecipient = byId ?? {
      contactId: outreach.selectedContactId,
      fullName: outreach.currentSuccessfulDraft?.selected_recipient_name ?? null,
      title: outreach.currentSuccessfulDraft?.selected_recipient_title ?? null,
      linkedinUrl: null, email: null, phone: null,
      verified: false,
    };
    selectedRecipientSource = "persisted_outreach";
    recipientRecordedAt = outreach.generatedAt;
  } else if (!outreach.currentMessage && verifiedSorted.length > 0) {
    // No message yet → a deterministic verified recommendation is allowed.
    // Never guess a recipient for an EXISTING message that recorded none.
    selectedRecipient = verifiedSorted[0];
    selectedRecipientSource = "verified_recommendation";
  }

  if (outreach.recipientUnknownForHistoricalDraft) warnings.push("recipient_not_recorded_for_older_draft");

  // ---- contact readiness (independent domain) -------------------------------
  const contactReadiness: CanonicalContactReadiness =
    selectedRecipient && selectedRecipientSource !== "none" && selectedRecipientSource !== "verified_recommendation"
      ? "recipient_selected"
      : verifiedContacts.length > 0
        ? "contacts_found"
        : contacts.some((c) => c.account_id === account.id)
          ? "needs_review"
          : "no_verified_contact";

  // ---- qualification (independent of outreach/research) ---------------------
  const repJsonb = representative ? jsonbOf(representative) : {};
  const accountStatus = mapAccountStatus(str(account.stage) ?? str(representative?.status));
  const qualification: CanonicalLeadView["qualification"] = {
    accountStatus,
    fitScore: num(representative?.fit_score) ?? num(repJsonb.fit_score),
    verdict: str(repJsonb.analyst_verdict) ?? str(repJsonb.overall_fit) ?? null,
    recommendedAction: str(repJsonb.recommended_next_action) ?? str(repJsonb.next_action) ?? null,
    hardDisqualifiers: Array.isArray(repJsonb.disqualifiers_hit)
      ? (repJsonb.disqualifiers_hit as unknown[]).filter((x): x is string => typeof x === "string") : [],
    requiresReview: str(repJsonb.gate_decision) === "manual_review" || accountStatus === "watch",
  };

  // ---- provenance -----------------------------------------------------------
  const discoverySources = rows.map(collectSource).filter((s): s is CanonicalDiscoverySource => !!s);
  if (discoverySources.length === 0 && (str(account.source) || str((account.raw as Record<string, unknown>)?.source_url))) {
    const araw = isObj(account.raw) ? account.raw : {};
    discoverySources.push({
      sourceType: str(araw.source_type),
      discoveryMethod: str(account.source),
      sourceUrl: str(araw.source_url),
      providerReference: null,
      planId: null,
      taskId: null,
      observedAt: str(account.created_at),
      confidence: null,
      provenanceCompleteness: "partial",
    });
  }
  const searchRunIds = [...new Set(rows.map((lc) => str((jsonbOf(lc)).search_run_id)).filter((x): x is string => !!x))];
  const providerReferences = [...new Set(discoverySources.map((s) => s.providerReference).filter((x): x is string => !!x))];
  const planIds = [...new Set(rows.map((lc) => str(lc.plan_id)).filter((x): x is string => !!x))];
  const sourceCompleteness: ProvenanceCompleteness =
    discoverySources.length === 0 ? "missing"
      : discoverySources.every((s) => s.provenanceCompleteness === "complete") ? "complete" : "partial";

  if (rows.length > 1) warnings.push("multiple_plan_leads");
  if (sourceCompleteness === "missing") warnings.push("source_provenance_missing");

  // ---- activity -------------------------------------------------------------
  const events = [...(input.activity ?? [])].sort((a, b) => cmpDesc(a.at, b.at));

  return {
    identity: {
      workspaceId: input.workspaceId,
      accountId: account.id,
      canonicalLeadId: representative?.id ?? null,
      accountName: account.name,
      domain: str(account.domain),
      website: str(account.website_url),
      linkedinCompanyUrl: str(account.linkedin_url),
    },
    leadRows: {
      allLeadCandidateIds: rows.map((lc) => lc.id),
      selectedLeadCandidateId: representative?.id ?? null,
      // The representative row's OWN plan — paired with selectedLeadCandidateId,
      // so a lead action can never send lead A with plan B's id.
      selectedPlanId: str(representative?.plan_id) ?? null,
      planIds,
      duplicatePlanRowCount: rows.length,
    },
    qualification,
    research,
    contacts: {
      verifiedContacts,
      contactReadiness,
      selectedRecipient,
      selectedRecipientSource,
      recipientRecordedAt,
    },
    outreach,
    provenance: { discoverySources, searchRunIds, providerReferences, evidenceIds: [], sourceCompleteness },
    activity: { lastActivityAt: events[0]?.at ?? null, events },
    warnings,
  };
}

/** Map the loose account/lead `stage`/`status` string to a canonical account status. */
export function mapAccountStatus(raw: string | null): CanonicalAccountStatus {
  switch ((raw ?? "").toLowerCase()) {
    case "qualified": return "qualified";
    case "watch": case "watching": case "soft_mismatch": return "watch";
    case "deprioritized": case "deprioritize": return "deprioritized";
    case "rejected": case "disqualified": return "rejected";
    case "archived": return "archived";
    default: return "new";
  }
}

// Map the canonical account-level view (canonicalLeadView.ts) onto the existing
// `LeadRow` shape every Lead Library surface + CSV already consumes. This is the
// single place the canonical truth becomes a table row, so table, Lead Detail,
// bulk actions, filters, metrics and CSV all read the SAME research/recipient/
// outreach/status without re-deriving.
//
// Pure — no React, no network.

import type {
  LeadRow, LeadSource, OpenerPreview, SelectedRecipient,
  AccountStatus, ContactReadiness, OutreachStatus,
} from "./types";
import { fitTierFromScore } from "./types";
import type {
  CanonicalLeadView, CanonicalAccount, CanonicalSelectedRecipient,
  CanonicalDiscoverySource, CanonicalAccountStatus, CanonicalOutreachStatus,
  CanonicalContactReadiness,
} from "./canonicalLeadView";

/** Per-account local augmentation (lists/tags/manual — still client-only). */
export interface RowAug {
  lists: string[];
  tags: string[];
  followUpAt: string | null;
  owner: string | null;
  manualEngagement?: LeadRow["engagementStatus"];
  manualLinkedIn?: LeadRow["linkedinStatus"];
  manualEmail?: LeadRow["emailStatus"];
  manualPhone?: LeadRow["phoneStatus"];
  lastActivity?: LeadRow["lastActivity"];
}

const ACCOUNT_STATUS: Record<CanonicalAccountStatus, AccountStatus> = {
  new: "new",
  qualified: "qualified",
  watch: "soft_mismatch",
  deprioritized: "soft_mismatch",
  rejected: "disqualified",
  archived: "archived",
};

// LeadRow.OutreachStatus has no "sent"/"retry_failed" — map to the nearest
// TRUTHFUL legacy value. `canonical.outreach` remains the authority for detail/CSV.
const OUTREACH_STATUS: Record<CanonicalOutreachStatus, OutreachStatus> = {
  not_generated: "not_generated",
  draft_ready: "draft_ready",
  retry_failed_previous_draft_preserved: "draft_ready", // a valid draft is still ready
  approved: "approved",
  sent: "approved",
  follow_up_due: "approved",
};

const CONTACT_READINESS: Record<CanonicalContactReadiness, ContactReadiness> = {
  no_verified_contact: "no_contact",
  contacts_found: "needs_review",
  recipient_selected: "verified",
  needs_review: "needs_review",
};

function toSelectedRecipient(r: CanonicalSelectedRecipient | null): SelectedRecipient | null {
  if (!r) return null;
  return {
    id: r.contactId ?? "",
    fullName: r.fullName,
    title: r.title,
    linkedinUrl: r.linkedinUrl,
    email: r.email,
    phone: r.phone,
    verified: r.verified,
  };
}

function toSource(s: CanonicalDiscoverySource): LeadSource {
  return {
    discoveryMethod: s.discoveryMethod,
    sourceType: s.sourceType,
    headline: null,
    url: s.sourceUrl,
    author: null,
    publishedAt: null,
    observedAt: s.observedAt,
    freshness: null,
    confidence: (s.confidence as LeadSource["confidence"]) ?? null,
    searchQuery: null,
    searchRunId: null,
  };
}

function toOpener(view: CanonicalLeadView): OpenerPreview | null {
  const o = view.outreach;
  if (!o.currentMessage) return null;
  // Recipient name ONLY when the message actually recorded it — never guessed.
  const recorded = view.contacts.selectedRecipientSource === "persisted_outreach"
    || view.contacts.selectedRecipientSource === "manual";
  return {
    id: view.identity.canonicalLeadId ?? view.identity.accountId,
    fullBody: o.currentMessage,
    bodyPreview: o.currentMessage.slice(0, 180),
    recipientName: recorded ? (view.contacts.selectedRecipient?.fullName ?? null) : null,
    status: OUTREACH_STATUS[o.status],
    generatedAt: o.generatedAt,
    evidenceCount: o.currentSuccessfulDraft?.used_evidence_ids?.length ?? 0,
    personalizationDepth: (o.currentSuccessfulDraft?.personalization_depth as OpenerPreview["personalizationDepth"]) ?? null,
  };
}

export function canonicalToLeadRow(
  view: CanonicalLeadView,
  account: CanonicalAccount,
  aug: RowAug,
): LeadRow {
  const selected = toSelectedRecipient(view.contacts.selectedRecipient);
  const alternates = view.contacts.verifiedContacts
    .filter((c) => c.contactId !== view.contacts.selectedRecipient?.contactId)
    .map((c) => toSelectedRecipient(c)!)
    .filter(Boolean);
  const sources = view.provenance.discoverySources.map(toSource);
  const opener = toOpener(view);

  return {
    id: account.id,
    workspaceId: view.identity.workspaceId,
    name: account.name,
    domain: view.identity.domain,
    websiteUrl: view.identity.website,
    linkedinUrl: view.identity.linkedinCompanyUrl,
    industry: account.industry ?? null,
    employeeCount: account.employee_count ?? null,
    location: account.location ?? null,
    createdAt: account.created_at ?? "",
    updatedAt: account.updated_at ?? "",

    accountStatus: ACCOUNT_STATUS[view.qualification.accountStatus],
    contactReadiness: CONTACT_READINESS[view.contacts.contactReadiness],
    outreachStatus: opener?.status ?? "not_generated",
    engagementStatus: aug.manualEngagement ?? "not_contacted",
    linkedinStatus: aug.manualLinkedIn ?? "not_started",
    emailStatus: aug.manualEmail ?? (selected?.email ? "draft" : "unavailable"),
    phoneStatus: aug.manualPhone ?? "not_attempted",

    fitScore: view.qualification.fitScore,
    fitTier: fitTierFromScore(view.qualification.fitScore),
    whySelected: view.qualification.verdict ?? account.description ?? null,

    sources,
    strongestSource: sources[0] ?? null,
    searchRunIds: view.provenance.searchRunIds,

    selectedRecipient: selected,
    alternateRecipients: alternates,

    opener,

    lastActivity: aug.lastActivity ?? (view.activity.lastActivityAt
      ? { id: `act-${account.id}`, type: view.activity.events[0]?.type ?? "activity", at: view.activity.lastActivityAt, channel: view.activity.events[0]?.channel ?? null, manual: false, owner: view.activity.events[0]?.owner ?? null }
      : null),
    primaryChannel: selected?.email ? "email" : selected?.linkedinUrl ? "linkedin" : null,

    lists: aug.lists,
    tags: aug.tags,
    followUpAt: aug.followUpAt,
    owner: aug.owner,
    possibleDuplicateOf: null,

    canonical: view,
  };
}

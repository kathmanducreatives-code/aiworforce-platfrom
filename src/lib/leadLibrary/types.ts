// Canonical Lead Library shapes and helpers. Single source of truth for
// table rows, drawer, bulk actions, and CSV export.

export type AccountStatus =
  | "new"
  | "researching"
  | "qualified"
  | "soft_mismatch"
  | "disqualified"
  | "archived";

export type ContactReadiness =
  | "no_contact"
  | "finding"
  | "verified"
  | "needs_review";

export type OutreachStatus =
  | "not_generated"
  | "generating"
  | "draft_ready"
  | "edited"
  | "approved"
  | "skipped"
  | "failed";

export type EngagementStatus =
  | "not_contacted"
  | "contacted"
  | "replied"
  | "meeting"
  | "opportunity"
  | "won"
  | "lost";

export type LinkedInStatus =
  | "not_started"
  | "viewed"
  | "requested"
  | "connected"
  | "messaged"
  | "replied"
  | "not_interested";

export type EmailStatus =
  | "unavailable"
  | "draft"
  | "sent"
  | "delivered"
  | "opened"
  | "replied"
  | "bounced"
  | "unsubscribed";

export type PhoneStatus =
  | "not_attempted"
  | "attempted"
  | "no_answer"
  | "connected"
  | "callback";

export type FitTier = "strong" | "good" | "soft" | "poor" | "unknown";

export interface LeadSource {
  discoveryMethod: string | null;   // e.g. "Jobs Scraper"
  sourceType: string | null;        // e.g. "Job posting"
  headline: string | null;          // signal-first: "Hiring Director of RevOps"
  url: string | null;
  author: string | null;
  publishedAt: string | null;
  observedAt: string | null;
  freshness: "fresh" | "recent" | "aging" | "old" | null;
  confidence: "verified" | "likely" | "unverified" | null;
  searchQuery: string | null;
  searchRunId: string | null;
}

export interface SelectedRecipient {
  id: string;
  fullName: string | null;
  title: string | null;
  linkedinUrl: string | null;
  email: string | null;
  phone: string | null;
  verified: boolean;
}

export interface OpenerPreview {
  id: string;
  bodyPreview: string;
  fullBody: string;
  recipientName: string | null;
  status: OutreachStatus;
  generatedAt: string | null;
  evidenceCount: number;
  personalizationDepth: "generic" | "specific" | "deep" | null;
}

export interface LeadRow {
  id: string;
  workspaceId: string;
  name: string;
  domain: string | null;
  websiteUrl: string | null;
  linkedinUrl: string | null;
  industry: string | null;
  employeeCount: string | null;
  location: string | null;
  createdAt: string;
  updatedAt: string;

  // status groups (kept separate on purpose)
  accountStatus: AccountStatus;
  contactReadiness: ContactReadiness;
  outreachStatus: OutreachStatus;
  engagementStatus: EngagementStatus;
  linkedinStatus: LinkedInStatus;
  emailStatus: EmailStatus;
  phoneStatus: PhoneStatus;

  fitScore: number | null;
  fitTier: FitTier;
  whySelected: string | null;

  sources: LeadSource[];             // preserved history, never overwritten
  strongestSource: LeadSource | null;
  searchRunIds: string[];

  selectedRecipient: SelectedRecipient | null;
  alternateRecipients: SelectedRecipient[];

  opener: OpenerPreview | null;

  lastActivity: {
    id: string;
    type: string;
    at: string;
    channel: string | null;
    manual: boolean;
    owner: string | null;
  } | null;

  primaryChannel: "linkedin" | "email" | "phone" | "multi" | null;

  // Client-only fields (localStorage-backed until dedicated tables exist)
  lists: string[];
  tags: string[];
  followUpAt: string | null;
  owner: string | null;

  possibleDuplicateOf: string | null;

  /**
   * The canonical account-level read model this row was derived from. Present
   * once the row is built through the canonical adapter — Lead Detail and CSV
   * read truth from here (research/outreach/recipient/provenance) instead of
   * re-deriving. Optional so any legacy construction path still type-checks.
   */
  canonical?: import("./canonicalLeadView").CanonicalLeadView;
}

// ---------- labels ----------

export const ACCOUNT_STATUS_LABEL: Record<AccountStatus, string> = {
  new: "New",
  researching: "Researching",
  qualified: "Qualified",
  soft_mismatch: "Soft mismatch",
  disqualified: "Disqualified",
  archived: "Archived",
};

export const CONTACT_READINESS_LABEL: Record<ContactReadiness, string> = {
  no_contact: "No contact",
  finding: "Finding contacts",
  verified: "Verified buyer",
  needs_review: "Needs review",
};

export const OUTREACH_STATUS_LABEL: Record<OutreachStatus, string> = {
  not_generated: "Not generated",
  generating: "Generating",
  draft_ready: "Draft ready",
  edited: "Edited",
  approved: "Approved",
  skipped: "Skipped",
  failed: "Generation failed",
};

export const ENGAGEMENT_STATUS_LABEL: Record<EngagementStatus, string> = {
  not_contacted: "Not contacted",
  contacted: "Contacted",
  replied: "Replied",
  meeting: "Meeting booked",
  opportunity: "Opportunity",
  won: "Won",
  lost: "Lost",
};

export const LINKEDIN_STATUS_LABEL: Record<LinkedInStatus, string> = {
  not_started: "Not started",
  viewed: "Profile viewed",
  requested: "Connection requested",
  connected: "Connected",
  messaged: "Message sent",
  replied: "Replied",
  not_interested: "Not interested",
};

export const EMAIL_STATUS_LABEL: Record<EmailStatus, string> = {
  unavailable: "Email unavailable",
  draft: "Draft created",
  sent: "Sent",
  delivered: "Delivered",
  opened: "Opened",
  replied: "Replied",
  bounced: "Bounced",
  unsubscribed: "Unsubscribed",
};

export const PHONE_STATUS_LABEL: Record<PhoneStatus, string> = {
  not_attempted: "Not attempted",
  attempted: "Attempted",
  no_answer: "No answer",
  connected: "Connected",
  callback: "Callback requested",
};

// Statuses that must NOT be settable manually — require an integration event.
export const INTEGRATION_ONLY_LINKEDIN: LinkedInStatus[] = ["connected", "replied"];
export const INTEGRATION_ONLY_EMAIL: EmailStatus[] = [
  "delivered",
  "opened",
  "replied",
  "bounced",
  "unsubscribed",
];

// ---------- helpers ----------

export function fitTierFromScore(score: number | null): FitTier {
  if (score == null) return "unknown";
  if (score >= 80) return "strong";
  if (score >= 60) return "good";
  if (score >= 40) return "soft";
  return "poor";
}

export function fitTierLabel(tier: FitTier): string {
  return {
    strong: "Strong fit",
    good: "Good fit",
    soft: "Soft fit",
    poor: "Poor fit",
    unknown: "Unknown",
  }[tier];
}

export function nextStepFor(row: LeadRow): string {
  if (row.accountStatus === "archived") return "Archive";
  if (!row.strongestSource) return "Research company";
  if (row.contactReadiness !== "verified") return "Find verified buyer";
  if (!row.opener || row.opener.status === "not_generated") return "Generate opener";
  if (row.opener.status === "draft_ready" || row.opener.status === "edited")
    return "Review opener";
  if (row.opener.status === "approved" && row.engagementStatus === "not_contacted") {
    if (row.primaryChannel === "linkedin") return "Contact on LinkedIn";
    return "Send approved email draft";
  }
  if (row.engagementStatus === "contacted") return "Follow up";
  return "Follow up";
}

export function readinessSummary(row: LeadRow): {
  research: "ready" | "missing" | "waiting";
  buyer: "verified" | "missing" | "review";
  opener: "ready" | "waiting" | "missing";
} {
  return {
    research: row.strongestSource ? "ready" : "missing",
    buyer:
      row.contactReadiness === "verified"
        ? "verified"
        : row.contactReadiness === "needs_review"
          ? "review"
          : "missing",
    opener:
      row.opener?.status === "draft_ready" ||
      row.opener?.status === "approved" ||
      row.opener?.status === "edited"
        ? "ready"
        : row.opener?.status === "generating"
          ? "waiting"
          : "missing",
  };
}

// ---------- CSV ----------

const CSV_FIELDS: [string, (r: LeadRow) => string | number | null][] = [
  ["company", (r) => r.name],
  ["website", (r) => r.websiteUrl],
  ["linkedin", (r) => r.linkedinUrl],
  ["industry", (r) => r.industry],
  ["employee_count", (r) => r.employeeCount],
  ["qualification_status", (r) => ACCOUNT_STATUS_LABEL[r.accountStatus]],
  ["fit_score", (r) => r.fitScore],
  ["why_selected", (r) => r.whySelected],
  ["recipient_name", (r) => r.selectedRecipient?.fullName ?? null],
  ["recipient_title", (r) => r.selectedRecipient?.title ?? null],
  ["recipient_linkedin", (r) => r.selectedRecipient?.linkedinUrl ?? null],
  ["recipient_email", (r) => (r.selectedRecipient?.verified ? r.selectedRecipient?.email ?? "" : "")],
  ["opener", (r) => r.opener?.fullBody ?? null],
  ["opener_status", (r) => (r.opener ? OUTREACH_STATUS_LABEL[r.opener.status] : "")],
  ["engagement_status", (r) => ENGAGEMENT_STATUS_LABEL[r.engagementStatus]],
  ["linkedin_status", (r) => LINKEDIN_STATUS_LABEL[r.linkedinStatus]],
  ["email_status", (r) => EMAIL_STATUS_LABEL[r.emailStatus]],
  ["phone_status", (r) => PHONE_STATUS_LABEL[r.phoneStatus]],
  ["next_action", (r) => nextStepFor(r)],
  ["follow_up_date", (r) => r.followUpAt],
  ["owner", (r) => r.owner],
  ["lists", (r) => r.lists.join("|")],
  ["tags", (r) => r.tags.join("|")],
  ["first_discovery_date", (r) => r.createdAt],
  ["discovery_method", (r) => r.strongestSource?.discoveryMethod ?? null],
  ["source_type", (r) => r.strongestSource?.sourceType ?? null],
  ["primary_signal", (r) => r.strongestSource?.headline ?? null],
  ["source_url", (r) => r.strongestSource?.url ?? null],
  ["source_freshness", (r) => r.strongestSource?.freshness ?? null],
  ["original_search_query", (r) => r.strongestSource?.searchQuery ?? null],
  ["search_run_count", (r) => r.searchRunIds.length],
  ["source_count", (r) => r.sources.length],
  ["last_activity", (r) => r.lastActivity?.type ?? null],
];

function csvEscape(v: string | number | null | undefined): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function leadsToCsv(rows: LeadRow[]): string {
  const header = CSV_FIELDS.map(([k]) => k).join(",");
  const body = rows
    .map((r) => CSV_FIELDS.map(([, get]) => csvEscape(get(r))).join(","))
    .join("\n");
  return `${header}\n${body}\n`;
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------- dedupe ----------

export function normalizeDomain(d: string | null | undefined): string | null {
  if (!d) return null;
  return d
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .trim() || null;
}

export function findDuplicates(rows: LeadRow[]): Map<string, string> {
  // returns rowId -> canonical id of another lead that looks like a duplicate
  const byKey = new Map<string, string>();
  const dup = new Map<string, string>();
  for (const r of rows) {
    const keys = [normalizeDomain(r.domain), normalizeDomain(r.websiteUrl), r.linkedinUrl?.toLowerCase() ?? null].filter(
      (k): k is string => !!k,
    );
    for (const k of keys) {
      const existing = byKey.get(k);
      if (existing && existing !== r.id) {
        dup.set(r.id, existing);
      } else {
        byKey.set(k, r.id);
      }
    }
  }
  return dup;
}

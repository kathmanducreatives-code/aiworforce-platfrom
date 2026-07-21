// Cross-surface integration: the Lead Library canonical path and the Workbench
// Lead-Detail path (deriveLeadDetailState) must agree on the SAME stage JSONB,
// and the canonical account view must correctly aggregate the required
// four-plan-row fixture. Synthetic fixtures only; no network/db/provider/model.

import { describe, it, expect } from "vitest";
import { deriveCanonicalLeadView, type CanonicalLeadCandidate, type CanonicalAccount } from "./canonicalLeadView";
import { canonicalToLeadRow } from "./canonicalLeadRow";
import { deriveLeadDetailState } from "@/lib/leadDetailState";

const WS = "ws-1";
const ACC = "acc-1";
const account: CanonicalAccount = { id: ACC, workspace_id: WS, name: "BigID", domain: "bigid.com", website_url: "https://bigid.com", created_at: "2026-07-20T00:00:00Z", updated_at: "2026-07-20T00:00:00Z" };

// A jsonb with a preserved research success under a failed latest retry + a
// persisted opener recorded for a specific recipient.
const JSONB = {
  agentory_workbench: {
    company_research: {
      status: "failed", reason_code: "provider_failed",
      attempted_at: "2026-07-20T13:00:00Z", succeeded_at: "2026-07-20T09:00:00Z",
      failure_reason: "provider_failed",
      last_success: { summary: "BigID researched", evidence_urls: ["https://bigid.com/about"], usable: true },
    },
    outreach: {
      status: "succeeded", reason_code: null,
      last_success: { status: "succeeded", opener: "Hi Kenneth — noticed your RevOps hire.", generated_at: "2026-07-20T14:00:00Z", sent: false, selected_contact_id: "c-ken", selected_recipient_name: "Kenneth", selected_recipient_title: "CRO" },
    },
  },
};

function lead(id: string, raw: unknown, over: Partial<CanonicalLeadCandidate> = {}): CanonicalLeadCandidate {
  return { id, workspace_id: WS, account_id: ACC, plan_id: `plan-${id}`, updated_at: "2026-07-20T14:00:00Z", raw, ...over };
}

describe("cross-surface equivalence on the same JSONB", () => {
  // The Workbench detail reads `row.raw.raw` (DB row wrapper); the canonical
  // adapter reads lead_candidates.raw directly. Feed both the SAME jsonb.
  const workbench = deriveLeadDetailState({ raw: { raw: JSONB } });
  const view = deriveCanonicalLeadView({ workspaceId: WS, account, leadCandidates: [lead("l1", JSONB)] });

  it("research: both preserve the previous success under a failed retry (never Locked/Not started)", () => {
    expect(workbench.research).toBe("previous_result_latest_failed");
    expect(workbench.researchLocked).toBe(false);
    expect(view.research.status).toBe("previous_success_retry_failed");
    expect(view.research.lastSuccess).not.toBeNull();
  });

  it("outreach: both surface the same persisted opener message", () => {
    expect(workbench.opener?.opener).toBe("Hi Kenneth — noticed your RevOps hire.");
    expect(view.outreach.currentMessage).toBe("Hi Kenneth — noticed your RevOps hire.");
    expect(view.outreach.sent).toBe(false);
    expect(workbench.opener?.sent).toBe(false);
  });

  it("recipient: both read the recipient recorded WITH the message (no guessing)", () => {
    expect(workbench.selectedRecipientName).toBe("Kenneth");
    expect(view.contacts.selectedRecipient?.fullName).toBe("Kenneth");
    expect(view.contacts.selectedRecipientSource).toBe("persisted_outreach");
  });
});

describe("required cross-surface fixture (four plan-scoped rows)", () => {
  // Row layout per the review spec:
  //  l1: successful research (non-representative)
  //  l2: latest research retry FAILED, no success of its own
  //  l3: persisted opener + recorded recipient (this becomes representative)
  //  l4: empty
  const l1 = lead("l1", { agentory_workbench: { company_research: { status: "succeeded", succeeded_at: "2026-07-20T09:00:00Z", attempted_at: "2026-07-20T09:00:00Z", last_success: { summary: "researched", usable: true } } } }, { updated_at: "2026-07-20T09:00:00Z" });
  const l2 = lead("l2", { agentory_workbench: { company_research: { status: "failed", reason_code: "provider_failed", attempted_at: "2026-07-20T13:00:00Z", last_success: null } } }, { updated_at: "2026-07-20T13:00:00Z" });
  const l3 = lead("l3", { agentory_workbench: { outreach: { status: "succeeded", last_success: { status: "succeeded", opener: "Hi Kenneth", generated_at: "2026-07-20T14:00:00Z", sent: false, selected_contact_id: "c-ken", selected_recipient_name: "Kenneth" } } } }, { updated_at: "2026-07-20T14:00:00Z" });
  const l4 = lead("l4", {});

  const contacts = [
    { id: "c-ken", workspace_id: WS, account_id: ACC, full_name: "Kenneth", email: "ken@bigid.com" },
    { id: "c-foreign", workspace_id: WS, account_id: "other-acc", full_name: "Amy", email: "amy@x.com" },
  ];
  const drafts = [
    { id: "d-linked", workspace_id: WS, account_id: ACC, lead_candidate_id: "l4", status: "draft_ready", body: "Linked legacy draft", updated_at: "2026-07-18T00:00:00Z" },
    { id: "d-orphan", workspace_id: WS, account_id: null, lead_candidate_id: null, status: "draft_ready", body: "Orphan draft", updated_at: "2026-07-19T00:00:00Z" },
  ];

  const view = deriveCanonicalLeadView({ workspaceId: WS, account, leadCandidates: [l1, l2, l3, l4], contacts: contacts as never, outreachDrafts: drafts as never });
  const row = canonicalToLeadRow(view, account, { lists: [], tags: [], followUpAt: null, owner: null });

  it("account grouping: one entry, four discovery records retained, no rows deleted", () => {
    expect(view.leadRows.duplicatePlanRowCount).toBe(4);
    expect(view.leadRows.allLeadCandidateIds.sort()).toEqual(["l1", "l2", "l3", "l4"]);
    expect(view.leadRows.planIds.length).toBe(4);
    expect(view.warnings).toContain("multiple_plan_leads");
  });

  it("research: previous success preserved from the non-representative row, retry failure visible", () => {
    expect(view.research.status).toBe("previous_success_retry_failed");
    expect(view.research.lastSuccess).not.toBeNull();
    expect(view.research.failureReason).toBeTruthy();
  });

  it("recipient: recorded recipient wins; unrelated contact excluded; no guessing", () => {
    expect(view.contacts.selectedRecipient?.fullName).toBe("Kenneth");
    expect(view.contacts.verifiedContacts.map((c) => c.fullName)).not.toContain("Amy");
  });

  it("outreach: Workbench opener wins over legacy drafts; sent=false", () => {
    expect(view.outreach.currentMessage).toBe("Hi Kenneth");
    expect(view.outreach.sent).toBe(false);
    expect(row.opener?.fullBody).toBe("Hi Kenneth");
    expect(row.opener?.status).toBe("draft_ready");
  });

  it("orphan legacy draft is ignored (never name-guessed)", () => {
    // The account-less/lead-less orphan must not become the message.
    expect(view.outreach.currentMessage).not.toBe("Orphan draft");
  });

  it("CSV/row parity: the LeadRow the CSV serializes shows the SAME message, not Not generated", () => {
    expect(row.opener).not.toBeNull();
    expect(row.outreachStatus).toBe("draft_ready");
  });
});

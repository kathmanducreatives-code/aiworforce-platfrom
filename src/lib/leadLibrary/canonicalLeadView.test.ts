// Canonical account-level lead read model — shared by Workbench, Lead Library,
// Lead Detail and CSV. Synthetic fixtures only; no network/db/provider/model.

import { describe, it, expect } from "vitest";
import {
  deriveCanonicalLeadView,
  selectRepresentativeLead,
  type CanonicalAccount,
  type CanonicalLeadCandidate,
  type CanonicalContact,
  type CanonicalOutreachDraft,
} from "./canonicalLeadView";

const WS = "ws-1";
const ACC = "acc-1";

function account(over: Partial<CanonicalAccount> = {}): CanonicalAccount {
  return { id: ACC, workspace_id: WS, name: "BigID", domain: "bigid.com", website_url: "https://bigid.com", created_at: "2026-07-20T00:00:00Z", ...over };
}

function lead(id: string, raw: Record<string, unknown>, over: Partial<CanonicalLeadCandidate> = {}): CanonicalLeadCandidate {
  return { id, workspace_id: WS, account_id: ACC, plan_id: `plan-${id}`, updated_at: "2026-07-20T10:00:00Z", raw, ...over };
}

function research(status: string, success?: Record<string, unknown>, at = "2026-07-20T09:00:00Z") {
  return { agentory_workbench: { company_research: { status, attempted_at: at, succeeded_at: success ? at : null, last_success: success ?? null, reason_code: null } } };
}
function opener(payload: Record<string, unknown>, latestStatus = "succeeded") {
  return { agentory_workbench: { outreach: { status: latestStatus, reason_code: null, last_success: payload } } };
}

function base(input: Partial<Parameters<typeof deriveCanonicalLeadView>[0]>) {
  return deriveCanonicalLeadView({ workspaceId: WS, account: account(), leadCandidates: [], ...input });
}

// ---- ACCOUNT GROUPING ---------------------------------------------------------
describe("account grouping", () => {
  it("1. one account with one lead row → one canonical view", () => {
    const v = base({ leadCandidates: [lead("l1", {})] });
    expect(v.leadRows.duplicatePlanRowCount).toBe(1);
    expect(v.leadRows.selectedLeadCandidateId).toBe("l1");
    expect(v.warnings).not.toContain("multiple_plan_leads");
  });

  it("2/3. four plan rows → one view, all ids + plans retained, multiple_plan_leads warning", () => {
    const leads = ["l1", "l2", "l3", "l4"].map((id) => lead(id, {}));
    const v = base({ leadCandidates: leads });
    expect(v.leadRows.allLeadCandidateIds.sort()).toEqual(["l1", "l2", "l3", "l4"]);
    expect(v.leadRows.planIds.length).toBe(4);
    expect(v.leadRows.duplicatePlanRowCount).toBe(4);
    expect(v.warnings).toContain("multiple_plan_leads");
  });

  it("4. representative selection is deterministic (latest successful outreach wins)", () => {
    const l1 = lead("l1", opener({ status: "succeeded", opener: "Hi", generated_at: "2026-07-20T11:00:00Z", sent: false }), { updated_at: "2026-07-20T11:00:00Z" });
    const l2 = lead("l2", opener({ status: "succeeded", opener: "Hey", generated_at: "2026-07-20T12:00:00Z", sent: false }), { updated_at: "2026-07-20T12:00:00Z" });
    expect(selectRepresentativeLead([l1, l2])?.id).toBe("l2");
    expect(selectRepresentativeLead([l2, l1])?.id).toBe("l2"); // order-independent
  });

  it("5. account from another workspace/account is excluded", () => {
    const foreign = lead("lx", opener({ status: "succeeded", opener: "X", sent: false }), { account_id: "other-acc" });
    const v = base({ leadCandidates: [lead("l1", {}), foreign] });
    expect(v.leadRows.allLeadCandidateIds).toEqual(["l1"]);
    expect(v.outreach.currentMessage).toBeNull();
  });
});

// ---- RESEARCH -----------------------------------------------------------------
describe("research", () => {
  it("6/8. latest successful research wins, even on a non-representative row", () => {
    const l1 = lead("l1", research("succeeded", { summary: "old", usable: true }, "2026-07-20T08:00:00Z"));
    const l2 = lead("l2", research("succeeded", { summary: "new", usable: true }, "2026-07-20T10:00:00Z"));
    const v = base({ leadCandidates: [l1, l2] });
    expect(v.research.status).toBe("ready");
    expect((v.research.lastSuccess as { summary: string }).summary).toBe("new");
  });

  it("7. failed retry preserves previous success", () => {
    const l1 = lead("l1", { agentory_workbench: { company_research: { status: "failed", attempted_at: "2026-07-20T12:00:00Z", succeeded_at: "2026-07-20T08:00:00Z", last_success: { summary: "kept", usable: true }, reason_code: "provider_failed" } } });
    const v = base({ leadCandidates: [l1] });
    expect(v.research.status).toBe("previous_success_retry_failed");
    expect(v.research.lastSuccess).not.toBeNull();
    expect(v.research.failureReason).toBeTruthy();
  });

  it("9. no success → not_started", () => {
    const v = base({ leadCandidates: [lead("l1", {})] });
    expect(v.research.status).toBe("not_started");
    expect(v.research.lastSuccess).toBeNull();
  });

  it("10. blocked attempt is surfaced", () => {
    const l1 = lead("l1", { agentory_workbench: { company_research: { status: "failed", reason_code: "blocked_missing_evidence", attempted_at: "2026-07-20T12:00:00Z", last_success: null } } });
    const v = base({ leadCandidates: [l1] });
    expect(v.research.status).toBe("blocked");
    expect(v.research.reasonCode).toBe("blocked_missing_evidence");
  });
});

// ---- CONTACT / RECIPIENT ------------------------------------------------------
describe("recipient precedence", () => {
  const withOpener = (recipient: Record<string, unknown>) => lead("l1", opener({ status: "succeeded", opener: "Hi", generated_at: "2026-07-20T11:00:00Z", sent: false, ...recipient }));
  const contact = (id: string, over: Partial<CanonicalContact> = {}): CanonicalContact =>
    ({ id, workspace_id: WS, account_id: ACC, full_name: `C ${id}`, email: `${id}@x.com`, ...over });

  it("11. manual recipient wins", () => {
    const v = base({ leadCandidates: [withOpener({ selected_contact_id: "c-persisted", selected_recipient_name: "Persisted" })], contacts: [contact("c-manual"), contact("c-persisted")], manualRecipientContactId: "c-manual" });
    expect(v.contacts.selectedRecipientSource).toBe("manual");
    expect(v.contacts.selectedRecipient?.contactId).toBe("c-manual");
  });

  it("12. persisted message recipient wins over recommendation", () => {
    const v = base({ leadCandidates: [withOpener({ selected_contact_id: "c-1", selected_recipient_name: "Kenneth" })], contacts: [contact("c-1", { full_name: "Kenneth" }), contact("c-2", { full_name: "Amy" })] });
    expect(v.contacts.selectedRecipientSource).toBe("persisted_outreach");
    expect(v.contacts.selectedRecipient?.fullName).toBe("Kenneth");
  });

  it("13. deterministic verified recommendation is fallback when no message", () => {
    const v = base({ leadCandidates: [lead("l1", {})], contacts: [contact("c-2"), contact("c-1")] });
    expect(v.contacts.selectedRecipientSource).toBe("verified_recommendation");
    expect(v.contacts.selectedRecipient?.contactId).toBe("c-1"); // stable id sort
  });

  it("14. historical message without recipient does NOT guess", () => {
    const v = base({ leadCandidates: [withOpener({})], contacts: [contact("c-1"), contact("c-2")] });
    expect(v.contacts.selectedRecipient).toBeNull();
    expect(v.contacts.selectedRecipientSource).toBe("none");
    expect(v.outreach.recipientUnknownForHistoricalDraft).toBe(true);
    expect(v.warnings).toContain("recipient_not_recorded_for_older_draft");
  });

  it("15. contacts from another account are excluded", () => {
    const v = base({ leadCandidates: [lead("l1", {})], contacts: [contact("c-x", { account_id: "other" })] });
    expect(v.contacts.verifiedContacts.length).toBe(0);
    expect(v.contacts.contactReadiness).toBe("no_verified_contact");
  });
});

// ---- OUTREACH -----------------------------------------------------------------
describe("outreach precedence", () => {
  const draft = (over: Partial<CanonicalOutreachDraft> = {}): CanonicalOutreachDraft =>
    ({ id: "d1", workspace_id: WS, account_id: ACC, lead_candidate_id: "l1", status: "draft_ready", body: "Legacy draft body", updated_at: "2026-07-19T00:00:00Z", ...over });

  it("16. Workbench opener wins over legacy draft", () => {
    const v = base({ leadCandidates: [lead("l1", opener({ status: "succeeded", opener: "WB opener", generated_at: "2026-07-20T11:00:00Z", sent: false }))], outreachDrafts: [draft()] });
    expect(v.outreach.currentMessage).toBe("WB opener");
    expect(v.outreach.status).toBe("draft_ready");
  });

  it("17. retry failure preserves previous Workbench opener", () => {
    const raw = { agentory_workbench: { outreach: { status: "blocked_seller_identity_conflict", reason_code: "blocked_seller_identity_conflict", last_success: { status: "succeeded", opener: "Kept opener", generated_at: "2026-07-20T11:00:00Z", sent: false } } } };
    const v = base({ leadCandidates: [lead("l1", raw)] });
    expect(v.outreach.currentMessage).toBe("Kept opener");
    expect(v.outreach.status).toBe("retry_failed_previous_draft_preserved");
    expect(v.outreach.previousSuccessPreserved).toBe(true);
  });

  it("18. linked legacy draft is fallback when no Workbench opener", () => {
    const v = base({ leadCandidates: [lead("l1", {})], outreachDrafts: [draft()] });
    expect(v.outreach.currentMessage).toBe("Legacy draft body");
  });

  it("19. orphan draft is NOT attached by name guessing", () => {
    const v = base({ leadCandidates: [lead("l1", {})], outreachDrafts: [draft({ lead_candidate_id: null, account_id: null })] });
    expect(v.outreach.currentMessage).toBeNull();
    expect(v.outreach.status).toBe("not_generated");
  });

  it("20. sent stays false unless explicitly persisted", () => {
    const v = base({ leadCandidates: [lead("l1", opener({ status: "succeeded", opener: "Hi", sent: false }))] });
    expect(v.outreach.sent).toBe(false);
    const v2 = base({ leadCandidates: [lead("l1", opener({ status: "succeeded", opener: "Hi", sent: true }))] });
    expect(v2.outreach.sent).toBe(true);
    expect(v2.outreach.status).toBe("sent");
  });
});

// ---- STATUS INDEPENDENCE ------------------------------------------------------
describe("status domains stay independent", () => {
  it("22/23. research ready does not imply qualified/outreach", () => {
    const v = base({ leadCandidates: [lead("l1", research("succeeded", { summary: "x", usable: true }))] });
    expect(v.research.status).toBe("ready");
    expect(v.qualification.accountStatus).toBe("new");
    expect(v.outreach.status).toBe("not_generated");
  });

  it("24. draft ready does not imply sent", () => {
    const v = base({ leadCandidates: [lead("l1", opener({ status: "succeeded", opener: "Hi", sent: false }))] });
    expect(v.outreach.status).toBe("draft_ready");
    expect(v.outreach.sent).toBe(false);
  });

  it("25. engagement never claimed without evidence (no engagement derived here)", () => {
    const v = base({ leadCandidates: [lead("l1", {})] });
    // The canonical view does not fabricate engagement; account status default is new.
    expect(v.qualification.accountStatus).toBe("new");
  });
});

// ---- PROVENANCE ---------------------------------------------------------------
describe("provenance compatibility", () => {
  it("26/29. multiple sources aggregate; search-run ids retained", () => {
    const l1 = lead("l1", { source_url: "https://a.com/job", provider_job_id: "j1", source: "Jobs Scraper", source_type: "job_posting", posted_at: "2026-07-19T00:00:00Z", search_run_id: "run-1" });
    const l2 = lead("l2", { input_url: "https://b.com", source: "People Search", search_run_id: "run-2" });
    const v = base({ leadCandidates: [l1, l2] });
    expect(v.provenance.discoverySources.length).toBe(2);
    expect(v.provenance.searchRunIds.sort()).toEqual(["run-1", "run-2"]);
    expect(v.provenance.providerReferences).toContain("j1");
  });

  it("27. incomplete source marked partial", () => {
    const v = base({ leadCandidates: [lead("l1", { source: "Jobs Scraper" })] });
    expect(v.provenance.discoverySources[0].provenanceCompleteness).toBe("partial");
  });

  it("28/30. no source → missing; no fake metadata", () => {
    const v = base({ leadCandidates: [lead("l1", {})] });
    expect(v.provenance.sourceCompleteness).toBe("missing");
    expect(v.warnings).toContain("source_provenance_missing");
  });
});

// ---- MULTI-TENANT -------------------------------------------------------------
describe("multi-tenant", () => {
  it("34. same public company can exist independently in two workspaces", () => {
    const a = deriveCanonicalLeadView({ workspaceId: "ws-A", account: account({ id: "accA", workspace_id: "ws-A" }), leadCandidates: [lead("lA", {}, { account_id: "accA", workspace_id: "ws-A" })] });
    const b = deriveCanonicalLeadView({ workspaceId: "ws-B", account: account({ id: "accB", workspace_id: "ws-B" }), leadCandidates: [lead("lB", {}, { account_id: "accB", workspace_id: "ws-B" })] });
    expect(a.identity.workspaceId).toBe("ws-A");
    expect(b.identity.workspaceId).toBe("ws-B");
    expect(a.identity.accountId).not.toBe(b.identity.accountId);
  });
});

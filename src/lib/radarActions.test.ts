import { describe, it, expect } from "vitest";
import { allowedRadarActions, canShowDraftOutreach, type SignalActionState } from "./radarActions";

const base: SignalActionState = { decision: "contact", can_draft_outreach: true, has_company: true, has_evidence: true, has_decision_maker: true, is_person_only: false };

describe("radar action gating", () => {
  it("contact + gate true + all present → Draft outreach shown", () => {
    expect(canShowDraftOutreach(base)).toBe(true);
    expect(allowedRadarActions(base)).toContain("open_evidence");
  });

  it("Draft outreach is hidden when the backend gate is false", () => {
    expect(canShowDraftOutreach({ ...base, can_draft_outreach: false })).toBe(false);
  });

  it("needs_review never shows Draft outreach; offers verify/resolve", () => {
    const acts = allowedRadarActions({ ...base, decision: "needs_review" });
    expect(acts).not.toContain("draft_outreach");
    expect(acts).toEqual(["verify_source", "resolve_company", "find_decision_maker", "skip"]);
  });

  it("skip offers open evidence + restore only", () => {
    expect(allowedRadarActions({ ...base, decision: "skip" })).toEqual(["open_evidence", "restore_for_review"]);
  });

  it("Draft outreach hidden when company/evidence/decision-maker missing or person-only", () => {
    expect(canShowDraftOutreach({ ...base, has_company: false })).toBe(false);
    expect(canShowDraftOutreach({ ...base, has_evidence: false })).toBe(false);
    expect(canShowDraftOutreach({ ...base, has_decision_maker: false })).toBe(false);
    expect(canShowDraftOutreach({ ...base, is_person_only: true })).toBe(false);
    // contact without a decision maker → offers Find decision maker instead.
    expect(allowedRadarActions({ ...base, has_decision_maker: false })).toContain("find_decision_maker");
  });

  it("watch offers watch/find decision maker, never outreach", () => {
    const acts = allowedRadarActions({ ...base, decision: "watch" });
    expect(acts).not.toContain("draft_outreach");
    expect(acts).toContain("watch_company");
  });
});

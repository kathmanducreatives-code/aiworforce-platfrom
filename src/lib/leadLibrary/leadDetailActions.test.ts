// The Lead Library detail actions must build the correct production payload from
// the CANONICAL actionable lead id, guard session/workspace/tenancy, and map
// results to distinguished messages — never guessing the lead id from the
// account/company and never rewriting recipient/outreach state.

import { describe, it, expect } from "vitest";
import {
  planLeadDetailAction,
  leadActionResultMessage,
  researchActionLabel,
  decisionMakerActionLabel,
  createLeadActionController,
} from "./leadDetailActions";
import type { LeadRow } from "./types";
import type { LeadActionResult } from "@/lib/leadActions";
import type { BuildLeadActionArgs } from "@/lib/leadActionRequest";

const WS = "ws-1";
const ACC = "acc-1";
const LEAD_ID = "lead-canonical-1";

/** Minimal LeadRow carrying the canonical fields the planner reads. */
function row(over: {
  workspaceId?: string;
  selectedLeadCandidateId?: string | null;
  selectedPlanId?: string | null;
  accountId?: string | null;
  planIds?: string[];
  researchStatus?: string;
  hasRecipient?: boolean;
} = {}): LeadRow {
  return {
    id: over.accountId ?? ACC,
    workspaceId: over.workspaceId ?? WS,
    name: "Harmonic Security",
    selectedRecipient: over.hasRecipient ? ({ id: "c1", fullName: "Kenneth", verified: true } as never) : null,
    canonical: {
      identity: { workspaceId: over.workspaceId ?? WS, accountId: over.accountId === undefined ? ACC : over.accountId },
      leadRows: {
        selectedLeadCandidateId: over.selectedLeadCandidateId === undefined ? LEAD_ID : over.selectedLeadCandidateId,
        selectedPlanId: over.selectedPlanId ?? null,
        planIds: over.planIds ?? [],
      },
      research: { status: over.researchStatus ?? "not_started" },
    },
  } as unknown as LeadRow;
}

const OK = { activeWorkspaceId: WS, hasSession: true };

describe("planLeadDetailAction — payload", () => {
  it("6/7/9. find_decision_makers builds workspace + one canonical lead id", () => {
    const p = planLeadDetailAction({ lead: row(), ...OK }, "find_decision_makers");
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.args.leadAction).toBe("find_decision_makers");
    expect(p.args.workspaceId).toBe(WS);
    expect(p.args.leadCandidateIds).toEqual([LEAD_ID]);
  });

  it("8. research_company uses the exact action name + canonical lead id", () => {
    const p = planLeadDetailAction({ lead: row(), ...OK }, "research_company");
    expect(p.ok && p.args.leadAction).toBe("research_company");
    expect(p.ok && p.args.leadCandidateIds).toEqual([LEAD_ID]);
  });

  it("3. account id / company name are NEVER used as the action id", () => {
    const p = planLeadDetailAction({ lead: row({ accountId: "acc-999", selectedLeadCandidateId: LEAD_ID }), ...OK }, "find_decision_makers");
    expect(p.ok && p.args.leadCandidateIds).toEqual([LEAD_ID]);
    expect(p.ok && p.args.leadCandidateIds).not.toContain("acc-999");
  });

  it("10. plan id is included only when the representative row has one", () => {
    expect(planLeadDetailAction({ lead: row({ selectedPlanId: null }), ...OK }, "find_decision_makers"))
      .toMatchObject({ ok: true, args: { planId: undefined } });
    const withPlan = planLeadDetailAction({ lead: row({ selectedPlanId: "plan-7" }), ...OK }, "find_decision_makers");
    expect(withPlan.ok && withPlan.args.planId).toBe("plan-7");
  });

  // §4 — the plan id MUST belong to the selected lead, never planIds[0].
  it("§4. request uses the REPRESENTATIVE row's plan, not an arbitrary planIds[0]", () => {
    // Four plans exist; the representative (selected) lead's plan is plan-C, which
    // is NOT the first element of planIds.
    const lead = row({
      selectedLeadCandidateId: "lead-C",
      selectedPlanId: "plan-C",
      planIds: ["plan-A", "plan-B", "plan-C", "plan-D"],
    });
    const p = planLeadDetailAction({ lead, ...OK }, "find_decision_makers");
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.args.leadCandidateIds).toEqual(["lead-C"]);
    expect(p.args.planId).toBe("plan-C");
    expect(p.args.planId).not.toBe("plan-A"); // never the array-order first plan
  });

  it("21/22/23. the payload carries ONLY the lead id — no recipient/account/outreach", () => {
    const p = planLeadDetailAction({ lead: row({ hasRecipient: true }), ...OK }, "find_decision_makers");
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(Object.keys(p.args).sort()).toEqual(["leadAction", "leadCandidateIds", "workspaceId"]);
    // No account_id, no recipient, no message — the backend is the association authority.
  });
});

describe("planLeadDetailAction — guards", () => {
  it("14. missing session blocks invocation", () => {
    const p = planLeadDetailAction({ lead: row(), activeWorkspaceId: WS, hasSession: false }, "find_decision_makers");
    expect(p).toMatchObject({ ok: false, reason: "no_session" });
    expect(!p.ok && p.message).toContain("session has expired");
  });

  it("15. missing workspace blocks invocation", () => {
    expect(planLeadDetailAction({ lead: row(), activeWorkspaceId: null, hasSession: true }, "research_company"))
      .toMatchObject({ ok: false, reason: "no_workspace" });
  });

  it("26/27. a lead from another workspace is rejected", () => {
    const p = planLeadDetailAction({ lead: row({ workspaceId: "ws-OTHER" }), activeWorkspaceId: WS, hasSession: true }, "find_decision_makers");
    expect(p).toMatchObject({ ok: false, reason: "workspace_mismatch" });
  });

  it("5. no actionable canonical lead id disables with explanation", () => {
    const p = planLeadDetailAction({ lead: row({ selectedLeadCandidateId: null }), ...OK }, "find_decision_makers");
    expect(p).toMatchObject({ ok: false, reason: "no_actionable_lead" });
    expect(!p.ok && p.message).toBe("No actionable lead record is available for this account.");
  });

  it("no account id also disables", () => {
    expect(planLeadDetailAction({ lead: row({ accountId: null }), ...OK }, "find_decision_makers"))
      .toMatchObject({ ok: false, reason: "no_actionable_lead" });
  });
});

describe("leadActionResultMessage", () => {
  const res = (o: Partial<LeadActionResult>): LeadActionResult => ({ success: false, ...o });

  it("16-success. success is a success tone", () => {
    expect(leadActionResultMessage(res({ success: true })).tone).toBe("success");
  });
  it("18. a request-error proves no provider ran", () => {
    const m = leadActionResultMessage(res({ error: "no_workspace", requestError: true }));
    expect(m.tone).toBe("error");
  });
  it("request-error default message asserts no provider ran", () => {
    const m = leadActionResultMessage(res({ error: "unexpected_request_error", requestError: true, message: undefined }));
    expect(m.message.toLowerCase()).toContain("no provider ran");
  });
  it("14/auth. unidentified_user maps to a re-auth message", () => {
    expect(leadActionResultMessage(res({ error: "unidentified_user" })).message).toContain("Sign in again");
  });
  it("19. a blocked business result is a distinct blocked tone", () => {
    expect(leadActionResultMessage(res({ status: "blocked", error: "blocked_missing_company_research" })).tone).toBe("blocked");
  });
  it("post-execution failure never claims the provider did/didn't run", () => {
    const m = leadActionResultMessage(res({ error: "provider_failed", message: "The provider failed." }));
    expect(m.tone).toBe("error");
    expect(m.message.toLowerCase()).not.toContain("no provider ran");
  });
});

describe("createLeadActionController — single-flight (§5)", () => {
  function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
  }
  const okPlan = () => planLeadDetailAction({ lead: row(), ...OK }, "find_decision_makers");

  it("6/7. two clicks in the same tick fire runLeadAction exactly once", async () => {
    let calls = 0;
    const gate = deferred<LeadActionResult>();
    const c = createLeadActionController({
      runLeadAction: ((_args: BuildLeadActionArgs) => { calls += 1; return gate.promise; }) as never,
      onSuccess: () => {}, onBlocked: () => {}, onError: () => {},
    });
    // Fire twice synchronously BEFORE the first promise settles.
    const a = c.run(okPlan(), "find_decision_makers");
    const b = c.run(okPlan(), "find_decision_makers");
    expect(calls).toBe(1);          // second call ignored by the sync guard
    expect(c.isRunning()).toBe("find_decision_makers");
    gate.resolve({ success: true });
    await Promise.all([a, b]);
    expect(calls).toBe(1);
    expect(c.isRunning()).toBe(null); // released after settle
  });

  it("13. a click while loading is ignored; a NEW action works after settle", async () => {
    let calls = 0;
    const c = createLeadActionController({
      runLeadAction: ((_a: BuildLeadActionArgs) => { calls += 1; return Promise.resolve({ success: true } as LeadActionResult); }) as never,
      onSuccess: () => {}, onBlocked: () => {}, onError: () => {},
    });
    await c.run(okPlan(), "find_decision_makers");
    await c.run(planLeadDetailAction({ lead: row(), ...OK }, "research_company"), "research_company");
    expect(calls).toBe(2);          // sequential actions each run
  });

  it("8/9/16. success invalidates via onSuccess; failure routes to onError; blocked to onBlocked", async () => {
    const seen: string[] = [];
    const mk = (result: LeadActionResult) => createLeadActionController({
      runLeadAction: (() => Promise.resolve(result)) as never,
      onSuccess: () => { seen.push("success"); },
      onBlocked: () => { seen.push("blocked"); },
      onError: () => { seen.push("error"); },
    });
    await mk({ success: true }).run(okPlan(), "find_decision_makers");
    await mk({ success: false, status: "blocked", error: "blocked_missing_company_research" }).run(okPlan(), "find_decision_makers");
    await mk({ success: false, error: "provider_failed", message: "x" }).run(okPlan(), "find_decision_makers");
    expect(seen).toEqual(["success", "blocked", "error"]);
  });

  it("a gate failure (no session) never calls runLeadAction", async () => {
    let calls = 0;
    const c = createLeadActionController({
      runLeadAction: (() => { calls += 1; return Promise.resolve({ success: true } as LeadActionResult); }) as never,
      onSuccess: () => {}, onBlocked: () => {}, onError: () => {},
    });
    const badPlan = planLeadDetailAction({ lead: row(), activeWorkspaceId: WS, hasSession: false }, "find_decision_makers");
    await c.run(badPlan, "find_decision_makers");
    expect(calls).toBe(0);
  });
});

describe("labels", () => {
  it("28/29. research label never hides a previous success (Retry when a retry failed)", () => {
    expect(researchActionLabel("previous_success_retry_failed")).toBe("Retry research");
    expect(researchActionLabel("ready")).toBe("Refresh research");
    expect(researchActionLabel("not_started")).toBe("Research company");
  });
  it("decision-maker label reflects an existing recipient", () => {
    expect(decisionMakerActionLabel(false)).toBe("Find decision-makers");
    expect(decisionMakerActionLabel(true)).toBe("Find more decision-makers");
  });
});

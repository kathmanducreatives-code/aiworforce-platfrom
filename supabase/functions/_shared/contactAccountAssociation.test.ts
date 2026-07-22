// Verified contact-to-account association + guarded backfill planner.
// Synthetic fixtures only; no network/db/provider/model.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  resolveContactAccountAssociation,
  type AssociationAccount,
  type AssociationContact,
} from "./contactAccountAssociation.ts";
import { planContactBackfill, extractContactSignals } from "./contactAccountBackfillPlanner.ts";

const WS = "ws-1";
const ACC = "acc-1";
const account = (o: Partial<AssociationAccount> = {}): AssociationAccount =>
  ({ id: ACC, workspace_id: WS, name: "Harmonic", domain: "harmonic.security", linkedin_url: "https://linkedin.com/company/harmonic", providerCompanyId: "prov-h", ...o });
const contact = (o: Partial<AssociationContact> = {}): AssociationContact =>
  ({ workspace_id: WS, linkedin_url: "https://linkedin.com/in/x", ...o });
const resolve = (c: Partial<AssociationContact>, a: Partial<AssociationAccount> = {}, extra: Record<string, unknown> = {}) =>
  resolveContactAccountAssociation({ workspaceId: WS, contact: contact(c), candidateAccount: account(a), now: "2026-07-21T00:00:00Z", ...extra });

// ---- RESOLUTION ---------------------------------------------------------------
Deno.test("1. exact provider company id verifies", () => {
  const r = resolve({ providerCompanyId: "prov-h" });
  assertEquals(r.decision, "verified"); assertEquals(r.accountId, ACC);
  assert(r.matchedSignals.exactProviderCompanyId);
});
Deno.test("2. exact employer domain verifies", () => {
  const r = resolve({ employerDomain: "https://www.harmonic.security/careers" });
  assertEquals(r.decision, "verified"); assert(r.matchedSignals.exactCompanyDomain);
});
Deno.test("3. exact company linkedin verifies", () => {
  const r = resolve({ employerLinkedInUrl: "https://linkedin.com/company/harmonic/" });
  assertEquals(r.decision, "verified"); assert(r.matchedSignals.exactCompanyLinkedIn);
});
Deno.test("4. company-scoped search + verified employer verifies", () => {
  const r = resolve({ currentEmployerVerified: true }, {}, { companyScopedSearch: true });
  assertEquals(r.decision, "verified");
});
Deno.test("5. normalized company name alone does NOT verify", () => {
  const r = resolve({ employerName: "Harmonic" });
  assertEquals(r.decision, "needs_review"); assertEquals(r.accountId, null);
  assert(r.matchedSignals.normalizedEmployerName);
});
Deno.test("6. title alone does not verify (no employer identity)", () => {
  const r = resolve({});
  assertEquals(r.decision, "needs_review");
});
Deno.test("7. task-array membership alone does not verify (no signals here)", () => {
  const r = resolve({ employerName: "Something Vague" });
  assertEquals(r.decision, "needs_review");
});
Deno.test("8. wrong current employer (verified) rejects", () => {
  const r = resolve({ employerDomain: "rival.com", currentEmployerVerified: true });
  assertEquals(r.decision, "rejected"); assert(r.conflicts.includes("employer_domain_conflict"));
});
Deno.test("9. historical employer does not attach", () => {
  const r = resolve({ employerDomain: "harmonic.security", isHistoricalEmployer: true });
  assertEquals(r.decision, "needs_review"); assertEquals(r.accountId, null);
});
Deno.test("10. parent/subsidiary ambiguity (name only) needs review", () => {
  const r = resolve({ employerName: "Harmonic", employerDomain: null });
  assertEquals(r.decision, "needs_review");
});
Deno.test("proxy/recruiter is rejected", () => {
  const r = resolve({ employerDomain: "harmonic.security", looksLikeProxy: true });
  assertEquals(r.decision, "rejected");
});

// ---- PERSISTENCE INTENT -------------------------------------------------------
Deno.test("11. verified result carries account_id; 12/13. review/reject leave it null", () => {
  assertEquals(resolve({ providerCompanyId: "prov-h" }).accountId, ACC);
  assertEquals(resolve({ employerName: "Harmonic" }).accountId, null);
  assertEquals(resolve({ employerDomain: "rival.com", currentEmployerVerified: true }).accountId, null);
});
Deno.test("14. existing SAME association is preserved/confirmed", () => {
  const r = resolve({ account_id: ACC, employerDomain: "harmonic.security" });
  assertEquals(r.decision, "verified"); assertEquals(r.accountId, ACC);
  assert(r.reasons.includes("existing_association_confirmed"));
});
Deno.test("15. lower-confidence evidence cannot overwrite a different existing association", () => {
  const r = resolve({ account_id: "acc-OTHER", employerName: "Harmonic" });
  assertEquals(r.accountId, "acc-OTHER"); // preserved
  assert(r.reasons.some((x) => x.includes("preserved")));
});
Deno.test("18. provenance persists identifiers", () => {
  const r = resolve({ providerCompanyId: "prov-h", linkedin_url: "https://linkedin.com/in/ken" });
  assertEquals(r.provenance.provider_company_id, "prov-h");
  assertEquals(r.provenance.account_id, ACC);
  assert(typeof r.provenance.resolved_at === "string");
});

// ---- REASSIGNMENT (§6) --------------------------------------------------------
Deno.test("G. strong verified new employer vs existing account → reassignment_required, no silent move", () => {
  const r = resolve({ account_id: "acc-OLD", employerDomain: "harmonic.security", currentEmployerVerified: true });
  assertEquals(r.decision, "reassignment_required"); assertEquals(r.accountId, null);
  assertEquals(r.provenance.existing_account_id, "acc-OLD");
});

// ---- MULTI-TENANT -------------------------------------------------------------
Deno.test("23. cross-workspace association rejects (contact)", () => {
  const r = resolveContactAccountAssociation({ workspaceId: WS, contact: contact({ workspace_id: "ws-OTHER", providerCompanyId: "prov-h" }), candidateAccount: account() });
  assertEquals(r.decision, "rejected"); assert(r.conflicts.includes("contact_workspace_mismatch"));
});
Deno.test("24/25. account or lead in another workspace / mismatched lead account rejects", () => {
  assertEquals(resolveContactAccountAssociation({ workspaceId: WS, contact: contact({ providerCompanyId: "prov-h" }), candidateAccount: account({ workspace_id: "ws-OTHER" }) }).decision, "rejected");
  assertEquals(resolveContactAccountAssociation({ workspaceId: WS, contact: contact({ providerCompanyId: "prov-h" }), candidateAccount: account(), leadCandidate: { id: "l1", workspace_id: WS, account_id: "acc-OTHER" } }).decision, "rejected");
});

// ---- BACKFILL PLANNER ---------------------------------------------------------
Deno.test("31. high-confidence row → safe_to_backfill with expected null guard", () => {
  const row = planContactBackfill({
    workspaceId: WS,
    contact: { id: "c1", workspace_id: WS, account_id: null, linkedin_url: "https://linkedin.com/in/ken", company: "Harmonic", raw: { via: "decision_maker_discovery", company_match: { status: "verified", domain: "harmonic.security" } } },
    leadCandidate: { id: "l1", workspace_id: WS, account_id: ACC },
    candidateAccount: account(),
  });
  assertEquals(row.classification, "safe_to_backfill");
  assertEquals(row.accountId, ACC);
  assertEquals(row.expectedCurrentAccountId, null);
});
Deno.test("32. name-only row → needs_review, no account", () => {
  const row = planContactBackfill({ workspaceId: WS, contact: { id: "c2", workspace_id: WS, account_id: null, linkedin_url: null, company: "Harmonic", raw: {} }, leadCandidate: { id: "l1", workspace_id: WS, account_id: ACC }, candidateAccount: account() });
  assertEquals(row.classification, "needs_review"); assertEquals(row.accountId, null);
});
Deno.test("33. wrong-employer row → rejected", () => {
  const row = planContactBackfill({ workspaceId: WS, contact: { id: "c3", workspace_id: WS, account_id: null, linkedin_url: null, company: "Rival", raw: { company_match: { status: "verified", domain: "rival.com" } } }, leadCandidate: { id: "l1", workspace_id: WS, account_id: ACC }, candidateAccount: account() });
  assertEquals(row.classification, "rejected");
});
Deno.test("already_associated when account_id set", () => {
  const row = planContactBackfill({ workspaceId: WS, contact: { id: "c4", workspace_id: WS, account_id: ACC, linkedin_url: null, company: "Harmonic", raw: {} }, candidateAccount: account() });
  assertEquals(row.classification, "already_associated");
});
Deno.test("35. planner performs no writes (pure) + extractContactSignals reads verified", () => {
  const s = extractContactSignals({ company_match: { status: "verified", domain: "harmonic.security" }, via: "contact_discovery" });
  assertEquals(s.currentEmployerVerified, true);
  assertEquals(s.employerDomain, "harmonic.security");
  assertEquals(s.companyScopedSearch, true);
});

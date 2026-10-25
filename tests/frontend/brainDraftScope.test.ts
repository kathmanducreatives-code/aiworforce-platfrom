// The edit drawer's unsaved-draft buffer is kept PER BRAIN (Phase 3c): a draft
// typed for one client never restores into the agency Brain or another
// client's, even if a key were mismatched. The agency key is unchanged, so a
// draft saved before client Brains still restores.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { DRAFT_SCHEMA_VERSION, draftKey, loadDraft, saveDraft, type CompanyBrainDraft } from "../../src/lib/companyBrainDrafts.ts";
import { AGENCY_SCOPE, effectiveBrainScope } from "../../src/lib/brainScope.ts";

const U = "u-1", WS = "ws-1", A = "22222222-2222-4222-8222-222222222222", B = "33333333-3333-4333-8333-333333333333";
const draft = (clientId: string | null, text: string): CompanyBrainDraft => ({
  schemaVersion: DRAFT_SCHEMA_VERSION, userId: U, workspaceId: WS, sectionId: "targeting", clientId,
  brainVersion: null, values: { note: text }, dirty: true, drawerOpen: true, activeSection: "targeting",
  expandedGroups: [], scrollPosition: 0, draftUpdatedAt: new Date().toISOString(), baseServerUpdatedAt: null,
});

Deno.test("drafts: one key per Brain; the agency key is unchanged", () => {
  assertEquals(draftKey({ userId: U, workspaceId: WS, sectionId: "targeting" }), `agentory.company-brain-draft.v1:${U}:${WS}:targeting`);
  const keys = new Set([null, A, B].map((c) => draftKey({ userId: U, workspaceId: WS, sectionId: "targeting", clientId: c })));
  assertEquals(keys.size, 3);
});

Deno.test("drafts: a client's unsaved text never restores into another Brain", () => {
  sessionStorage.clear();
  saveDraft(draft(A, "A-SECRET unsaved"));
  saveDraft(draft(null, "agency unsaved"));
  assertEquals(loadDraft({ userId: U, workspaceId: WS, sectionId: "targeting", clientId: A })?.values.note, "A-SECRET unsaved");
  assertEquals(loadDraft({ userId: U, workspaceId: WS, sectionId: "targeting" })?.values.note, "agency unsaved");
  assertEquals(loadDraft({ userId: U, workspaceId: WS, sectionId: "targeting", clientId: B }), null);
  // Defence in depth: A's envelope planted under B's key is still refused.
  sessionStorage.setItem(draftKey({ userId: U, workspaceId: WS, sectionId: "targeting", clientId: B })!, JSON.stringify(draft(A, "A-SECRET planted")));
  assertEquals(loadDraft({ userId: U, workspaceId: WS, sectionId: "targeting", clientId: B }), null);
  // …and under the agency key.
  sessionStorage.setItem(draftKey({ userId: U, workspaceId: WS, sectionId: "targeting" })!, JSON.stringify(draft(A, "A-SECRET planted")));
  assertEquals(loadDraft({ userId: U, workspaceId: WS, sectionId: "targeting" }), null);
  sessionStorage.clear();
});

Deno.test("scope shown: only a client the server lists now; anything uncertain is the agency Brain", () => {
  assertEquals(effectiveBrainScope(A, [{ clientId: A }, { clientId: B }]), { kind: "client", clientId: A });
  assertEquals(effectiveBrainScope(A, [{ clientId: B }]), AGENCY_SCOPE, "no longer listed (revoked / archived)");
  assertEquals(effectiveBrainScope(A, null), AGENCY_SCOPE, "list not read, failed or switched off");
  assertEquals(effectiveBrainScope(A, []), AGENCY_SCOPE);
  assertEquals(effectiveBrainScope(null, [{ clientId: A }]), AGENCY_SCOPE, "nothing selected");
  assertEquals(effectiveBrainScope("not-a-uuid", [{ clientId: "not-a-uuid" }]), AGENCY_SCOPE, "a malformed id is never a scope");
});

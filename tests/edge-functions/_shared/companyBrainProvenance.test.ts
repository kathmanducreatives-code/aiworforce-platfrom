// COMPANY BRAIN V2 · B2.2 — provenance is decided by the server: a browser claim
// counts only when the server can re-derive it. Fictional data.
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  canonicalJson, parseProvenanceClaim, provenanceForOrigin, resolveUpdateProvenance, sectionProfileKeys, sectionProvenance,
} from "../../../supabase/functions/_shared/companyBrainProvenance.ts";
import { acceptSuggestionPatch, buildCompletionSuggestions } from "../../../supabase/functions/_shared/companyBrainCompletion.ts";
import { assessIcpConsistency } from "../../../supabase/functions/_shared/companyBrainIcpConsistency.ts";

type Raw = Record<string, unknown>;
const RUN_ID = "11111111-2222-4333-8444-555555555555";
const profile: Raw = {
  schema_version: 2,
  company: { name: "Fictional Clinics Co", description: "Scheduling software for physiotherapy clinics", category: "Healthcare SaaS" },
};
const run = {
  id: RUN_ID, source_type: "company_website", status: "completed", created_at: "2026-11-01T10:00:00Z",
  output: {
    understanding: { main_promise: "Fill every appointment slot automatically" },
    positioning_claims: ["Fill every appointment slot automatically", "Two-way calendar sync"],
    source_pages: ["https://fictional-clinics.example/", "https://fictional-clinics.example/pricing"],
  },
};
const suggestions = buildCompletionSuggestions(profile, [run]);
const promise = suggestions.find((s) => s.path === "positioning.promise")!;
const persona = suggestions.find((s) => s.source.kind === "brain_inference")!;
const resolve = (patch: unknown, claim: unknown, runs = [run]) =>
  resolveUpdateProvenance({ profileBefore: profile, patch, claim: parseProvenanceClaim(claim), runs });

Deno.test("B2.2: a website-research suggestion carries its run id", () => {
  assertEquals(promise.source.run_id, RUN_ID);
  assertEquals(buildCompletionSuggestions(profile, [{ ...run, id: undefined }]).find((s) => s.path === "positioning.promise")!.source.run_id, undefined);
});

Deno.test("B2.2: no claim, or a founder claim, is the person's own edit", () => {
  assertEquals(resolve({ goals: { gtm: "x" } }, undefined), { kind: "founder", ref: null, reason: null, downgraded: false });
  assertEquals(resolve({ goals: { gtm: "x" } }, { source: "founder", reason: "  New   quarter plan  " }).reason, "New quarter plan");
  assertEquals(resolve({}, { source: "founder", reason: "x".repeat(400) }).reason!.length, 280);
});

Deno.test("B2.2: accepting a research suggestion verbatim records research + the SERVER's run id", () => {
  const p = resolve(acceptSuggestionPatch(profile, promise), { source: "suggestion", suggestion_id: promise.id });
  assertEquals([p.kind, p.ref, p.downgraded], ["research", RUN_ID, false]);
  assertStringIncludes(p.reason!, "website research");
});

Deno.test("B2.2: the browser cannot name a run, or forge a value under a real suggestion", () => {
  // A run id in the claim is ignored: only the server's runs count.
  const claim = parseProvenanceClaim({ source: "suggestion", suggestion_id: promise.id, research_run_id: "99999999-2222-4333-8444-555555555555" });
  assertEquals(claim, { source: "suggestion", suggestion_id: promise.id, edited: false });
  // Different value than the run says → the person's edit, no research claim.
  const tampered = resolve({ positioning: { promise: "We are the market leader" } }, { source: "suggestion", suggestion_id: promise.id });
  assertEquals([tampered.kind, tampered.ref, tampered.downgraded], ["founder", null, true]);
  // A suggestion id the server cannot derive (no such run on THIS workspace).
  const ghost = resolve(acceptSuggestionPatch(profile, promise), { source: "suggestion", suggestion_id: promise.id }, []);
  assertEquals([ghost.kind, ghost.downgraded], ["founder", true]);
  const unknown = resolve({}, { source: "suggestion", suggestion_id: "positioning.promise:made_up" });
  assertEquals([unknown.kind, unknown.downgraded], ["founder", true]);
});

Deno.test("B2.2: edited first → the person's words, the suggestion named in the reason", () => {
  const p = resolve({ positioning: { promise: "Fill every slot, without phone tag" } }, { source: "suggestion", suggestion_id: promise.id, edited: true });
  assertEquals([p.kind, p.ref], ["founder", null]);
  assertStringIncludes(p.reason!, "Edited from your website research");
});

Deno.test("B2.2: a rule-based suggestion accepted verbatim is ai_inference — never research, never verified", () => {
  const p = resolve(acceptSuggestionPatch(profile, persona), { source: "suggestion", suggestion_id: persona.id });
  assertEquals([p.kind, p.ref], ["ai_inference", null]);
});

Deno.test("B2.2: a conflict resolution is recorded only when it is exactly one the check offered", () => {
  const P = JSON.parse(Deno.readTextFileSync(new URL("../../fixtures/company-brain/atlas-contract-profiles.json", import.meta.url))).profiles as Record<string, Raw>;
  const c = assessIcpConsistency(P.contradictory_copies).conflicts.find((x) => x.id === "industry_targeted_and_excluded")!;
  const r = c.resolutions[0];
  const ok = resolveUpdateProvenance({ profileBefore: P.contradictory_copies, patch: r.patch, claim: parseProvenanceClaim({ source: "resolution", conflict_id: c.id, resolution_id: r.id }), runs: [] });
  assertEquals(ok.kind, "founder");
  assertStringIncludes(ok.reason!, "Resolved a conflict");
  const forged = resolveUpdateProvenance({ profileBefore: P.contradictory_copies, patch: { target_customer: { industries: ["Gambling"] } }, claim: parseProvenanceClaim({ source: "resolution", conflict_id: c.id, resolution_id: r.id }), runs: [] });
  assertEquals([forged.reason, forged.downgraded], [null, true]);
});

Deno.test("B2.2: onboarding origins map to a source only when the author is known", () => {
  assertEquals(provenanceForOrigin("onboarding_seller_confirmation")?.kind, "founder");
  assertEquals(provenanceForOrigin("manual_edit")?.kind, "founder");
  assertEquals(provenanceForOrigin("automated_refresh")?.kind, "ai_inference");
  assertEquals(provenanceForOrigin("migration"), null);
  assertEquals(provenanceForOrigin("legacy_import"), null);
});

Deno.test("B2.2: canonical JSON ignores key order only", () => {
  assertEquals(canonicalJson({ b: 1, a: [1, { y: 2, x: 1 }] }), canonicalJson({ a: [1, { x: 1, y: 2 }], b: 1 }));
  assert(canonicalJson([1, 2]) !== canonicalJson([2, 1]));
});

Deno.test("B2.2: a section's provenance is its latest recorded change; nothing unrecorded is guessed", () => {
  assertEquals(sectionProfileKeys("target_customer").sort(), ["icp", "target_customer"]);
  assert(sectionProfileKeys("competitors").includes("competitors_v2"));
  const revs = [
    { revision: 1, changed_sections: ["company", "target_customer"], actor_kind: "backfill", actor_id: null, written_at: "2026-11-01T00:00:00Z" },
    { revision: 2, changed_sections: ["positioning"], actor_kind: "user", actor_id: "u1", written_at: "2026-11-02T00:00:00Z", source_kind: "research" as const, source_ref: RUN_ID, reason: "Accepted" },
    { revision: 3, changed_sections: ["target_customer", "icp"], actor_kind: "user", actor_id: "u2", written_at: "2026-11-03T00:00:00Z" },
  ];
  const pos = sectionProvenance(revs, sectionProfileKeys("positioning"))!;
  assertEquals([pos.kind, pos.research_run_id, pos.changes], ["research", RUN_ID, 1]);
  // Read without B2.2 columns (migration absent): unrecorded, not founder.
  const tc = sectionProvenance(revs, sectionProfileKeys("target_customer"))!;
  assertEquals([tc.kind, tc.revision, tc.changes], ["unrecorded", 3, 2]);
  assertEquals(sectionProvenance(revs, sectionProfileKeys("company"))!.kind, "backfill");
  assertEquals(sectionProvenance(revs, sectionProfileKeys("gtm")), null);
});

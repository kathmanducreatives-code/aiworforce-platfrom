import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildProvenanceRecord, type ProvenanceCtx } from "./leadHandoffGuard.ts";
import { sealProvenance } from "./leadPersistenceGuard.ts";
import { ACTOR_IMPL, artifactTypeForActor } from "./leadEntityIntent.ts";

// Reproduce the run-agent stamping: resolve the SPECIFIC actor impl + artifact
// type from the actor key, exactly as run-agent now does at the first write.
const actorKey = "apify_people_search";
const runActorImpl = ACTOR_IMPL[actorKey]; // harvestapi/linkedin-profile-search
const runArtifactType = artifactTypeForActor(actorKey); // person_candidate

const ctx: ProvenanceCtx = {
  provider: "apify",
  actor_key: actorKey,
  actor_id: runActorImpl,
  artifact_type: runArtifactType,
  provider_run_id: "run-123",
  workflow_run_id: "run-123",
  plan_id: "plan-abc",
  trace_id: "run-123",
};

const personItem = {
  name: "Jeff Esposito", company: "VeraAI Technologies Inc.",
  source_url: "https://www.linkedin.com/in/veraai",
  person_linkedin_url: "https://www.linkedin.com/in/veraai",
  profile_url: "https://www.linkedin.com/in/veraai",
} as any;

// (17) Initial provenance stores actor_key=apify_people_search.
Deno.test("initial provenance stores the logical actor_key", () => {
  const rec = buildProvenanceRecord(personItem, ctx);
  assertEquals(rec.actor_key, "apify_people_search");
});

// (18) Initial provenance stores actor_id=harvestapi/linkedin-profile-search.
Deno.test("initial provenance stores the specific actor implementation", () => {
  const rec = buildProvenanceRecord(personItem, ctx);
  assertEquals(rec.actor_id, "harvestapi/linkedin-profile-search");
  assert(rec.verified, "genuine person profile should verify");
});

// (20) artifact_type=person_candidate is preserved on the provenance record.
Deno.test("initial provenance preserves artifact_type=person_candidate", () => {
  const rec = buildProvenanceRecord(personItem, ctx);
  assertEquals(rec.artifact_type, "person_candidate");
});

// (19) Correct initial provenance does NOT set provenance_overwrite_attempt: the
// second-pass rebuild uses the same ctx, so trusted == incoming on actor_id.
Deno.test("correct initial actor_id → no overwrite attempt on re-seal", () => {
  const trusted = buildProvenanceRecord(personItem, ctx);   // memoryWriter insert
  const incoming = buildProvenanceRecord(personItem, ctx);  // run-agent second pass
  const sealed = sealProvenance(trusted, incoming);
  assertEquals(sealed.provenance_overwrite_attempt, false);
  assertEquals((sealed.provenance as any).actor_id, "harvestapi/linkedin-profile-search");
});

// Regression of the audit bug: a generic "apify" trusted block DID flag overwrite
// when the second pass carried the specific impl. The fix removes the generic stamp.
Deno.test("audit repro: generic apify trusted vs specific incoming → overwrite flagged", () => {
  const generic = buildProvenanceRecord(personItem, { ...ctx, actor_id: "apify" });
  const specific = buildProvenanceRecord(personItem, ctx);
  const sealed = sealProvenance(generic, specific);
  assertEquals(sealed.provenance_overwrite_attempt, true);
});

// (21) sealProvenance still blocks a GENUINE later overwrite attempt (protected
// field changed by untrusted downstream output) — the guard is not weakened.
Deno.test("sealProvenance still flags a genuine protected-field overwrite", () => {
  const trusted = buildProvenanceRecord(personItem, ctx);
  const tampered = buildProvenanceRecord(
    { ...personItem, source_url: "https://www.linkedin.com/in/someone-else", person_linkedin_url: "https://www.linkedin.com/in/someone-else", profile_url: "https://www.linkedin.com/in/someone-else" } as any,
    ctx,
  );
  const sealed = sealProvenance(trusted, tampered);
  assertEquals(sealed.provenance_overwrite_attempt, true);
  // Trusted block is returned unchanged.
  assertEquals((sealed.provenance as any).source_url, "https://www.linkedin.com/in/veraai");
});

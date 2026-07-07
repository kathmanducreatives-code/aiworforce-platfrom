import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { evidenceState, missingEvidence, confidenceLabel } from "./signalPresenter.ts";

Deno.test("evidence present when a real source URL exists", () => {
  const e = evidenceState({ sourceUrl: "https://www.linkedin.com/jobs/view/1", verificationStatus: "verified" });
  assert(e.hasEvidence);
  assert(!e.needsVerification);
  assertEquals(e.label, "Verified");
});

Deno.test("weak proof → needs review + missing evidence list", () => {
  const e = evidenceState({ sourceUrl: null, verificationStatus: "needs_verification", company: null });
  assert(!e.hasEvidence);
  assert(e.needsVerification);
  const miss = missingEvidence({ sourceUrl: null, company: null, verificationStatus: "needs_verification" });
  assert(miss.includes("Source proof URL"));
  assert(miss.includes("Company identity"));
});

Deno.test("verified with proof has no missing-evidence except honest confirmation note when unverified", () => {
  assertEquals(missingEvidence({ sourceUrl: "https://x.test/a", company: "Cekura", verificationStatus: "verified" }), []);
  assertEquals(missingEvidence({ sourceUrl: "https://x.test/a", company: "Cekura", verificationStatus: "needs_verification" }), ["Independent confirmation"]);
});

Deno.test("confidence label maps levels", () => {
  assertEquals(confidenceLabel("high").level, "high");
  assertEquals(confidenceLabel("medium").level, "medium");
  assertEquals(confidenceLabel(undefined).level, "low");
});

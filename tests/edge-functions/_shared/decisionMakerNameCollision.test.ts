// TWO MODULES, ONE NAME, DIFFERENT MEANINGS — THE TRAP THIS CLOSES.
//
// `_shared/employerVerification.ts` and `_shared/decisionMaker/employerVerification.ts`
// both existed, both were live, and both exported `EmployerVerification` and
// `verifyCurrentEmployer`. The same was true of the two `companyIdentity.ts`
// files (`CompanyIdentity`, `CompanyIdentityInput`, `resolveCompanyIdentity`,
// `normalizeCompanyName`).
//
// They did NOT mean the same thing:
//
//   EmployerVerification   top-level: a 5-value string union
//                            (verified_match | verified_mismatch | historical_only
//                             | ambiguous | insufficient_evidence)
//                          decisionMaker/: an object
//                            { status, match_methods, confidence, rejection_reasons }
//
//   normalizeCompanyName   top-level: keeps word spacing, strips known cohort
//                            labels — "LanceDB (YC W22)" -> "lancedb" as two words
//                          decisionMaker/: squashes every non-alphanumeric to
//                            produce a match key, no cohort handling
//
// Inside `decisionMaker/`, `import … from "./companyIdentity.ts"` resolves to the
// second; one directory up, the identical-looking specifier resolves to the
// first. Picking the wrong one compiles cleanly and silently changes whether a
// person is judged to work at a company.
//
// The rename is deliberately NOT a merge. Both implementations still exist and
// still answer their own question; they just can no longer be confused for one
// another. This test asserts the disambiguation holds.
//
// Pure and structural — no DOM, no network, no provider.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const read = (p: string) => Deno.readTextFileSync(new URL(p, import.meta.url));

/** Every identifier a module exports as a function/const/type/interface/class. */
function exportedNames(src: string): Set<string> {
  return new Set(
    [...src.matchAll(/^export (?:async )?(?:function|const|type|interface|class)\s+(\w+)/gm)]
      .map((m) => m[1]),
  );
}

const PAIRS: ReadonlyArray<readonly [string, string, string]> = [
  [
    "companyIdentity",
    "../../../supabase/functions/_shared/companyIdentity.ts",
    "../../../supabase/functions/_shared/decisionMaker/companyIdentity.ts",
  ],
  [
    "employerVerification",
    "../../../supabase/functions/_shared/employerVerification.ts",
    "../../../supabase/functions/_shared/decisionMaker/employerVerification.ts",
  ],
];

Deno.test("the two same-named module pairs export no identifier in common", () => {
  for (const [label, topPath, dmPath] of PAIRS) {
    const top = exportedNames(read(topPath));
    const dm = exportedNames(read(dmPath));
    assert(top.size > 0 && dm.size > 0, `${label}: both modules must still export something`);
    const shared = [...top].filter((n) => dm.has(n)).sort();
    assertEquals(
      shared, [],
      `${label}.ts: "${shared.join(", ")}" is exported by BOTH the top-level and the ` +
      `decisionMaker/ module. Same name, different meaning — rename one before merging ` +
      `anything, and do not assume the two implementations agree.`,
    );
  }
});

Deno.test("both implementations still exist — the rename did not merge behaviour", () => {
  const topEv = read("../../../supabase/functions/_shared/employerVerification.ts");
  const dmEv = read("../../../supabase/functions/_shared/decisionMaker/employerVerification.ts");

  // The 5-value outcome union, under its new name.
  assert(/export type EmployerMatchOutcome\s*=/.test(topEv));
  for (const v of ["verified_match", "verified_mismatch", "historical_only", "ambiguous", "insufficient_evidence"]) {
    assert(topEv.includes(`"${v}"`), `top-level outcome "${v}" must survive the rename`);
  }

  // The record object, under its new name, with its own distinct status vocabulary.
  assert(/export interface EmployerVerificationRecord\s*\{/.test(dmEv));
  assert(/export type EmployerVerificationStatus\s*=/.test(dmEv));
  for (const v of ["verified", "probable", "unverified", "rejected"]) {
    assert(dmEv.includes(`"${v}"`), `decisionMaker/ status "${v}" must survive the rename`);
  }

  // Two verifiers, two names, both still present.
  assert(/export function verifyCurrentEmployer\b/.test(topEv));
  assert(/export function verifyDecisionMakerEmployer\b/.test(dmEv));
});

Deno.test("the two company-name normalisers remain distinct, and are named as such", () => {
  const topCi = read("../../../supabase/functions/_shared/companyIdentity.ts");
  const dmCi = read("../../../supabase/functions/_shared/decisionMaker/companyIdentity.ts");
  assert(/export function normalizeCompanyName\b/.test(topCi));
  assert(/export function normalizeCompanyNameForMatching\b/.test(dmCi));
  // The behavioural difference that made the collision dangerous: one squashes
  // every non-alphanumeric into a match key, the other does not.
  assert(dmCi.includes("[^a-z0-9]+"), "the matching normaliser still squashes to a key");
  assert(!topCi.includes("[^a-z0-9]+"), "the identity normaliser still preserves word structure");
});

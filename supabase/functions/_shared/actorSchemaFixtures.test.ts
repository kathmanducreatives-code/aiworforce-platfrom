// THE VALIDATOR MUST AGREE WITH THE PROVIDER, NOT WITH ITSELF.
//
// PR #122 shipped required-field rules for five capabilities and verified only
// one of them against Apify. Re-reading the other four on 2026-07-30 found two
// materially wrong rules — a validator confidently passing payloads the provider
// would reject is the same class of defect as the bug it was built to stop, one
// layer up.
//
// These tests bind `finalActorPayload`'s rules to the recorded provider schemas so
// the two cannot drift apart silently again.
//
// OFFLINE ONLY. No provider, no model, no network.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ACTOR_SCHEMA_FIXTURES, schemaFixtureFor, isDocumentedEnumValue, supportedFieldsFor,
  ACTOR_SCHEMA_FIXTURE_VERSION,
} from "./actorSchemaFixtures.ts";
import { validateFinalActorPayload } from "./finalActorPayload.ts";
import { indeedDatePostedBucket } from "./actorInputPlanner.ts";

const CAPABILITIES = [
  "indeed_job_discovery", "linkedin_job_discovery", "glassdoor_job_discovery",
  "yc_job_discovery", "ats_job_verification",
] as const;

// ================================ 1./5./6. every card is versioned ==========

Deno.test("1./5. every dynamic capability has a verified, dated schema fixture", () => {
  assertEquals(ACTOR_SCHEMA_FIXTURE_VERSION, "actor-schema-fixtures-1.0.0");
  for (const cap of CAPABILITIES) {
    const fx = schemaFixtureFor(cap);
    assert(fx, `${cap} has no fixture`);
    assertEquals(fx.retrievedOn, "2026-07-30");
    assert(fx.actorId.includes("/"), `${cap} actorId looks wrong`);
    assert(fx.source.startsWith("apify.com/"), `${cap} has no provenance`);
    assert(fx.supported.length > 0, `${cap} documents no fields`);
  }
});

Deno.test("6. result-limit and recency semantics are recorded per actor", () => {
  // These differ per provider and are exactly what a compiler must not guess.
  assertEquals(schemaFixtureFor("indeed_job_discovery")!.resultLimit!.field, "maxItems");
  assertEquals(schemaFixtureFor("linkedin_job_discovery")!.resultLimit!.field, "jobsToFetch");
  assertEquals(schemaFixtureFor("glassdoor_job_discovery")!.resultLimit!.field, "limit");
  assertEquals(schemaFixtureFor("yc_job_discovery")!.resultLimit!.field, "maxResults");

  // Four different recency mechanisms, one of which does not exist at all.
  assertEquals(schemaFixtureFor("indeed_job_discovery")!.recency.kind, "enum");
  assertEquals(schemaFixtureFor("indeed_job_discovery")!.recency.maxDays, 14);
  assertEquals(schemaFixtureFor("linkedin_job_discovery")!.recency.kind, "seconds");
  assertEquals(schemaFixtureFor("glassdoor_job_discovery")!.recency.kind, "integer_days");
  assertEquals(schemaFixtureFor("yc_job_discovery")!.recency.kind, "none");
});

// ========================= the two rules that were wrong ====================

Deno.test("Glassdoor requires keywords AND location — the inferred rule required neither", () => {
  const fx = schemaFixtureFor("glassdoor_job_discovery")!;
  assertEquals(fx.required, ["keywords", "location"]);

  // A payload with only `keywords` is now correctly rejected.
  const partial = validateFinalActorPayload("glassdoor_job_discovery", { keywords: "Revenue Operations", daysOld: 30 });
  assertFalse(partial.ok, "location is required by the actor");
  assert(partial.violations.includes("missing_required:location"));

  // `query` is not an alias the actor knows, so it must not satisfy the rule.
  const wrongField = validateFinalActorPayload("glassdoor_job_discovery", { query: "Revenue Operations", location: "United States" });
  assertFalse(wrongField.ok, "`query` is not a Glassdoor field");
  assert(wrongField.violations.includes("foreign_serializer_key:query"));

  const good = validateFinalActorPayload("glassdoor_job_discovery", {
    keywords: "Revenue Operations", location: "United States", daysOld: 60, limit: 50, sortBy: "date_desc",
  });
  assert(good.ok, good.violations.join(","));
});

Deno.test("ATS requires companies — a preset bundle would be unrestricted discovery", () => {
  // Without `companies` this actor scrapes preset company lists, which is market
  // discovery, not verification of a company we already qualified.
  const noCompany = validateFinalActorPayload("ats_job_verification", { titleKeyword: "Revenue Operations" });
  assertFalse(noCompany.ok);
  assert(noCompany.violations.includes("missing_required:companies"));

  const preset = validateFinalActorPayload("ats_job_verification", { presetLists: ["top-tech"] });
  assertFalse(preset.ok, "presetLists must not substitute for a known company identity");
  assert(preset.violations.includes("foreign_serializer_key:presetLists"));

  const scoped = validateFinalActorPayload("ats_job_verification", {
    companies: [{ ats: "greenhouse", company: "acme" }], titleKeyword: "Revenue Operations",
  });
  assert(scoped.ok, scoped.violations.join(","));
});

Deno.test("YC exposes searchQuery, not query", () => {
  const fx = schemaFixtureFor("yc_job_discovery")!;
  assert(fx.supported.includes("searchQuery"));
  assertFalse(fx.supported.includes("query"));

  assertFalse(validateFinalActorPayload("yc_job_discovery", { query: "Sales Operations" }).ok);
  const good = validateFinalActorPayload("yc_job_discovery", {
    searchQuery: "Sales Operations", roleFilter: "operations", maxResults: 40,
  });
  assert(good.ok, good.violations.join(","));
});

// ================= 21./24. every rule's fields exist on the actor ===========

Deno.test("21./24. no rule requires or forbids a field the provider does not document", () => {
  for (const cap of CAPABILITIES) {
    const fx = schemaFixtureFor(cap)!;
    const supported = new Set(fx.supported);
    // Anything the rule REQUIRES must be a real field on that actor.
    const probe = validateFinalActorPayload(cap, {});
    for (const v of probe.violations) {
      const m = /^missing_required(?:_any_of)?:(.+)$/.exec(v);
      if (!m) continue;
      for (const field of m[1].split("|")) {
        assert(supported.has(field), `${cap} requires "${field}" which the actor does not document`);
      }
    }
  }
});

// ============ Indeed's datePosted: the latent invalid-enum defect ============

Deno.test("34. Indeed datePosted only ever emits a documented enum value", () => {
  const allowed = new Set(["", ...schemaFixtureFor("indeed_job_discovery")!.enums.datePosted]);
  for (const days of [null, undefined, 0, -5, 1, 2, 3, 5, 7, 10, 14, 21, 30, 45, 60, 365]) {
    const r = indeedDatePostedBucket(days as number | null | undefined);
    assert(allowed.has(r.value), `days=${days} produced undocumented datePosted "${r.value}"`);
    assert(isDocumentedEnumValue("indeed_job_discovery", "datePosted", r.value));
  }
  // The values it used to emit are NOT members of the enum.
  for (const old of ["1", "3", "7", "14"]) {
    assertFalse(allowed.has(old), `"${old}" must not be treated as valid`);
    assertFalse(isDocumentedEnumValue("indeed_job_discovery", "datePosted", old));
  }
});

Deno.test("32./33. a window beyond 14 days is clamped and the approximation recorded", () => {
  for (const days of [30, 45, 60]) {
    const r = indeedDatePostedBucket(days);
    assertEquals(r.value, "14 days");
    assert(r.repair && r.repair.startsWith("posting_window_clamped:"), String(r.repair));
    // The repair names the real supported set so an operator can see why.
    assert(r.repair!.includes("14 days"));
  }
  // Inside the supported range there is nothing to approximate.
  assertEquals(indeedDatePostedBucket(7).repair, null);
});

Deno.test("enum guards accept unset and reject invented values", () => {
  assert(isDocumentedEnumValue("indeed_job_discovery", "jobType", "fulltime"));
  assertFalse(isDocumentedEnumValue("indeed_job_discovery", "jobType", "full_time"));
  assert(isDocumentedEnumValue("indeed_job_discovery", "jobType", ""));
  assert(isDocumentedEnumValue("glassdoor_job_discovery", "sortBy", "date_desc"));
  assertFalse(isDocumentedEnumValue("glassdoor_job_discovery", "sortBy", "newest"));
  assert(isDocumentedEnumValue("yc_job_discovery", "roleFilter", "operations"));
  assertFalse(isDocumentedEnumValue("yc_job_discovery", "roleFilter", "revops"));
  // A field with no documented enum cannot be violated.
  assert(isDocumentedEnumValue("indeed_job_discovery", "location", "anything at all"));
  assertEquals(supportedFieldsFor("does_not_exist"), []);
});

// -------------------------------- no credentials anywhere -------------------

Deno.test("fixtures carry schema facts only — no tokens, URLs with keys, or headers", () => {
  const blob = JSON.stringify(ACTOR_SCHEMA_FIXTURES).toLowerCase();
  for (const forbidden of ["apify_api_token", "token=", "bearer ", "authorization", "sk-"]) {
    assertFalse(blob.includes(forbidden), `"${forbidden}" leaked into the fixtures`);
  }
});

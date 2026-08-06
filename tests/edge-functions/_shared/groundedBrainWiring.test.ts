// THE GROUNDING IS WIRED IN, AND IT IS OFF UNTIL SOMEBODY TURNS IT ON.
//
// The previous stage built the registry, the grounded contract and the verifier,
// and proved them in isolation — while the live path still ran the old
// classifier and passed no grounding to `decideCompanyBrain`. Grounding was
// available and provably correct, and protected nothing.
//
// These tests drive the REAL engine with mocked model responses and prove three
// separate things: that the registry is built from live engine state before
// evaluation; that the verified verdict reaches the Brain only in enforce mode;
// and that a rejected claim never reaches the user in either mode.
//
// ZERO network, ZERO Actor runs, ZERO real model calls, ZERO database writes.

import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  runCapabilityPlan, type CapabilityEngineDeps,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import {
  parseLeadMissionDeterministic,
} from "../../../supabase/functions/_shared/leadMission.ts";
import {
  buildGroundedBrainBinding, buildShadowComparison, isGroundedBrainEnabled,
  GROUNDED_BRAIN_FLAG, GROUNDED_BRAIN_WORKSPACES_ENV, GROUNDED_BRAIN_MODE_ENV,
} from "../../../supabase/functions/_shared/groundedBrainBinding.ts";
import {
  buildWorkbenchExplanation, verifyGroundedResult, parseGroundedResult,
} from "../../../supabase/functions/_shared/groundedClaims.ts";
import type { CompiledActorCall } from "../../../supabase/functions/_shared/hiringActorInputs.ts";

const QUERY =
  "Find founders of SaaS startups hiring Sales Operations in the United States. Return 5 qualified leads.";
const WS = "ws-qa";

const env = (o: Record<string, string>): (k: string) => string | undefined =>
  (k) => o[k];

// ── engine fixtures ──────────────────────────────────────────────────────────

function ycRow(name: string, slug: string) {
  return {
    id: slug, name, website: `https://${slug}.com`,
    industry: "B2B", industries: ["B2B"], batch: "W22", teamSize: 42,
    oneLiner: `${name} sells electronic-design software to engineering teams.`,
    allLocations: "San Francisco, CA, USA",
    openJobs: [{ title: "Revenue Operations Manager", url: `https://x/${slug}/1` }],
  };
}
const ROWS: Record<string, Record<string, unknown>[]> = {
  apify_yc_companies_memo23: [ycRow("Sortly", "sortly")],
  apify_linkedin_company_search: [{
    id: "sortly", name: "Sortly",
    linkedinUrl: "https://www.linkedin.com/company/sortly",
    website: "https://sortly.com",
    description: "Sortly sells electronic-design software to engineering teams.",
    location: "San Francisco, CA",
  }],
  apify_linkedin_company_details: [{
    id: "sortly", name: "Sortly",
    linkedinUrl: "https://www.linkedin.com/company/sortly",
    website: "https://sortly.com", employeeCount: 42,
    description: "Sortly sells electronic-design software to engineering teams.",
    industries: [{ id: "4", name: "B2B SaaS", hierarchy: "Technology" }],
    locations: [{ linkedinText: "United States" }],
  }],
};

interface Recorder { calls: string[] }
function deps(rec: Recorder, over: Partial<CapabilityEngineDeps> = {}): CapabilityEngineDeps {
  return {
    invoke: (call: CompiledActorCall<unknown>) => {
      rec.calls.push(call.actorKey);
      return Promise.resolve(ROWS[call.actorKey] ?? []);
    },
    verifyEmployer: () => ({ verified: true, outcome: "verified_match" }),
    ...over,
  };
}
const mission = () => parseLeadMissionDeterministic(QUERY);
const BRAIN = {
  employee_min: 10, employee_max: 150,
  positive_industries: ["b2b saas"], excluded_industries: [] as string[],
  required_geography: null,
};

/** Run the engine, returning the companies and every registry it built. */
async function runWith(over: Partial<CapabilityEngineDeps>) {
  const rec: Recorder = { calls: [] };
  const m = mission();
  const run = await runCapabilityPlan(deps(rec, over), {
    mission: m, plan: buildCapabilityGraph(m), brain: BRAIN,
  });
  return { run, rec };
}

/** A legacy classifier that says PASS, so shadow disagreement is observable. */
const legacyPass: CapabilityEngineDeps["classifyCompany"] = () =>
  Promise.resolve({
    assessment: {
      business_model: "b2b_saas", company_fit: "pass", confidence: 0.9,
      agentory_use_case: "strong", supporting_evidence: ["sells software"],
      conflicting_evidence: [], unknown_fields: [], reason: "fits",
    },
    parse_status: "valid",
    raw_shape: { received_keys: [], repaired_fields: [], rejected_values: [] },
  } as never);

// ═════════════════════════════════════════════════════ 1-7. live wiring ══

Deno.test("1. the engine builds an evidence registry before semantic evaluation", async () => {
  const { run } = await runWith({ classifyCompany: legacyPass });
  const evaluated = run.companies.filter((c) => c.brain !== null);
  assert(evaluated.length > 0, "a company must have reached the Brain");
  for (const c of evaluated) {
    assert(c.evidence_registry, `${c.key}: a registry must exist`);
    assertEquals(c.evidence_registry!.company_key, c.key);
    assert(c.evidence_registry!.items.length > 0, "and it must hold evidence");
  }
});

Deno.test("2-3. the registry holds only normalized evidence, with no vendor names in ids", async () => {
  const { run } = await runWith({ classifyCompany: legacyPass });
  const reg = run.companies.find((c) => c.evidence_registry)!.evidence_registry!;
  // Embedded YC openings became job evidence.
  assert(reg.items.some((x) => x.evidence_type === "yc_job" || x.evidence_type === "job_posting"),
    "hiring evidence must become job-posting items");
  // Hard facts came from code, not from a model.
  assertEquals(reg.hard_facts.company_key, reg.company_key);
  assertEquals(reg.hard_facts.provider_failed, false);
  // NO VENDOR NAMES IN THE IDS — they are shown to the model to be cited.
  for (const item of reg.items) {
    for (const vendor of ["harvestapi", "memo23", "solidcode", "crawlworks", "apify"]) {
      assertFalse(item.evidence_id.toLowerCase().includes(vendor),
        `${item.evidence_id} leaks ${vendor}`);
    }
  }
});

Deno.test("4-6. the grounded verifier runs and its verdict reaches the Brain in enforce", async () => {
  const seen: string[] = [];
  const { run } = await runWith({
    classifyCompany: legacyPass,
    groundingMode: "enforce",
    groundCompany: ({ registry }) => {
      seen.push(registry.company_key);
      // A claim citing evidence that does not exist — must not qualify.
      const parsed = parseGroundedResult({
        business_model: {
          value: "b2b_saas", confidence: 0.95,
          claims: [{
            claim: "Sortly sells API subscriptions.", claim_type: "business_model",
            evidence_ids: ["company_description:linkedin:deadbeef"],
            evidence_excerpts: [],
          }],
        },
        company_fit: "pass", agentory_use_case: "strong",
        supporting_claims: [], confidence: 0.95, reason: "fits",
      });
      return Promise.resolve(verifyGroundedResult({ registry, result: parsed }));
    },
  });
  assert(seen.length > 0, "the grounder saw at least one company");
  const c = run.companies.find((x) => x.grounded)!;
  assert(c.grounded, "the verification is stored on the company");
  assertEquals(c.grounded!.final_grounded_decision, "review");
  // THE LEGACY CLASSIFIER SAID PASS. Enforce mode refuses to qualify anyway.
  assertEquals(c.brain?.outcome, "REVIEW",
    "an ungrounded pass cannot qualify under enforce");
  assert(c.brain!.reason.includes("held for review"),
    `the downgrade must state itself, got: ${c.brain!.reason}`);
});

Deno.test("7. the Workbench explanation is built from validated claims only", async () => {
  const { run } = await runWith({
    classifyCompany: legacyPass,
    groundingMode: "enforce",
    groundCompany: ({ registry }) => {
      const descId = registry.items
        .find((x) => x.evidence_type === "company_description")?.evidence_id ?? "none";
      const parsed = parseGroundedResult({
        business_model: {
          value: "b2b_software", confidence: 0.9,
          claims: [
            {
              claim: "Sortly sells electronic-design software.",
              claim_type: "business_model", evidence_ids: [descId],
              evidence_excerpts: [{ evidence_id: descId, excerpt: "electronic-design software" }],
            },
            {
              claim: "Sortly sells API subscriptions.", claim_type: "business_model",
              evidence_ids: [descId],
              evidence_excerpts: [{ evidence_id: descId, excerpt: "API subscriptions" }],
            },
          ],
        },
        company_fit: "pass", agentory_use_case: "strong",
        supporting_claims: [], confidence: 0.9, reason: "fits",
      });
      return Promise.resolve(verifyGroundedResult({ registry, result: parsed }));
    },
  });
  const c = run.companies.find((x) => x.grounded)!;
  const ui = JSON.stringify(buildWorkbenchExplanation(c.grounded!, c.evidence_registry!));
  assertFalse(ui.includes("API subscriptions"),
    "an invented claim must never reach the user");
  assert(ui.includes("electronic-design software"), "a grounded one does");
  // And the rejection survives internally.
  assert(c.grounded!.rejected_claims.some((r) => r.claim.includes("API subscriptions")));
});

// ═══════════════════════════════════════════════════ 8-14. feature flags ══

Deno.test("8-10. disabled, empty allow-list and non-listed workspace all stay legacy", () => {
  assertEquals(isGroundedBrainEnabled(WS, env({})).reason, "flag_off");
  assertEquals(
    isGroundedBrainEnabled(WS, env({ [GROUNDED_BRAIN_FLAG]: "true" })).reason,
    "no_workspace_allowlist");
  assertEquals(
    isGroundedBrainEnabled(WS, env({
      [GROUNDED_BRAIN_FLAG]: "true", [GROUNDED_BRAIN_WORKSPACES_ENV]: "someone-else",
    })).reason, "workspace_not_allowed");
  // Disabled means NO binding at all — not a binding that returns nothing.
  assertEquals(
    buildGroundedBrainBinding({ workspaceId: WS, read: env({}), originalUserQuery: null })
      .groundCompany, null);
});

Deno.test("11. an unrecognised or absent mode observes rather than enforces", () => {
  const allowed = {
    [GROUNDED_BRAIN_FLAG]: "true", [GROUNDED_BRAIN_WORKSPACES_ENV]: WS,
  };
  assertEquals(isGroundedBrainEnabled(WS, env(allowed)).mode, "shadow",
    "an absent mode must not enforce");
  assertEquals(
    isGroundedBrainEnabled(WS, env({ ...allowed, [GROUNDED_BRAIN_MODE_ENV]: "ENFORCED" })).mode,
    "shadow", "a misspelled mode must not enforce");
  assertEquals(
    isGroundedBrainEnabled(WS, env({ ...allowed, [GROUNDED_BRAIN_MODE_ENV]: "enforce" })).mode,
    "enforce");
});

Deno.test("11b. shadow mode does not change the user-facing decision", async () => {
  const grounder: CapabilityEngineDeps["groundCompany"] = ({ registry }) =>
    Promise.resolve(verifyGroundedResult({
      registry,
      result: parseGroundedResult({
        business_model: { value: "b2b_saas", confidence: 0.95, claims: [{
          claim: "invented", claim_type: "business_model",
          evidence_ids: ["nope:nope:nope"], evidence_excerpts: [],
        }] },
        company_fit: "pass", agentory_use_case: "strong",
        supporting_claims: [], confidence: 0.95, reason: "",
      }),
    }));

  const shadow = await runWith({
    classifyCompany: legacyPass, groundCompany: grounder, groundingMode: "shadow",
  });
  const enforce = await runWith({
    classifyCompany: legacyPass, groundCompany: grounder, groundingMode: "enforce",
  });
  const s = shadow.run.companies.find((c) => c.grounded)!;
  const e = enforce.run.companies.find((c) => c.grounded)!;

  // BOTH computed the same verification…
  assertEquals(s.grounded!.final_grounded_decision, "review");
  assertEquals(e.grounded!.final_grounded_decision, "review");
  // …and only ENFORCE let it change the outcome.
  assertEquals(s.brain?.outcome, "QUALIFIED", "shadow preserves the legacy verdict");
  assertEquals(e.brain?.outcome, "REVIEW", "enforce applies the grounded one");
});

Deno.test("12-13. in ENFORCE an unavailable grounder becomes REVIEW, never QUALIFIED", async () => {
  const { run } = await runWith({
    classifyCompany: legacyPass,
    groundingMode: "enforce",
    // The model was unavailable.
    groundCompany: () => Promise.resolve(null),
  });
  const c = run.companies.find((x) => x.brain)!;
  assertEquals(c.grounded, null);
  // NEVER A REJECTION — nobody is thrown away for an outage…
  assertFalse(c.brain!.outcome === "REJECT",
    "an unavailable grounder must never reject a company");
  // …and never an ungrounded QUALIFIED either. Falling back to the legacy
  // verdict would restore exactly the unchecked pass that enforcing exists to
  // prevent, at the moment there is least evidence it is deserved.
  assertEquals(c.brain!.outcome, "REVIEW");
  assert(c.brain!.reason.includes("grounded_classifier_unavailable"),
    `the outage must name itself, got: ${c.brain!.reason}`);
});

Deno.test("12b. in SHADOW an unavailable grounder leaves the legacy verdict alone", async () => {
  const { run } = await runWith({
    classifyCompany: legacyPass,
    groundingMode: "shadow",
    groundCompany: () => Promise.resolve(null),
  });
  const c = run.companies.find((x) => x.brain)!;
  assertEquals(c.brain!.outcome, "QUALIFIED",
    "shadow observes; it never degrades a decision");
});

Deno.test("14. a malformed grounded response cannot qualify a company", async () => {
  for (const junk of [null, "not json", 42, [], {}]) {
    const { run } = await runWith({
      classifyCompany: legacyPass,
      groundingMode: "enforce",
      groundCompany: ({ registry }) => Promise.resolve(verifyGroundedResult({
        registry, result: parseGroundedResult(junk),
      })),
    });
    const c = run.companies.find((x) => x.grounded)!;
    assertFalse(c.brain?.outcome === "QUALIFIED",
      `${JSON.stringify(junk)} must not qualify a company`);
  }
});

// ══════════════════════════════════════════════ shadow comparison shape ══

Deno.test("S1. the shadow comparison records the disagreement, not a transcript", () => {
  const reg = { company_key: "sortly", items: [], version: "lead-evidence-registry-v1",
    hard_facts: {} } as never;
  const grounded = verifyGroundedResult({
    registry: reg,
    result: parseGroundedResult({
      business_model: { value: "b2b_saas", confidence: 0.9, claims: [{
        claim: "x", claim_type: "business_model", evidence_ids: ["missing"],
        evidence_excerpts: [],
      }] },
      company_fit: "pass", agentory_use_case: "strong",
      supporting_claims: [], confidence: 0.9, reason: "",
    }),
  });
  const cmp = buildShadowComparison({
    companyKey: "sortly", legacyOutcome: "QUALIFIED", legacyConfidence: 0.9, grounded,
  });
  assertEquals(cmp.legacy_decision, "QUALIFIED");
  assertEquals(cmp.grounded_decision, "review");
  assert(cmp.disagreement);
  assert(cmp.user_facing_would_change);
  assertEquals(cmp.rejected_claim_count, 1);
  // BOUNDED AND STRUCTURED. No claim text, no prose, no reasoning.
  const keys = Object.keys(cmp).sort();
  assertEquals(keys.includes("disagreement_reason"), true);
  assertFalse(JSON.stringify(cmp).includes("chain_of_thought"));
  assert(String(cmp.disagreement_reason).length < 200);

  // An unavailable grounder is recorded as such, not as agreement.
  const none = buildShadowComparison({
    companyKey: "sortly", legacyOutcome: "QUALIFIED", legacyConfidence: 0.9, grounded: null,
  });
  assertEquals(none.grounded_decision, "unavailable");
  assertFalse(none.user_facing_would_change);
});

// ═════════════════════════════════════════════════════ 29-35. regression ══

Deno.test("29-32. the routes still work and people Actors stay unreachable", async () => {
  const { run, rec } = await runWith({ classifyCompany: legacyPass });
  // YC route still evaluates companies.
  assert(run.companies.length > 0);
  assert(run.companies.some((c) => c.brain !== null), "the Brain still decides");
  assert(rec.calls.includes("apify_yc_companies_memo23"));
  // Founder / contact Actors remain unreachable and uncalled.
  for (const actor of [
    "apify_linkedin_company_employees", "apify_people_search",
    "apify_linkedin_profile_search",
  ]) {
    assertFalse(rec.calls.includes(actor), `${actor} must not run`);
  }
  const plan = buildCapabilityGraph(mission());
  assertFalse(plan.allowed_providers.includes("apify_linkedin_company_employees"));
});

Deno.test("33-35. run-agent wires grounding without touching the protected file", async () => {
  const src = await Deno.readTextFile(
    new URL("../../../supabase/functions/run-agent/index.ts", import.meta.url));
  // The wiring exists…
  assert(src.includes("buildGroundedBrainBinding"), "the binding is constructed");
  assert(src.includes("groundCompany:"), "the engine receives the grounder");
  assert(src.includes("groundingMode: groundedBinding.mode"), "and the mode");
  assert(src.includes("grounded_brain_diagnostics"), "diagnostics are persisted");
  assert(src.includes("workbench_grounded_explanations"), "user-facing output is separate");
  // …and it draws on the EXISTING allowance rather than adding one.
  assert(src.includes("callsRemaining: classificationBinding.classificationCallsRemaining"),
    "no new model budget may be introduced by this stage");
  // No production, no mcp import.
  for (const line of src.split("\n")) {
    if (line.includes("wqnigjhcwjxtmordrwno")) {
      assert(line.trim().startsWith("//"), "production ref may appear only in a comment");
    }
  }
  assertFalse(/from\s+["'][^"']*\/mcp\//.test(src), "no import from mcp/");
});

// ══════════════════════════════ STAGE 1 — THE PRE-ENFORCE GATE ══
//
// The six conditions that had to hold before QA was switched from shadow to
// enforce. They are written as tests rather than as a checklist someone ticked,
// so flipping the mode back on in future re-checks them automatically.

Deno.test("G1. no claim may reference another company's evidence", async () => {
  const { run } = await runWith({
    classifyCompany: legacyPass, groundingMode: "enforce",
    groundCompany: ({ registry }) => {
      // An id built for a DIFFERENT company, in the correct format.
      const foreign = registry.items[0].evidence_id.replace(/:[0-9a-f]{8}$/, ":ffffffff");
      return Promise.resolve(verifyGroundedResult({
        registry,
        result: parseGroundedResult({
          business_model: { value: "b2b_saas", confidence: 0.9, claims: [{
            claim: "borrowed", claim_type: "business_model",
            evidence_ids: [foreign], evidence_excerpts: [],
          }] },
          company_fit: "pass", agentory_use_case: "strong",
          supporting_claims: [], confidence: 0.9, reason: "",
        }),
      }));
    },
  });
  const c = run.companies.find((x) => x.grounded)!;
  assertEquals(c.grounded!.validated_claims.length, 0);
  assertEquals(c.brain?.outcome, "REVIEW");
});

Deno.test("G2-G3. invented evidence never reaches Workbench, and cannot hold a PASS", async () => {
  const { run } = await runWith({
    classifyCompany: legacyPass, groundingMode: "enforce",
    groundCompany: ({ registry }) => {
      const d = registry.items
        .find((x) => x.evidence_type === "company_description")!.evidence_id;
      return Promise.resolve(verifyGroundedResult({
        registry,
        result: parseGroundedResult({
          business_model: { value: "b2b_saas", confidence: 0.95, claims: [{
            claim: "Sortly sells API subscriptions.", claim_type: "business_model",
            evidence_ids: [d],
            evidence_excerpts: [{ evidence_id: d, excerpt: "API subscriptions" }],
          }] },
          company_fit: "pass", agentory_use_case: "strong",
          supporting_claims: [], confidence: 0.95, reason: "",
        }),
      }));
    },
  });
  const c = run.companies.find((x) => x.grounded)!;
  assertEquals(c.brain?.outcome, "REVIEW", "an unsupported PASS does not stay PASS");
  const ui = JSON.stringify(buildWorkbenchExplanation(c.grounded!, c.evidence_registry!));
  assertFalse(ui.includes("API subscriptions"));
});

Deno.test("G4. a provider failure leaves the company unresolved, never rejected", async () => {
  const { run } = await runWith({
    classifyCompany: legacyPass, groundingMode: "enforce",
    groundCompany: ({ registry }) => Promise.resolve(verifyGroundedResult({
      registry,
      result: parseGroundedResult({
        business_model: { value: "unknown", confidence: 0.2, claims: [] },
        company_fit: "fail", agentory_use_case: "none",
        supporting_claims: [{
          claim: "The company is not hiring.", claim_type: "commercial_signal",
          evidence_ids: [], evidence_excerpts: [],
        }],
        confidence: 0.2, reason: "provider said nothing",
      }),
    })),
  });
  const c = run.companies.find((x) => x.grounded)!;
  // An unsupported FAIL is downgraded, not honoured.
  assertEquals(c.grounded!.final_grounded_decision, "review");
  assertFalse(c.brain?.outcome === "REJECT");
});

Deno.test("G5. a fully grounded company still qualifies under enforce", async () => {
  const { run } = await runWith({
    classifyCompany: legacyPass, groundingMode: "enforce",
    groundCompany: ({ registry }) => {
      const d = registry.items
        .find((x) => x.evidence_type === "company_description")!.evidence_id;
      const j = registry.items
        .find((x) => x.evidence_type === "yc_job" || x.evidence_type === "job_posting")!
        .evidence_id;
      return Promise.resolve(verifyGroundedResult({
        registry,
        result: parseGroundedResult({
          business_model: { value: "b2b_software", confidence: 0.9, claims: [{
            claim: "Sortly sells electronic-design software to engineering teams.",
            claim_type: "business_model", evidence_ids: [d],
            evidence_excerpts: [{ evidence_id: d, excerpt: "electronic-design software" }],
          }] },
          company_fit: "pass", agentory_use_case: "strong",
          supporting_claims: [{
            claim: "Hiring Revenue Operations Manager.", claim_type: "commercial_signal",
            evidence_ids: [j],
            evidence_excerpts: [{ evidence_id: j, excerpt: "Revenue Operations Manager" }],
          }],
          confidence: 0.9, reason: "B2B design software with a current opening",
        }),
      }));
    },
  });
  const c = run.companies.find((x) => x.grounded)!;
  assertEquals(c.grounded!.grounding_score, 1);
  assertEquals(c.brain?.outcome, "QUALIFIED",
    "enforcing must not break the case it is meant to allow");
});

Deno.test("G6. enforcing makes no people Actor reachable", async () => {
  const { rec } = await runWith({
    classifyCompany: legacyPass, groundingMode: "enforce",
    groundCompany: () => Promise.resolve(null),
  });
  for (const actor of [
    "apify_linkedin_company_employees", "apify_people_search",
    "apify_linkedin_profile_search",
  ]) {
    assertFalse(rec.calls.includes(actor), `${actor} must remain unreachable`);
  }
});

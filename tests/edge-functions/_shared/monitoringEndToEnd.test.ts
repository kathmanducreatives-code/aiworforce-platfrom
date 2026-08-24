// MONITORING, END TO END, WITH NO NETWORK AND NO MODEL.
//
// ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
//
// Phase 3F's acceptance gate is live: a workspace with zero Lead missions runs
// monitoring and gets a non-empty feed. That gate needs an OpenAI balance the
// account does not currently have — the discovery selector and the qualifying
// evaluator are both model calls.
//
// Everything BETWEEN those two model calls is deterministic, and this file
// proves it: a stored monitoring subject becomes a canonical `signal_event`,
// through the real compiler, the real capability graph, the real
// `runCapabilityPlan` and the real writer contract. The providers are mocked
// and the evaluator is a stub that answers exactly as the parser would; nothing
// else is substituted.
//
// So when credits return, what remains unproven is the two model calls
// themselves — not the path they sit in.
//
// ZERO network, ZERO Actor runs, ZERO model calls, ZERO database writes.

import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  runMonitoring, MONITORING_AUTHORITY,
} from "../../../supabase/functions/_shared/monitoringRunner.ts";
import {
  runCapabilityPlan, type CapabilityEngineDeps,
} from "../../../supabase/functions/_shared/leadCapabilityEngine.ts";
import { buildCapabilityGraph } from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";
import { parseMissionEvaluationStrict }
  from "../../../supabase/functions/_shared/missionEvaluation.ts";
import type { CompiledActorCall }
  from "../../../supabase/functions/_shared/hiringActorInputs.ts";

// ── THE PROVIDER ROWS, IN THEIR REAL SHAPES ─────────────────────────────────

const SEARCH_ROW = {
  id: "sortly", name: "Sortly",
  linkedinUrl: "https://www.linkedin.com/company/sortly",
  website: "https://sortly.com",
  description: "Sortly is a B2B SaaS platform sold on subscription.",
  location: "San Francisco, CA",
};
const ENRICH_ROW = {
  id: "sortly", name: "Sortly",
  linkedinUrl: "https://www.linkedin.com/company/sortly",
  website: "https://sortly.com", employeeCount: 42,
  description: "Sortly is a B2B SaaS platform sold on subscription.",
  industries: [{ id: "4", name: "B2B SaaS", hierarchy: "Technology" }],
  locations: [{ linkedinText: "United States" }],
};
const JOB_ROW = {
  id: "j1", title: "Revenue Operations Manager",
  company: { name: "Sortly", linkedinUrl: "https://www.linkedin.com/company/sortly" },
  postedDate: "2026-07-20",
};
const ROWS: Record<string, Record<string, unknown>[]> = {
  apify_linkedin_company_search: [SEARCH_ROW],
  apify_linkedin_company_details: [ENRICH_ROW],
  apify_linkedin_job_search: [JOB_ROW],
};

/**
 * The evaluator, stubbed at the PARSER — not past it.
 *
 * The stub writes a raw model response and hands it to the real
 * `parseMissionEvaluationStrict` with the real registry the engine built. That
 * matters: the parser refuses any citation not in the registry, so this stub
 * cannot pass a company on evidence the run does not hold. It stands in for the
 * model's words, never for the rule that checks them.
 */
function stubEvaluator() {
  // deno-lint-ignore no-explicit-any
  return ({ registry }: any) => {
    // deno-lint-ignore no-explicit-any
    const first = (registry as any).items?.[0] ?? null;
    const raw = {
      mission_fit: "pass", icp_fit: "strong", hiring_fit: "verified",
      confidence: 0.9, match_score: 88,
      // CITED FROM THE REGISTRY THE ENGINE BUILT, verbatim. The parser refuses
      // an excerpt that is not in its source, so a stub that paraphrases is
      // rejected exactly as a hallucinating model would be — which is what
      // makes this a stub for the model's words and not for the rule.
      matched_requirements: first
        ? [{
          requirement: "hiring commercial roles",
          evidence_id: first.evidence_id,
          excerpt: String(first.source_text ?? ""),
        }]
        : [],
      failed_requirements: [], reasoning: "the tracked company is hiring commercially",
      rejection_reasons: [], evidence_quality: "strong", unknown_fields: [],
    };
    return Promise.resolve(parseMissionEvaluationStrict(raw, registry));
  };
}

interface Written { input: Record<string, unknown> }

/** One monitoring pass over one tracked company, with everything real but I/O. */
async function monitorTrackedCompany(identifier: string) {
  const calls: string[] = [];
  const written: Written[] = [];

  const outcome = await runMonitoring(
    {
      workspace_id: "ws-zero-leads",
      subjects: [{
        kind: "tracked_company", identifier, label: identifier,
        signals: [{ event: "hiring", subject: "company" }], timeframe_days: 90,
      }],
      icp: null,
    },
    {
      buildPlan: buildCapabilityGraph as never,
      runPlan: async (mission, plan) => {
        const deps = {
          invoke: (call: CompiledActorCall<unknown>) => {
            calls.push(call.actorKey);
            return Promise.resolve(ROWS[call.actorKey] ?? []);
          },
          verifyEmployer: () => ({ verified: false, outcome: "not_attempted" }),
          evaluateMission: stubEvaluator(),
        } as unknown as CapabilityEngineDeps;
        // deno-lint-ignore no-explicit-any
        return await runCapabilityPlan(deps, { mission, plan, maxCandidates: 25 } as any) as any;
      },
      loadHeldEvidence: () => Promise.resolve([]),
      writeEvent: (input) => {
        written.push({ input: input as Record<string, unknown> });
        return Promise.resolve({ written: true });
      },
    },
  );
  return { outcome, calls, written };
}

// ═══════════════ 1. THE FEED A TRACKED COMPANY ACTUALLY PRODUCES ════════════

Deno.test("1. a tracked company becomes a canonical signal event", async () => {
  const { outcome, written } = await monitorTrackedCompany("sortly.com");

  assert(outcome.ok, `the run refused: ${outcome.refusal} — ${outcome.reason}`);
  assertEquals(outcome.accepted_subjects, 1);
  assertEquals(outcome.dropped_subjects, []);
  // THE GATE, IN ITS DETERMINISTIC HALF: a workspace that has never run a Lead
  // mission produced intelligence of its own.
  assertEquals(written.length, 1, "a watched company that is hiring must produce an event");
  assertEquals(outcome.events.written, 1);
});

Deno.test("2. the event says where it came from and what it is about", async () => {
  const { written } = await monitorTrackedCompany("sortly.com");
  const e = written[0].input;

  // ORIGIN — every event carries its provenance.
  assertEquals(e.origin, "scheduled_monitor");
  // SUBJECT — a real subject model, never a borrowed lead identity.
  assertEquals(e.subject_type, "company");
  assert(String(e.subject_key ?? "").length > 0, "an event must name its subject");
  // TIME — nobody reported when this happened, so nothing claims to know.
  assertEquals(e.occurred_at, null);
  assertEquals(e.occurred_at_basis, "unknown");
  // TYPE — the canonical vocabulary, not the subject's word for it.
  assertEquals(e.signal_type, "sales_hiring");
});

// ═══════════════ 3–5. THE BOUNDARIES, UNDER A RUN THAT SUCCEEDS ═════════════

Deno.test("3. a successful monitoring run still schedules no Lead terminal", async () => {
  const { outcome } = await monitorTrackedCompany("sortly.com");
  assertEquals(outcome.boundaries.lead_steps_scheduled, []);
  assertEquals(outcome.boundaries.authority, MONITORING_AUTHORITY);
  assertFalse(
    outcome.completed_capabilities.includes("persistence"),
    "monitoring completed the Lead persistence terminal",
  );
  for (const leadOnly of ["founder_discovery", "employer_verification", "contact_enrichment"]) {
    assertFalse(
      outcome.completed_capabilities.includes(leadOnly),
      `monitoring ran the Lead-only capability ${leadOnly}`,
    );
  }
});

Deno.test("4. it bought no discovery — the subject named the company", async () => {
  const { calls } = await monitorTrackedCompany("sortly.com");
  for (const discovery of ["apify_yc_companies_memo23", "apify_funding_rounds_datahyena"]) {
    assertFalse(calls.includes(discovery), `monitoring paid to discover: ${discovery}`);
  }
  // It DID pay for identity, which is the honest cost of proving who this is.
  assert(calls.includes("apify_linkedin_company_search"));
});

Deno.test("5. the capability that ran is the shared one, seeded by the engine", async () => {
  const { outcome } = await monitorTrackedCompany("sortly.com");
  assert(
    outcome.completed_capabilities.includes("known_company_resolution"),
    `the shared seeding capability must be what introduced the company: ${
      JSON.stringify(outcome.completed_capabilities)}`,
  );
  assert(outcome.completed_capabilities.includes("company_identity_resolution"));
});

// ═══════════════ 6. A NAME ALONE STILL PRODUCES NOTHING ═════════════════════

Deno.test("6. a subject named only by word produces no event, and no guess", async () => {
  // "Sortly" is a name. The search returns the real Sortly, and the identity
  // rule still refuses it — there is no domain to confirm the match against.
  // The right outcome is an empty feed, not a plausible one.
  const { outcome, written } = await monitorTrackedCompany("Sortly");

  assertEquals(written.length, 0, "an unconfirmed identity produced an event anyway");
  assertEquals(outcome.events.written, 0);
  // The run itself did not fail — it looked, and could not prove who this was.
  assert(outcome.ok);
});

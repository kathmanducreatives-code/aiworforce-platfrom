// A SIGNAL NOBODY INVESTIGATED CANNOT BE SATISFIED.
//
// ── WHY THIS IS THE MOST IMPORTANT GUARD IN QUALIFICATION ───────────────────
//
// Before this, `hiring_fit` was the only signal verdict the evaluator produced
// and its prompt is hiring-shaped. Everything else — funding, posts, expansion,
// product launch, technology — went through the generic requirement list, so a
// two-signal mission produced ONE signal answer and the model decided which one
// it was about.
//
// Worse, nothing compared the mission's required signals against the
// capabilities that actually RAN. `technology/company` resolved SUPPORTED with
// an approved provider and was never scheduled, so the Brain was asked to judge
// a technology signal from firmographics — and could answer.
//
// The rule these tests hold: a verdict is a function of TWO things, and code
// owns the first. Was it investigated at all, and did the investigation produce
// citable evidence. The model may only speak to the second.
//
// PURE. No network, provider, model or database access.

import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  assessSignals, verdictsClaimingUninvestigatedSignals, signalRequirementOutcome,
  provingCapabilities, isPositiveSignal, CAPABILITY_FOR_SIGNAL,
  type RequiredSignal,
} from "../../../supabase/functions/_shared/signalQualification.ts";
import {
  buildLeadVerdict, qualificationDecision, icpVerdictFrom, intentVerdictFrom,
} from "../../../supabase/functions/_shared/leadQualificationVerdict.ts";
import {
  SIGNAL_EVENTS,
} from "../../../supabase/functions/_shared/missionSignalDescriptor.ts";
import {
  CAPABILITY_IDS,
} from "../../../supabase/functions/_shared/leadCapabilityGraph.ts";

const sig = (event: string, subject = "company"): RequiredSignal =>
  ({ event, subject });

// ═══════════════ 1-4. CODE VETOES THE MODEL ════════════════════════════════

Deno.test("1. THE VETO: a claimed verdict on an uninvestigated signal is refused", () => {
  // The model has no way to know which steps ran. It says `verified`; nothing
  // investigated technology; the verdict must not stand.
  const [a] = assessSignals({
    required: [sig("technology")],
    completed: ["general_company_discovery", "company_enrichment"],
    modelVerdicts: { "technology/company": { verdict: "verified", evidence_ids: ["e1"] } },
  });
  assertEquals(a.verdict, "not_investigated");
  assertEquals(a.established_by, null);
  assertEquals(a.evidence_ids, []);
  assert(/would prove technology\/company and neither ran/.test(a.reason), a.reason);
  assertFalse(isPositiveSignal(a.verdict));
});

Deno.test("2. the same claim STANDS once the capability actually ran", () => {
  const [a] = assessSignals({
    required: [sig("technology")],
    completed: ["general_company_discovery", "technology_verification"],
    modelVerdicts: { "technology/company": { verdict: "verified", evidence_ids: ["e1"] } },
  });
  assertEquals(a.verdict, "verified");
  assertEquals(a.established_by, "technology_verification");
  assertEquals(a.evidence_ids, ["e1"]);
  assert(isPositiveSignal(a.verdict));
});

Deno.test("3. a POSITIVE verdict that cites nothing is downgraded", () => {
  // An uncited "verified" is the model's opinion, and the whole architecture
  // rests on the difference between an opinion and a citation.
  const [a] = assessSignals({
    required: [sig("funding")],
    completed: ["funding_signal_discovery"],
    modelVerdicts: { "funding/company": { verdict: "verified", evidence_ids: [] } },
  });
  assertEquals(a.verdict, "absent");
  assert(/cited no evidence/.test(a.reason), a.reason);
});

Deno.test("4. a PROVIDER FAILURE is not evidence of absence", () => {
  // `investigation_failed` and `absent` must stay distinct: one says the
  // question was never answered, the other says it was answered no.
  const [a] = assessSignals({
    required: [sig("expansion")],
    completed: [],
    failed: ["expansion_signal_discovery"],
  });
  assertEquals(a.verdict, "investigation_failed");
  assert(/this is not evidence of absence/.test(a.reason), a.reason);
  assertFalse(isPositiveSignal(a.verdict));

  // …and an EMPTY run is different again: it ran, so the model may judge it.
  const [b] = assessSignals({
    required: [sig("expansion")],
    completed: ["expansion_signal_discovery"],
    modelVerdicts: { "expansion/company": { verdict: "absent" } },
  });
  assertEquals(b.verdict, "absent");
  assertEquals(b.established_by, "expansion_signal_discovery");
});

Deno.test("5. EVERY signal gets its own verdict — no collapsing", () => {
  // The failure this replaces: one `hiring_fit` for a mission requiring two
  // different signals, with the model choosing which one it meant.
  const out = assessSignals({
    required: [sig("funding"), sig("post", "leadership"), sig("technology")],
    completed: ["funding_signal_discovery", "technology_verification"],
    modelVerdicts: {
      "funding/company": { verdict: "verified", evidence_ids: ["f1"] },
      "technology/company": { verdict: "absent" },
    },
  });
  assertEquals(out.length, 3);
  assertEquals(out.map((a) => `${a.signal}=${a.verdict}`), [
    "funding/company=verified",
    "post/leadership=not_investigated",
    "technology/company=absent",
  ]);
  // The person signal says WHY, and names authorisation rather than failure.
  const person = out.find((a) => a.signal === "post/leadership")!;
  assert(person.requires_unlock);
  assert(/user-authorised unlock/.test(person.reason));
});

// ═══════════════ 6-7. THE REQUIREMENT OUTCOME IS THREE-VALUED ══════════════

Deno.test("6. an uninvestigated signal makes the requirement UNKNOWN, not failed", () => {
  // The distinction that stops a capability gap becoming a verdict about a
  // company: "we never looked" must not read as "they do not have it".
  const unknown = signalRequirementOutcome(assessSignals({
    required: [sig("technology")], completed: ["general_company_discovery"],
  }));
  assertEquals(unknown.outcome, "unknown");
  assert(/cannot be judged either way/.test(unknown.reason));

  const notMet = signalRequirementOutcome(assessSignals({
    required: [sig("technology")], completed: ["technology_verification"],
    modelVerdicts: { "technology/company": { verdict: "absent" } },
  }));
  assertEquals(notMet.outcome, "not_met");

  const met = signalRequirementOutcome(assessSignals({
    required: [sig("technology")], completed: ["technology_verification"],
    modelVerdicts: { "technology/company": { verdict: "verified", evidence_ids: ["t1"] } },
  }));
  assertEquals(met.outcome, "met");

  // No signal required is MET, not unknown — nothing was asked for.
  assertEquals(signalRequirementOutcome([]).outcome, "met");
});

Deno.test("7. the violation reporter names every bogus claim", () => {
  const bogus = verdictsClaimingUninvestigatedSignals([
    { signal: "x/company", event: "x", subject: "company", verdict: "verified",
      established_by: null, evidence_ids: [], requires_unlock: false, reason: "" },
    { signal: "y/company", event: "y", subject: "company", verdict: "verified",
      established_by: "ran", evidence_ids: ["e"], requires_unlock: false, reason: "" },
  ]);
  assertEquals(bogus.length, 1);
  assert(/x\/company/.test(bogus[0]));
});

// ═══════════════ 8. ICP AND INTENT STAY APART ══════════════════════════════

Deno.test("8. ICP fit and signal fit are judged separately and never averaged", () => {
  const strongIcpNoSignal = buildLeadVerdict({
    icp_fit: "strong", icp_judgeable: true,
    signals: assessSignals({
      required: [sig("funding")], completed: ["funding_signal_discovery"],
      modelVerdicts: { "funding/company": { verdict: "absent" } },
    }),
  });
  assertEquals(strongIcpNoSignal.icp, "strong");
  assertEquals(strongIcpNoSignal.intent, "none");
  assertEquals(strongIcpNoSignal.band, "icp_only", "a normal outbound account");

  const signalOutsideIcp = buildLeadVerdict({
    icp_fit: "weak", icp_judgeable: true,
    signals: assessSignals({
      required: [sig("funding")], completed: ["funding_signal_discovery"],
      modelVerdicts: { "funding/company": { verdict: "verified", evidence_ids: ["f"] } },
    }),
  });
  // SIGNAL ALONE NEVER PROMOTES. Someone with the problem you solve is not a
  // prospect if you do not sell to them.
  assertEquals(signalOutsideIcp.band, "signal_outside_icp");

  const both = buildLeadVerdict({
    icp_fit: "strong", icp_judgeable: true,
    signals: assessSignals({
      required: [sig("funding")], completed: ["funding_signal_discovery"],
      modelVerdicts: { "funding/company": { verdict: "verified", evidence_ids: ["f"] } },
    }),
  });
  assertEquals(both.band, "priority");

  // NO SCORE ANYWHERE. A band is ordinal; a number invites arithmetic nobody
  // calibrated.
  assertFalse("score" in both);
  assertFalse("match_score" in both);
});

Deno.test("9. an unjudgeable half is reported, never rounded to zero", () => {
  assertEquals(icpVerdictFrom("strong", false), "insufficient_evidence");
  assertEquals(icpVerdictFrom(null, true), "insufficient_evidence");
  assertEquals(icpVerdictFrom("weak", true), "poor");

  // Nothing investigated ⇒ insufficient, NOT `none`. "We looked and they are
  // silent" is a finding; "we never looked" is our gap.
  assertEquals(intentVerdictFrom(assessSignals({
    required: [sig("post", "leadership")], completed: [],
  })), "insufficient_evidence");
  // No signal required at all ⇒ `none` is correct.
  assertEquals(intentVerdictFrom([]), "none");

  const v = buildLeadVerdict({
    icp_fit: "strong", icp_judgeable: true,
    signals: assessSignals({ required: [sig("technology")], completed: [] }),
  });
  assertEquals(v.band, "insufficient_evidence");
});

Deno.test("10. the DECISION follows ICP and signal, not a threshold", () => {
  const mk = (icp: "strong" | "weak", judgeable: boolean, completed: string[], verdict?: string) =>
    qualificationDecision(buildLeadVerdict({
      icp_fit: icp, icp_judgeable: judgeable,
      signals: assessSignals({
        required: [sig("funding")], completed,
        ...(verdict ? { modelVerdicts: { "funding/company": { verdict, evidence_ids: ["f"] } } } : {}),
      }),
    }));

  assertEquals(mk("strong", true, ["funding_signal_discovery"], "verified").decision, "qualified");
  assertEquals(mk("weak", true, ["funding_signal_discovery"], "verified").decision, "not_qualified");
  assertEquals(mk("strong", true, ["funding_signal_discovery"], "absent").decision, "not_qualified");
  // NEVER INVESTIGATED ⇒ insufficient. The run's gap must not be charged to the
  // company as a rejection.
  assertEquals(mk("strong", true, []).decision, "insufficient_evidence");
  assertEquals(mk("strong", false, ["funding_signal_discovery"], "verified").decision,
    "insufficient_evidence");
});

// ═══════════════ 11. THE MAP IS HONEST ABOUT THE GRAPH ═════════════════════

Deno.test("11. every proving capability is a REAL capability id", () => {
  // The map answers "was this investigated?" from `completed_capabilities`. A
  // typo'd id would silently never match, and every signal using it would read
  // as uninvestigated forever.
  const real = new Set<string>(CAPABILITY_IDS as readonly string[]);
  for (const [key, caps] of Object.entries(CAPABILITY_FOR_SIGNAL)) {
    for (const c of caps) {
      assert(real.has(c), `${key} names "${c}", which is not a capability id`);
    }
  }
});

Deno.test("12. every SIGNAL EVENT is either mapped or honestly unmapped", () => {
  // Not every event needs a capability — `headcount_change` is computed, and
  // person subjects are unlock-gated. What must not happen is an event silently
  // missing from the map AND from the reasoning, because it would resolve to
  // `not_investigated` with a reason nobody wrote.
  for (const e of SIGNAL_EVENTS) {
    const caps = provingCapabilities(sig(e));
    const [a] = assessSignals({ required: [sig(e)], completed: [] });
    assert(a.reason.length > 0, `${e} produced a verdict with no reason`);
    if (caps.length === 0) {
      assertEquals(a.verdict, "not_investigated", e);
    }
  }
});

// THE GATE THAT DECIDES WHO WE ARE WILLING TO SPEND ON.
//
// ── THE RUN THIS EXISTS FOR ────────────────────────────────────────────────
//
// Lineage a5c1616e, the canonical acceptance mission on run-agent v164:
//
//     99 discovered → 81 after mission intelligence → 51 after employee size
//     51 enriched → 14 hiring-verified → 14 evaluated → 1 qualified
//
// Of the 13 refused, SEVEN carried `hiring_fit: verified`, ZERO failed
// requirements, a clean domain, and one unknown field — "Whether <company> is
// specifically a B2B SaaS company". Metaview scored 86 at confidence 0.94.
// They were refused because the registry held nothing citable about a business
// model, not because anything about them was wrong.
//
// This gate is the deterministic half of the fix: it must pick exactly those
// candidates and nobody else. Picking the 30 excluded on employee size, or the
// 27 whose hiring was refuted, would spend money on companies that cannot
// qualify no matter what a web page says.
//
// ZERO network, ZERO DB, ZERO model, ZERO provider spend.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  computeEvidenceDebts,
  type DebtCandidate,
} from "../../supabase/functions/_shared/webEvidenceDebt.ts";
import type { MissionEvaluation } from "../../supabase/functions/_shared/missionEvaluation.ts";

// ─────────────────────────────── fixtures ───────────────────────────────────

function evaluation(o: Partial<MissionEvaluation> = {}): MissionEvaluation {
  return {
    version: "mission-evaluation-v1",
    decision: "insufficient_evidence",
    mission_fit: "review",
    icp_fit: "plausible",
    hiring_fit: "verified",
    confidence: 0.94,
    match_score: 86,
    matched_requirements: [],
    failed_requirements: [],
    reasoning: "…",
    rejection_reasons: [],
    evidence_quality: "strong",
    unknown_fields: ["Whether Metaview is specifically a B2B SaaS company"],
    next_action: null,
    ...o,
  } as MissionEvaluation;
}

function company(
  key: string,
  o: Partial<DebtCandidate> = {},
): DebtCandidate {
  return {
    key,
    company: { company_name: key },
    enriched: { company_name: key, canonical_domain: `${key}.com` },
    mission_evaluation: evaluation(),
    identity: { status: "verified_match" },
    known_evidence_types: ["company_industry", "employee_count"],
    ...o,
  };
}

const BUDGET = { max_companies: 5 };

// ───────────────────────────────── tests ────────────────────────────────────

Deno.test("T-1 a company that already qualified is never researched", () => {
  const r = computeEvidenceDebts(
    [company("metaview", {
      mission_evaluation: evaluation({ decision: "qualified" }),
    })],
    BUDGET,
  );
  assertEquals(r.debts.length, 0);
  assertEquals(r.skip_counts["already_decided"], 1);
});

Deno.test("T-1b a rejected company is answered, not researched", () => {
  const r = computeEvidenceDebts(
    [company("x", {
      mission_evaluation: evaluation({ decision: "not_qualified" }),
    })],
    BUDGET,
  );
  assertEquals(r.debts.length, 0);
  assertEquals(r.skip_counts["already_decided"], 1);
});

Deno.test("T-2 a contradicted requirement is not a debt", () => {
  // The evidence ANSWERED the question and the answer was no. Buying pages to
  // argue with it is a second opinion, not evidence.
  const r = computeEvidenceDebts(
    [company("twine", {
      mission_evaluation: evaluation({
        failed_requirements: [{
          requirement: "Company is a B2B SaaS company",
          evidence_id: "company_industry:linkedin:33eaca42",
          why: "description describes a freelance marketplace",
        }],
      }),
    })],
    BUDGET,
  );
  assertEquals(r.debts.length, 0);
  assertEquals(r.skip_counts["requirement_contradicted"], 1);
});

Deno.test("T-2b hiring-refuted candidates are never researched", () => {
  // The 27 companies in a5c1616e whose hiring was refuted. Proving a business
  // model does not give them an open sales role.
  const refuted = ["a", "b", "c"].map((k) =>
    company(k, {
      mission_evaluation: evaluation({ hiring_fit: "absent" }),
    })
  );
  const r = computeEvidenceDebts(refuted, BUDGET);
  assertEquals(r.debts.length, 0);
  assertEquals(r.skip_counts["hiring_not_verified"], 3);
});

Deno.test("T-11 a cheaper hard-constraint failure short-circuits research", () => {
  // A company excluded on employee size never reaches the evaluator, so it
  // arrives with no evaluation at all — and must cost nothing.
  const r = computeEvidenceDebts(
    [company("too-big", { mission_evaluation: null })],
    BUDGET,
  );
  assertEquals(r.debts.length, 0);
  assertEquals(r.skip_counts["not_evaluated"], 1);
});

Deno.test("ambiguous identity blocks research", () => {
  // Attributing a fetched page to the WRONG company is worse than no evidence.
  for (const status of ["ambiguous", "mismatch", "unresolved"]) {
    const r = computeEvidenceDebts(
      [company("x", { identity: { status } })],
      BUDGET,
    );
    assertEquals(r.debts.length, 0, `status ${status} must not be researched`);
    assertEquals(r.skip_counts["identity_unresolved"], 1);
  }
});

Deno.test("no domain means no research, and stays truthful", () => {
  const r = computeEvidenceDebts(
    [company("x", { enriched: { canonical_domain: null } })],
    BUDGET,
  );
  assertEquals(r.debts.length, 0);
  assertEquals(r.skip_counts["no_domain"], 1);
});

Deno.test("an evaluator that named no unknown gives nothing to ask", () => {
  // Inventing a question here would be this module deciding meaning, which is
  // the model's job, not code's.
  const r = computeEvidenceDebts(
    [company("x", { mission_evaluation: evaluation({ unknown_fields: [] }) })],
    BUDGET,
  );
  assertEquals(r.debts.length, 0);
  assertEquals(r.skip_counts["no_open_question"], 1);
});

Deno.test("the viable blocked candidate IS a debt, carrying the open question verbatim", () => {
  const r = computeEvidenceDebts([company("metaview")], BUDGET);
  assertEquals(r.debts.length, 1);
  const d = r.debts[0];
  assertEquals(d.company_key, "metaview");
  assertEquals(d.domain, "metaview.com");
  // VERBATIM. Nothing parsed it, matched it, or classified it.
  assertEquals(
    d.open_question,
    "Whether Metaview is specifically a B2B SaaS company",
  );
  assert(d.requirement_id.length > 0);
});

Deno.test("T-3 the gate is generic — no requirement wording is special", () => {
  // Four unrelated requirement phrasings. The gate must treat them identically,
  // because it never reads them.
  const questions = [
    "Whether the company is specifically a B2B SaaS company",
    "Whether the company sells to banks",
    "Whether the company uses Salesforce",
    "Whether the company recently expanded into Europe",
  ];
  const r = computeEvidenceDebts(
    questions.map((q, i) =>
      company(`c${i}`, {
        mission_evaluation: evaluation({ unknown_fields: [q] }),
      })
    ),
    BUDGET,
  );
  assertEquals(r.debts.length, 4);
  // Every question produced a debt, and each got its OWN requirement identity.
  assertEquals(new Set(r.debts.map((d) => d.requirement_id)).size, 4);
  assertEquals(r.debts.map((d) => d.open_question).sort(), [...questions].sort());
});

Deno.test("the same requirement in two missions shares one identity", () => {
  // This collision is deliberate: it is what lets a later mission reuse an
  // earlier verdict rather than re-buying the same research.
  const a = computeEvidenceDebts(
    [company("x", {
      mission_evaluation: evaluation({ unknown_fields: ["Whether it is B2B SaaS"] }),
    })],
    BUDGET,
  );
  const b = computeEvidenceDebts(
    [company("x", {
      mission_evaluation: evaluation({
        // Same requirement, different case and spacing.
        unknown_fields: ["  whether it is   b2b saas  "],
      }),
    })],
    BUDGET,
  );
  assertEquals(a.debts[0].requirement_id, b.debts[0].requirement_id);
});

Deno.test("T-6 an already-researched requirement is not re-requested", () => {
  const first = computeEvidenceDebts([company("metaview")], BUDGET);
  const rid = first.debts[0].requirement_id;
  const second = computeEvidenceDebts([company("metaview")], {
    ...BUDGET,
    already_researched: new Set([`metaview:${rid}`]),
  });
  assertEquals(second.debts.length, 0);
});

Deno.test("budget caps debts and keeps the strongest candidates", () => {
  const pool = [
    company("weak", { mission_evaluation: evaluation({ match_score: 40 }) }),
    company("best", { mission_evaluation: evaluation({ match_score: 95 }) }),
    company("mid", { mission_evaluation: evaluation({ match_score: 70 }) }),
  ];
  const r = computeEvidenceDebts(pool, { max_companies: 2 });
  assertEquals(r.debts.length, 2);
  assertEquals(r.debts.map((d) => d.company_key), ["best", "mid"]);
  assertEquals(r.skip_counts["budget_exhausted"], 1);
});

Deno.test("the a5c1616e shape: 7 of 99 selected, and nobody else", () => {
  // A miniature of the real pool: excluded-on-size, hiring-refuted, already
  // qualified, and the blocked-but-viable seven.
  const pool: DebtCandidate[] = [
    // 30 excluded on employee size — never evaluated.
    ...Array.from({ length: 30 }, (_, i) =>
      company(`size-${i}`, { mission_evaluation: null })),
    // 27 hiring-refuted.
    ...Array.from({ length: 27 }, (_, i) =>
      company(`refuted-${i}`, {
        mission_evaluation: evaluation({ hiring_fit: "absent" }),
      })),
    // 1 qualified.
    company("neota-logic", {
      mission_evaluation: evaluation({ decision: "qualified" }),
    }),
    // 7 blocked but viable.
    ...["metaview", "hebbia", "kody", "pump", "inevent", "volody", "gloat"].map(
      (k) => company(k),
    ),
  ];
  const r = computeEvidenceDebts(pool, { max_companies: 7 });

  assertEquals(r.debts.length, 7);
  assertEquals(
    r.debts.map((d) => d.company_key).sort(),
    ["gloat", "hebbia", "inevent", "kody", "metaview", "pump", "volody"],
  );
  assertEquals(r.skip_counts["not_evaluated"], 30);
  assertEquals(r.skip_counts["hiring_not_verified"], 27);
  assertEquals(r.skip_counts["already_decided"], 1);
  // Every one of the 65 non-debts is accounted for, exactly like the funnel's
  // own `unaccounted` invariant.
  assertEquals(r.debts.length + r.skipped.length, pool.length);
});

Deno.test("the gate is pure — same input, same output", () => {
  const pool = [company("a"), company("b")];
  const one = computeEvidenceDebts(pool, BUDGET);
  const two = computeEvidenceDebts(pool, BUDGET);
  assertEquals(JSON.stringify(one), JSON.stringify(two));
});

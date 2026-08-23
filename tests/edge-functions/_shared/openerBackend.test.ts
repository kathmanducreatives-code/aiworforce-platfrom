import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  resolveOutputMode,
  DEFAULT_OUTPUT_MODE,
  buildPersonalizationContext,
  brainContextFromProfile,
  assessOpenerEligibility,
  generateOpener,
  validateOpener,
  buildOpenerStagePayload,
  buildOpenerObservability,
  DEFAULT_OPENER_CONSTRAINTS,
  PROHIBITED_PHRASES,
  type ModelBoundary,
  type PersonalizationContext,
} from "../../../supabase/functions/_shared/workbench/openerBackend.ts";
import { emptyAccountState, applyStageUpdate } from "../../../supabase/functions/_shared/workbench/accountState.ts";
import { buildOpenerPrompt } from "../../../supabase/functions/_shared/workbench/openerModel.ts";

const LEAD = "00000000-0000-4000-8000-000000000002";
const WS = "00000000-0000-4000-8000-000000000001";
const T = "2026-07-19T12:00:00.000Z";

const BRAIN = {
  positioning: "Synthetic revenue tooling for small GTM teams",
  target_outcomes: ["book more qualified meetings"],
  prohibited_claims: ["guaranteed results"],
  voice: "plain and direct",
};

/** Account with usable research AND a verified decision-maker. */
function readyAccount(opts: { research?: boolean; person?: boolean } = {}) {
  let a = emptyAccountState(LEAD);
  if (opts.research !== false) {
    a = applyStageUpdate(a, "company_research", {
      status: "succeeded",
      payload: {
        summary: "Synthetic platform for logistics teams.",
        evidence_urls: ["https://nimbusforge.example/about"],
        missing_evidence: [],
        confidence: "high",
        usable: true,
      },
    }, T);
  }
  if (opts.person !== false) {
    a = applyStageUpdate(a, "decision_makers", {
      status: "succeeded",
      payload: {
        verified_count: 1,
        manual_review_count: 0,
        primary_full_name: "Ada Kestrel",
        primary_linkedin_url: "https://www.linkedin.com/in/synthetic-ada",
        primary_role_family: "founder",
        primary_company_name: "Nimbus Forge",
        primary_verification_methods: ["company_linkedin_url"],
        contact_id: "c1",
      },
    }, T);
  }
  return a;
}

function ctxFor(opts: { research?: boolean; person?: boolean; brain?: unknown; fresh?: boolean } = {}): PersonalizationContext {
  return buildPersonalizationContext({
    lead_candidate_id: LEAD,
    company_name: "Nimbus Forge",
    industry: "logistics",
    account: readyAccount(opts),
    brain_profile: opts.brain === undefined ? BRAIN : opts.brain,
    icp_matched_criteria: ["Industry"],
    job_posting: opts.fresh === undefined ? null : { role: "Revenue Operations Associate", fresh: opts.fresh },
  });
}

/** Deterministic model stub — no provider is ever reached. */
function stubModel(resp: { opener: string; alternative_opener?: string; used_evidence_ids?: string[] }) {
  let calls = 0;
  const fn: ModelBoundary = async () => { calls += 1; return resp; };
  return { fn, calls: () => calls };
}

const GOOD_OPENER =
  "Noticed Nimbus Forge builds logistics tooling for operations teams, and wanted to ask how you are handling qualified pipeline today.";

// ===========================================================================
// REQUEST CONTRACT
// ===========================================================================

Deno.test("output mode is EXPLICIT — never inferred", () => {
  assertEquals(resolveOutputMode("personalized_opener"), "personalized_opener");
  assertEquals(resolveOutputMode("full_draft"), "full_draft");
  // Absent / unknown / truthy-but-wrong all resolve to the safe legacy default.
  assertEquals(resolveOutputMode(undefined), DEFAULT_OUTPUT_MODE);
  assertEquals(resolveOutputMode(null), DEFAULT_OUTPUT_MODE);
  assertEquals(resolveOutputMode("opener"), DEFAULT_OUTPUT_MODE);
  assertEquals(resolveOutputMode(true), DEFAULT_OUTPUT_MODE);
  assertEquals(DEFAULT_OUTPUT_MODE, "full_draft", "absent mode must preserve legacy behaviour");
});

// ===========================================================================
// CONTEXT
// ===========================================================================

Deno.test("context carries only sanitized facts — no pages, payloads or contacts", () => {
  const ctx = ctxFor({ fresh: true });
  const s = JSON.stringify(ctx);
  assert(!/@[a-z]+\.(com|io|ai)\b/i.test(s), "no email-like strings");
  assert(!s.includes("<html"), "no page bodies");
  assert(!s.includes("apiKey") && !s.includes("Bearer "));
  // Source domains only — never a full scraped body.
  assertEquals(ctx.evidence[0].source_domain, "nimbusforge.example");
  assertEquals(ctx.decision_maker?.first_name, "Ada");
});

Deno.test("no saved brain → unavailable, and generic defaults are NOT substituted", () => {
  assertEquals(brainContextFromProfile(null).available, false);
  assertEquals(brainContextFromProfile({}).available, false);
  assertEquals(brainContextFromProfile(BRAIN).available, true);
  assertEquals(brainContextFromProfile(BRAIN).outcomes[0], "book more qualified meetings");
});

Deno.test("a stale job posting stays in context but is NOT allowed to ground a claim", () => {
  const stale = ctxFor({ fresh: false });
  const job = stale.evidence.find((e) => e.source_type === "job_posting");
  assert(job, "stale posting is still visible");
  assertEquals(job!.allowed, false, "stale evidence may not back a claim");
});

// ===========================================================================
// ELIGIBILITY
// ===========================================================================

Deno.test("full context + fresh signal → ready / specific", () => {
  const e = assessOpenerEligibility(ctxFor({ fresh: true }), false);
  assertEquals(e.status, "ready");
  assertEquals(e.reason_code, "ready");
  assertEquals(e.personalization_depth, "specific");
});

Deno.test("no fresh trigger → company_level, NOT blocked, and no invented why-now", () => {
  const e = assessOpenerEligibility(ctxFor({ fresh: false }), false);
  assertEquals(e.status, "downgraded");
  assertEquals(e.reason_code, "downgraded_company_level");
  assertEquals(e.personalization_depth, "company_level");
  assert(e.status !== "blocked", "an absent trigger must never block outreach");
});

Deno.test("specific blockers name the actual missing requirement", () => {
  assertEquals(
    assessOpenerEligibility(ctxFor({ person: false }), false).reason_code,
    "blocked_missing_verified_person",
  );
  assertEquals(
    assessOpenerEligibility(ctxFor({ brain: null }), false).reason_code,
    "blocked_missing_company_brain",
  );
  assertEquals(
    assessOpenerEligibility(ctxFor({ fresh: true }), true).reason_code,
    "blocked_icp_disqualified",
  );
});

// ═══ DEEP RESEARCH IMPROVES A DRAFT; IT NO LONGER GATES ONE ════════════════

Deno.test("missing deep research DOWNGRADES a draft — it no longer blocks it", () => {
  // ── WHAT THIS USED TO ASSERT ─────────────────────────────────────────────
  //
  // `research: false` → `blocked_missing_company_research`. So a lead with a
  // verified buyer, a coherent Company Brain and a fresh dated trigger could
  // not be written to until a Firecrawl crawl had been PURCHASED — a premium
  // unlock standing in front of the product's core action, discarding the
  // qualification and signal evidence the user had already paid for.
  const e = assessOpenerEligibility(ctxFor({ research: false, fresh: true }), false);

  assertEquals(e.status, "downgraded", "a real trigger is writable without a crawl");
  assertEquals(e.reason_code, "downgraded_no_research");
  // A DATED TRIGGER STILL EARNS `specific`. Deep research raises confidence in
  // what a company DOES; it does not supply a reason to write today.
  assertEquals(e.personalization_depth, "specific");
  // …and it names the unlock that would improve it, so the Workbench can offer
  // the right button instead of a generic "add more evidence".
  assertEquals(e.missing_requirements, ["company_research"]);
});

Deno.test("THE FLOOR: nothing grounded at all is still a block", () => {
  // ── WHERE THE LINE MOVED TO, AND WHERE IT DID NOT ────────────────────────
  //
  // Relaxing the research gate must not become "always draft". This fixture has
  // no crawl, no dated trigger and no company-site or sourcing evidence — so
  // there is genuinely nothing to write from, and a draft here could only be
  // invented. That is the one state that must still refuse.
  //
  // Note the reason code: `blocked_no_grounded_evidence`, not
  // `blocked_missing_company_research`. The difference matters to a user, who
  // would otherwise be sent to buy a crawl when what they actually lack is any
  // evidence at all.
  const e = assessOpenerEligibility(ctxFor({ research: false }), false);
  assertEquals(e.status, "blocked");
  assertEquals(e.reason_code, "blocked_no_grounded_evidence");
  assertEquals(e.personalization_depth, "none");
  assertEquals(e.missing_requirements, ["grounded_evidence"]);
});

Deno.test("the retired block is emitted by NOTHING", () => {
  // `blocked_missing_company_research` is kept in the union so historical rows
  // stay parseable, and must never be produced again. Asserted across the whole
  // matrix of fixture states rather than a single case, because a reintroduced
  // block would most likely appear in one branch and not the others.
  for (const research of [true, false]) {
    for (const person of [true, false]) {
      for (const fresh of [undefined, true, false]) {
        const ctx = ctxFor({
          research, person, ...(fresh === undefined ? {} : { fresh }),
        });
        for (const icp of [true, false]) {
          const e = assessOpenerEligibility(ctx, icp);
          assert(e.reason_code !== "blocked_missing_company_research",
            `research=${research} person=${person} fresh=${fresh} icp=${icp} ` +
            `still blocks on missing research`);
        }
      }
    }
  }
});

Deno.test("research WITHOUT a trigger stays company_level, as before", () => {
  // Unchanged behaviour, asserted so the new grading did not quietly promote
  // a crawl into a why-now. "I read your website" is not a trigger.
  const e = assessOpenerEligibility(ctxFor({}), false);
  assertEquals(e.status, "downgraded");
  assertEquals(e.reason_code, "downgraded_company_level");
  assertEquals(e.personalization_depth, "company_level");
  assertEquals(e.missing_requirements, ["fresh_timing_signal"]);
});

Deno.test("a verified person is STILL required — that gate did not move", () => {
  // Relaxing the research gate must not relax the person gate. A draft with no
  // verified recipient is a template, and the whole chain exists to avoid one.
  const e = assessOpenerEligibility(ctxFor({ person: false, research: false }), false);
  assertEquals(e.status, "blocked");
  assertEquals(e.reason_code, "blocked_missing_verified_person");
  assertEquals(e.personalization_depth, "none");
});

Deno.test("an ICP disqualifier overrides an otherwise ready account", () => {
  const e = assessOpenerEligibility(ctxFor({ fresh: true }), true);
  assertEquals(e.status, "blocked");
  assertEquals(e.allowed_evidence_ids.length, 0);
});

// ===========================================================================
// MODEL + VALIDATION
// ===========================================================================

Deno.test("a blocked lead makes ZERO model calls — that is why it costs nothing", async () => {
  const ctx = ctxFor({ person: false });
  const e = assessOpenerEligibility(ctx, false);
  const m = stubModel({ opener: GOOD_OPENER });
  const r = await generateOpener(ctx, e, m.fn);
  assertEquals(m.calls(), 0);
  assertEquals(r.status, "blocked");
  assertEquals(r.reason_code, "blocked_missing_verified_person");
  assertEquals(r.model_calls, 0);
  assertEquals(r.sent, false);
  assertEquals(r.approval_required, true);
});

Deno.test("a valid opener succeeds, approval-required and never sent", async () => {
  const ctx = ctxFor({ fresh: true });
  const e = assessOpenerEligibility(ctx, false);
  const r = await generateOpener(ctx, e, stubModel({ opener: GOOD_OPENER, used_evidence_ids: ["research_1"] }).fn);
  assertEquals(r.status, "succeeded");
  assertEquals(r.approval_required, true);
  assertEquals(r.approval_status, "draft");
  assertEquals(r.sent, false);
  assert(r.validation?.ok);
  assertEquals(r.used_evidence_ids, ["research_1"]);
});

Deno.test("an evidence id the model invents FAILS the message", async () => {
  // Previously the unknown id was dropped and the opener shipped. A message may
  // be grounded in something that does not exist, so this is now a contract
  // violation rather than a detail to quietly discard.
  const ctx = ctxFor({ fresh: true });
  const e = assessOpenerEligibility(ctx, false);
  const r = await generateOpener(ctx, e, stubModel({ opener: GOOD_OPENER, used_evidence_ids: ["research_1", "made_up_9"] }).fn);
  assertEquals(r.status, "failed_validation");
  assert(r.validation?.violations.includes("unknown_evidence_id"));
});

Deno.test("length, sentence and question limits are enforced", () => {
  const ctx = ctxFor({ fresh: true });
  const e = assessOpenerEligibility(ctx, false);

  // Limits were raised so a message can carry observation + bridge + CTA; the
  // ENFORCEMENT is what this test covers, not the specific numbers.
  const tooLong = "word ".repeat(120).trim();
  assert(validateOpener(tooLong, ctx, e).violations.includes("too_long_chars"));

  const fourSentences = "One thing here now. Two things here now. Three things here now. Four things here now.";
  assert(validateOpener(fourSentences, ctx, e).violations.includes("too_many_sentences"));

  const twoQuestions = "Are you hiring now? Or maybe later this year?";
  assert(validateOpener(twoQuestions, ctx, e).violations.includes("too_many_questions"));
});

Deno.test("email structure is rejected — this path never produces a draft", () => {
  const ctx = ctxFor({ fresh: true });
  const e = assessOpenerEligibility(ctx, false);
  for (const [text, label] of [
    ["Subject: quick question about pipeline", "email_structure_subject_line"],
    ["Great to connect with the team here. Best regards, Sam", "email_structure_signature"],
    ["Dear Ada, I wanted to reach you about pipeline", "email_structure_letter_greeting"],
    ["Thanks for the time today everyone. [Your Name]", "email_structure_signature_placeholder"],
  ] as const) {
    assert(validateOpener(text, ctx, e).violations.includes(label), `${label} not caught`);
  }
});

Deno.test("prohibited phrases are rejected", () => {
  const ctx = ctxFor({ fresh: true });
  const e = assessOpenerEligibility(ctx, false);
  for (const bad of [
    "I came across your profile and wanted to connect about your pipeline today.",
    "Hope you're doing well — quick question about your revenue operations hiring.",
    "Our AI SDR can replace your sales team and 10x your pipeline this quarter.",
    "We'll send these automatically to every prospect in your segment today.",
  ]) {
    const v = validateOpener(bad, ctx, e);
    assert(v.violations.some((x) => x.startsWith("prohibited:")), `not rejected: ${bad}`);
    assertEquals(v.ok, false);
  }
});

Deno.test("a Company Brain prohibited claim is rejected", () => {
  const ctx = ctxFor({ fresh: true });
  const e = assessOpenerEligibility(ctx, false);
  const v = validateOpener("We offer guaranteed results for logistics revenue teams everywhere today.", ctx, e);
  assert(v.violations.some((x) => x === "prohibited:brain:guaranteed results"));
});

Deno.test("a fabricated event claim with no evidence is rejected", () => {
  // No job posting at all → a hiring claim has nothing to stand on.
  const ctx = ctxFor({ fresh: undefined });
  const e = assessOpenerEligibility(ctx, false);
  const v = validateOpener(
    "Saw that Nimbus Forge just raised a Series A and is hiring quickly across the revenue team.",
    ctx, e,
  );
  assertEquals(v.ok, false);
  assert(v.violations.includes("unsupported_event_claim"));
  assert(v.unsupported_claims.length > 0);
});

Deno.test("a STALE signal may not be described as current", () => {
  const ctx = ctxFor({ fresh: false });
  const e = assessOpenerEligibility(ctx, false);
  const v = validateOpener(
    "Noticed Nimbus Forge is hiring a revenue operations associate and wanted to ask about pipeline.",
    ctx, e,
  );
  assertEquals(v.ok, false, "a stale posting must not ground a present-tense hiring claim");
});

Deno.test("a company-level opener may not assert a timing trigger", () => {
  const ctx = ctxFor({ fresh: false });
  const e = assessOpenerEligibility(ctx, false);
  assertEquals(e.personalization_depth, "company_level");
  const v = validateOpener("Nimbus Forge is expanding the revenue team, so wanted to ask how pipeline is tracking.", ctx, e);
  assert(v.violations.includes("timing_claim_without_specific_depth") || v.violations.includes("unsupported_event_claim"));
});

Deno.test("failed validation never becomes a usable draft", async () => {
  const ctx = ctxFor({ fresh: true });
  const e = assessOpenerEligibility(ctx, false);
  const r = await generateOpener(ctx, e, stubModel({ opener: "Subject: hi there friend, hope you're doing well today" }).fn);
  assertEquals(r.status, "failed_validation");
  assertEquals(r.opener, undefined, "an invalid opener is not returned as content");
  assertEquals(r.sent, false);
});

Deno.test("an invalid ALTERNATIVE is dropped while the primary survives", async () => {
  const ctx = ctxFor({ fresh: true });
  const e = assessOpenerEligibility(ctx, false);
  const r = await generateOpener(ctx, e, stubModel({
    opener: GOOD_OPENER,
    alternative_opener: "Hope you're doing well!",
    used_evidence_ids: ["research_1"],
  }).fn);
  assertEquals(r.status, "succeeded");
  assertEquals(r.alternative_opener, undefined);
});

Deno.test("provider failures stay distinct and sanitized", async () => {
  const ctx = ctxFor({ fresh: true });
  const e = assessOpenerEligibility(ctx, false);
  const cases: Array<[string, string]> = [
    ["request timed out", "timed_out"],
    ["no api key configured", "unavailable"],
    ["boom", "failed"],
  ];
  for (const [msg, expected] of cases) {
    const failing: ModelBoundary = async () => { throw new Error(`https://api.example/v1?token=SECRET ${msg}`); };
    const r = await generateOpener(ctx, e, failing);
    assertEquals(r.status, expected as never, msg);
    assert(!JSON.stringify(r).includes("SECRET"), "raw provider text must not propagate");
  }
});

Deno.test("empty model output is a failure, not an empty opener", async () => {
  const ctx = ctxFor({ fresh: true });
  const e = assessOpenerEligibility(ctx, false);
  const r = await generateOpener(ctx, e, stubModel({ opener: "   " }).fn);
  assertEquals(r.status, "failed");
  assertEquals(r.reason_code, "empty_model_output");
});

// ===========================================================================
// PROMPT SAFETY
// ===========================================================================

Deno.test("the prompt carries no raw pages, payloads or contact data", () => {
  const ctx = ctxFor({ fresh: true });
  const e = assessOpenerEligibility(ctx, false);
  const { system, user } = buildOpenerPrompt({
    personalization_context: ctx, eligibility: e, constraints: DEFAULT_OPENER_CONSTRAINTS,
  });
  const all = `${system}\n${user}`;
  assert(!/@[a-z]+\.(com|io|ai)\b/i.test(all), "no emails");
  assert(!all.includes("linkedin.com/in/"), "no profile URLs");
  assert(!all.includes("<html"), "no page bodies");
  // It DOES instruct the model not to write an email.
  assert(/do NOT write emails/i.test(system));
  assert(/STRICT JSON/i.test(system));
});

Deno.test("with no timing observation the prompt says so explicitly", () => {
  const ctx = ctxFor({ fresh: undefined });
  const e = assessOpenerEligibility(ctx, false);
  const { user } = buildOpenerPrompt({ personalization_context: ctx, eligibility: e, constraints: DEFAULT_OPENER_CONSTRAINTS });
  assert(/No timing observation is available/i.test(user));
});

// ===========================================================================
// PERSISTENCE
// ===========================================================================

Deno.test("stage payload is approval-only and never sent", async () => {
  const ctx = ctxFor({ fresh: true });
  const e = assessOpenerEligibility(ctx, false);
  const r = await generateOpener(ctx, e, stubModel({ opener: GOOD_OPENER }).fn);
  const payload = buildOpenerStagePayload(r, T);
  assertEquals(payload.output_mode, "personalized_opener");
  assertEquals(payload.approval_required, true);
  assertEquals(payload.approval_status, "draft");
  assertEquals(payload.sent, false);
  assertEquals(payload.generated_at, T);
});

Deno.test("a failed retry preserves the previous valid opener", async () => {
  const ctx = ctxFor({ fresh: true });
  const e = assessOpenerEligibility(ctx, false);
  const ok = await generateOpener(ctx, e, stubModel({ opener: GOOD_OPENER, used_evidence_ids: ["research_1"] }).fn);

  let acct = applyStageUpdate(readyAccount(), "outreach", {
    status: "succeeded", payload: buildOpenerStagePayload(ok, T),
  }, T);

  // A later failure records the attempt but must not erase the opener.
  acct = applyStageUpdate(acct, "outreach", { status: "failed", reason_code: "provider_failed", payload: null }, "2026-07-19T13:00:00.000Z");

  assertEquals(acct.outreach.status, "failed");
  assertEquals((acct.outreach.last_success as { opener: string }).opener, GOOD_OPENER);
  // And every other stage is intact.
  assert(acct.company_research.last_success);
  assert(acct.decision_makers.last_success);
});

// ===========================================================================
// OBSERVABILITY
// ===========================================================================

Deno.test("telemetry is sanitized — no prompts, responses or contact data", async () => {
  const ctx = ctxFor({ fresh: true });
  const e = assessOpenerEligibility(ctx, false);
  const r = await generateOpener(ctx, e, stubModel({ opener: GOOD_OPENER, used_evidence_ids: ["research_1"] }).fn);
  const obs = buildOpenerObservability({
    lead_candidate_id: LEAD, workspace_id: WS, ctx, eligibility: e, result: r, persisted: true,
  });
  assertEquals(obs.sent, false);
  assertEquals(obs.model_calls, 1);
  assertEquals(obs.validation_ok, true);
  const s = JSON.stringify(obs);
  assert(!s.includes(GOOD_OPENER), "the opener text is not telemetry");
  assert(!s.includes("linkedin.com"), "no profile URLs");
  assert(!/@[a-z]+\.(com|io|ai)\b/i.test(s));
});

// ===========================================================================
// DRIFT GUARD — the mirrored rules must match the frontend source
// ===========================================================================

const FRONTEND_SRC = await Deno.readTextFile(new URL("../../../src/lib/outreachOpener.ts", import.meta.url));

Deno.test("DRIFT: backend constraints match src/lib/outreachOpener.ts", () => {
  for (const [key, value] of Object.entries(DEFAULT_OPENER_CONSTRAINTS)) {
    const re = new RegExp(`${key}:\\s*${value}\\b`);
    assert(re.test(FRONTEND_SRC), `constraint ${key}=${value} diverged from the frontend contract`);
  }
});

Deno.test("DRIFT: every backend prohibited phrase exists in the frontend list", () => {
  for (const re of PROHIBITED_PHRASES) {
    assert(
      FRONTEND_SRC.includes(re.source),
      `prohibited phrase missing from the frontend contract: ${re.source}`,
    );
  }
});

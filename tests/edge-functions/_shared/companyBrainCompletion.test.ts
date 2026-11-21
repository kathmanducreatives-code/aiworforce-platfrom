// COMPANY BRAIN V2 · B2.0 — truthful assessment, free suggestions, and the one
// save path they share. Fictional profiles only.
import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { assessCompanyBrain, SECTION_SPECS } from "../../../supabase/functions/_shared/companyBrainAssessment.ts";
import {
  acceptSuggestionPatch, buildCompletionPatch, buildCompletionSuggestions, type StoredResearchRun,
} from "../../../supabase/functions/_shared/companyBrainCompletion.ts";
import { planBrainUpdate, sanitizeCompletionPatch } from "../../../supabase/functions/_shared/companyBrainUpdate.ts";
import { computeCompanyBrainCompleteness } from "../../../supabase/functions/_shared/companyBrainCompleteness.ts";
import { companyBrainReadiness } from "../../../supabase/functions/_shared/companyBrainReadiness.ts";
import { normalizeCompanyBrain } from "../../../supabase/functions/_shared/normalizeCompanyBrain.ts";
import { compilerBrainContext, contractBrainInput } from "../../../supabase/functions/_shared/leadPipeline/brainContext.ts";

type Raw = Record<string, unknown>;
const FIX = JSON.parse(await Deno.readTextFile(new URL("../../fixtures/company-brain/atlas-contract-profiles.json", import.meta.url))).profiles as Record<string, Raw>;
/** The production Brain's SHAPE (fictional values): ICP complete; goals, positioning, voice, GTM, evidence empty. */
const LIVE: Raw = {
  ...FIX.live_shape,
  goals: { gtm: "", content: "", competitor_tracking: "", outreach: "", hiring: "" },
  gtm: { motion: "", primary_channel: "", preferred_channels: [], biggest_bottleneck: "", current_tools: [], thirty_day_goal: "" },
  positioning: { promise: "", differentiators: [], use_cases: [], proof_points: [], offer: "", pricing: "", avoid_positioning: [] },
  brand_voice: { tone: "", tags: [], style_rules: [], avoid: [], example_message: "" },
  evidence: { source_pages: [], linkedin_sources: [], confidence_notes: [] },
  jobs_to_watch: [], content_angles: [], positive_examples: [], negative_examples: [],
};
const status = (a: ReturnType<typeof assessCompanyBrain>) => Object.fromEntries(a.sections.map((s) => [s.key, s.status]));
const update = (existing: Raw, patch: Raw) =>
  planBrainUpdate({ existing, currentUpdatedAt: "v1", expectedUpdatedAt: "v1", patch, alreadyActive: true });

Deno.test("B2.0: the live shape is reported truthfully — activation says complete, the assessment does not", () => {
  // The old signal: every activation slot met, nothing "missing".
  const activation = computeCompanyBrainCompleteness(normalizeCompanyBrain(LIVE));
  assert(activation.complete);
  assertEquals(activation.missing, []);
  // The truthful view.
  const a = assessCompanyBrain(LIVE);
  assertEquals(status(a), {
    company: "complete", target_customer: "complete", buyers: "complete", goals: "missing", positioning: "missing",
    qualification: "incomplete", signals: "incomplete", competitors: "missing", brand_voice: "missing", gtm: "missing",
    evidence: "missing", examples: "missing",
  });
  assertEquals(a.stage, "foundation");
  assertEquals(a.next, "goals");
  assertEquals(a.required, { complete: 3, total: 7 });
  assertEquals(a.optional, { complete: 0, total: 5 });
  // Qualification names exactly what it lacks.
  assertEquals(a.sections.find((s) => s.key === "qualification")!.missing.map((m) => m.path),
    ["qualification_rules.reject_if", "qualification_rules.required_evidence"]);
});

Deno.test("B2.0: nothing that works today is blocked — readiness and activation are unchanged by the assessment", () => {
  const before = companyBrainReadiness(normalizeCompanyBrain(LIVE), true);
  assessCompanyBrain(LIVE);
  assertEquals(companyBrainReadiness(normalizeCompanyBrain(LIVE), true), before);
  assertEquals(before.state, "ready");
});

Deno.test("B2.0: goals are complete with any two goals — not every company has all five", () => {
  const one = assessCompanyBrain({ ...LIVE, goals: { gtm: "x" } }).sections.find((s) => s.key === "goals")!;
  assertEquals(one.status, "incomplete");
  const two = assessCompanyBrain({ ...LIVE, goals: { gtm: "x", hiring: "y" } }).sections.find((s) => s.key === "goals")!;
  assertEquals(two.status, "complete");
  assertEquals(two.missing, []);
});

Deno.test("B2.0: empty and fully completed Brains", () => {
  const empty = assessCompanyBrain({});
  assert(empty.sections.every((s) => s.status === "missing"));
  assertEquals(empty.score, 0);
  const full = assessCompanyBrain({
    ...LIVE,
    goals: { gtm: "10 meetings a month", outreach: "50 replies a month" }, gtm: { motion: "founder-led sales", primary_channel: "LinkedIn", biggest_bottleneck: "Finding fit", thirty_day_goal: "First 5 customers" },
    positioning: { promise: "A workforce, not a tool", offer: "Pilot", differentiators: ["Human approval"], proof_points: ["3 pilots"] },
    qualification_rules: { reject_if: ["No website"], required_evidence: ["Open sales role"], manual_review_if: [] },
    jobs_to_watch: ["SDR"], competitors: ["Clay"], brand_voice: { tone: "Direct", style_rules: ["Short"], avoid: ["Hype"] },
    evidence: { source_pages: ["https://northwind.example/about"], confidence_notes: ["Pricing confirmed by founder"] },
    positive_examples: ["Acme"], negative_examples: ["MegaCorp"],
  });
  assertEquals(full.stage, "enriched");
  assertEquals(full.score, 100);
  assertEquals(full.next, null);
  assertEquals(full.unverified, 0, "proof points with a source on record are not flagged");
});

Deno.test("B2.0: unverified only where the data says so", () => {
  const claims = assessCompanyBrain({ ...LIVE, positioning: { promise: "x", proof_points: ["We doubled pipeline"] } });
  const pos = claims.sections.find((s) => s.key === "positioning")!;
  assertEquals(pos.issues.map((i) => i.kind), ["unverified"]);
  const draft = assessCompanyBrain({ ...LIVE, is_draft: true });
  assert(draft.is_draft);
  assert(draft.sections.filter((s) => s.tier === "required").every((s) => s.issues.some((i) => i.kind === "unverified")));
  assertEquals(assessCompanyBrain(LIVE).unverified, 0);
});

Deno.test("B2.0: conflicts passed in are attached to their section and counted", () => {
  const a = assessCompanyBrain(LIVE, { conflicts: [{ id: "x", section: "target_customer", message: "m", paths: ["p"] }] });
  assertEquals(a.conflicts, 1);
  assertEquals(a.sections.find((s) => s.key === "target_customer")!.issues, [{ kind: "conflicting", message: "m", paths: ["p"] }]);
});

// ── suggestions ──────────────────────────────────────────────────────────────
const RESEARCH: StoredResearchRun[] = [
  { source_type: "company_website", status: "completed", created_at: "2026-08-16T10:00:00Z", output: {
    description: "AI workforce for small B2B teams", positioning_claims: ["Your AI sales team", "Human approval on every send"],
    proof_points: ["Used by 3 pilot teams"], source_pages: ["https://northwind.example/", "https://northwind.example/pricing"],
    integrations: ["HubSpot"], understanding: { main_promise: "Your AI sales team", competitors_or_tools_mentioned: ["Clay", "HubSpot"], ambiguous: false },
  } },
  { source_type: "company_website", status: "completed", created_at: "2026-08-01T10:00:00Z", output: { description: "OLDER RUN" } },
  { source_type: "company_website", status: "failed", created_at: "2026-09-01T10:00:00Z", output: { description: "FAILED RUN" } },
];

Deno.test("B2.0: suggestions only for EMPTY fields — a person's value is never challenged", () => {
  const sugs = buildCompletionSuggestions(LIVE, RESEARCH);
  const paths = sugs.map((s) => s.path);
  // Filled by the person: no suggestion, even though research has an opinion (description).
  for (const filled of ["company.description", "company.business_model", "buyer_personas", "pain_points", "triggers", "target_customer.industries", "target_customer.disqualifiers"]) {
    assertFalse(paths.includes(filled), filled);
  }
  // Empty: suggested, from the latest COMPLETED run, with its pages.
  const promise = sugs.find((s) => s.path === "positioning.promise")!;
  assertEquals(promise.value, "Your AI sales team");
  assertEquals(promise.source.kind, "website_research");
  assertEquals(promise.source.urls, ["https://northwind.example/", "https://northwind.example/pricing"]);
  assertEquals(sugs.find((s) => s.path === "positioning.differentiators")!.value, ["Human approval on every send"]);
  // A tool the site integrates with is not offered as a competitor; the rest is flagged as a hypothesis.
  const comp = sugs.find((s) => s.path === "competitors")!;
  assertEquals(comp.value, ["Clay"]);
  assertEquals(comp.confidence, "low");
  assert(comp.source.caution);
  assertEquals(sugs.find((s) => s.path === "evidence.source_pages")!.value, ["https://northwind.example/", "https://northwind.example/pricing"]);
  // Goals and GTM have no honest source.
  assertFalse(paths.some((p) => p.startsWith("goals.") || p.startsWith("gtm.")));
  // Qualification rules come from the standard rules, labelled as such.
  assertEquals(sugs.find((s) => s.path === "qualification_rules.reject_if")!.source.kind, "brain_inference");
});

Deno.test("B2.0: no research stored → no research suggestions; ambiguous research is flagged", () => {
  assertFalse(buildCompletionSuggestions(LIVE, []).some((s) => s.source.kind === "website_research"));
  const amb = buildCompletionSuggestions(LIVE, [{ ...RESEARCH[0], output: { ...(RESEARCH[0].output as Raw), ambiguous: true } }]);
  const promise = amb.find((s) => s.path === "positioning.promise")!;
  assertEquals(promise.confidence, "low");
  assert(promise.source.caution);
});

// ── the one save path ───────────────────────────────────────────────────────
Deno.test("B2.0: accepting suggestions and typing values save through the authorized update, and reassess", () => {
  const sugs = buildCompletionSuggestions(LIVE, RESEARCH);
  let profile: Raw = LIVE;
  for (const p of ["positioning.promise", "competitors", "evidence.source_pages", "qualification_rules.reject_if", "qualification_rules.required_evidence"]) {
    const plan = update(profile, acceptSuggestionPatch(profile, sugs.find((s) => s.path === p)!));
    assert(plan.ok, `${p}: ${!plan.ok && plan.detail}`);
    profile = plan.profile;
  }
  const typed = update(profile, buildCompletionPatch(profile, { "goals.gtm": "10 qualified meetings a month", "gtm.motion": "founder-led sales" }));
  assert(typed.ok, !typed.ok ? typed.detail : "");
  profile = typed.profile;
  assertEquals((profile.goals as Raw).gtm, "10 qualified meetings a month");
  // Untouched goal fields survive the partial patch.
  assertEquals(Object.keys(profile.goals as Raw).sort(), ["competitor_tracking", "content", "gtm", "hiring", "outreach"]);
  assertEquals((profile.gtm as Raw).motion, "founder-led sales");
  assertEquals(normalizeCompanyBrain(profile).competitors, ["Clay"]);
  const a = assessCompanyBrain(profile);
  assertEquals(a.sections.find((s) => s.key === "goals")!.status, "incomplete");
  assertEquals(a.sections.find((s) => s.key === "qualification")!.status, "complete");
  assertEquals(a.sections.find((s) => s.key === "evidence")!.status, "incomplete");
});

Deno.test("B2.0: an edited suggestion saves the person's version; list suggestions add to what is there", () => {
  const sug = buildCompletionSuggestions(LIVE, RESEARCH).find((s) => s.path === "positioning.differentiators")!;
  const patch = acceptSuggestionPatch(LIVE, sug, ["Human approval on every send", "Built for founders"]);
  assertEquals((patch.positioning as Raw).differentiators, ["Human approval on every send", "Built for founders"]);
  const withOne = { ...LIVE, competitors: ["Apollo"] };
  const add = acceptSuggestionPatch(withOne, { ...sug, path: "competitors", value: ["Clay"] });
  assertEquals(add.competitors, ["Apollo", "Clay"]);
});

Deno.test("B2.0: disqualifier patches keep the finer buckets; size labels set bounds", () => {
  const p = buildCompletionPatch(LIVE, { "target_customer.disqualifiers": ["Gambling", "Tobacco"] });
  const d = (p.target_customer as Raw).disqualifiers as Raw;
  assertEquals(d.industries, ["Gambling", "Tobacco"]);
  assertEquals(d.company_types, ["Agencies"]);
  assertEquals(d.titles, ["Intern"]);
  const size = buildCompletionPatch({}, { "target_customer.company_size": "11-50" });
  assertEquals((size.target_customer as Raw).company_size, { min: 11, max: 50, label: "11-50" });
});

Deno.test("B2.0: the update path refuses anything but the known goal / GTM / evidence fields", () => {
  for (const [patch, why] of [
    [{ goals: { revenue_target: "1M" } }, "unknown goal field"],
    [{ goals: { gtm: 5 } }, "non-text goal"],
    [{ gtm: { preferred_channels: "LinkedIn" } }, "list given as text"],
    [{ evidence: { source_pages: [1] } }, "non-text list item"],
    [{ evidence: "https://x" }, "not an object"],
  ] as const) {
    const plan = update(LIVE, patch as Raw);
    assertFalse(plan.ok, why);
    assert(!plan.ok && plan.reason === "invalid_patch", why);
  }
  const clean = sanitizeCompletionPatch("gtm", { preferred_channels: [" LinkedIn ", "linkedin", "", "Email"] });
  assert(clean.ok);
  assertEquals(clean.ok && clean.value, { preferred_channels: ["LinkedIn", "Email"] });
});

Deno.test("B2.0: completing goals, GTM, positioning and evidence never changes what ATLAS reads", () => {
  const before = { a: compilerBrainContext(LIVE), b: contractBrainInput(LIVE) };
  const plan = update(LIVE, buildCompletionPatch(LIVE, {
    "goals.gtm": "x", "gtm.motion": "outbound", "positioning.promise": "p", "evidence.source_pages": ["https://e.example"],
    "brand_voice.tone": "Direct", "qualification_rules.reject_if": ["No website"],
  }));
  assert(plan.ok);
  assertEquals({ a: compilerBrainContext(plan.profile), b: contractBrainInput(plan.profile) }, before);
});

Deno.test("B2.0: every section's fields are assessed by a real reader (no path silently reads empty)", () => {
  const full: Raw = {
    schema_version: 2, company: { name: "n", description: "d", business_model: "m" },
    target_customer: { industries: ["i"], business_models: ["b"], geography: ["g"], company_size: { min: 1, max: 2, label: "1-2" }, disqualifiers: { industries: ["x"] } },
    buyer_personas: ["p"], pain_points: ["q"], triggers: ["t"], jobs_to_watch: ["j"], competitors: ["c"],
    positive_examples: ["e"], negative_examples: ["f"],
    goals: { gtm: "g", outreach: "o", content: "c", competitor_tracking: "t", hiring: "h" },
    gtm: { motion: "m", primary_channel: "c", biggest_bottleneck: "b", thirty_day_goal: "g" },
    positioning: { promise: "p", offer: "o", differentiators: ["d"] },
    qualification_rules: { reject_if: ["r"], required_evidence: ["e"] },
    brand_voice: { tone: "t", style_rules: ["s"], avoid: ["a"] },
    evidence: { source_pages: ["https://s"], confidence_notes: ["n"] },
  };
  const a = assessCompanyBrain(full);
  for (const s of a.sections) assertEquals(s.status, "complete", s.key);
  assertEquals(a.sections.length, SECTION_SPECS.length);
});

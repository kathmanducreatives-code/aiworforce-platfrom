// A LINK IS A PAGE, NOT A COMPANY NAME.
//
// ── THE DEFECT THIS SURFACE FIXES ──────────────────────────────────────────
//
// "Analyse https://stripe.com/jobs" is `research` — a fresh look at one thing
// the user named. Without a route of its own it took the lead path, and
// `projectToLeadMission` puts a reference's value into `known_companies`. Then
// `scanProposalForViolations` — the scan that refuses ANY url in a proposal,
// because a proposal that can name a URL can name a provider — raised
// `url:known_companies[0]`, compilation was blocked, and the user was told the
// request could not be turned into a run.
//
// Measured, not assumed: test 1 reproduces that refusal against the real
// projection and the real scan.
//
// ── AND THE REGEX THAT IS ALLOWED TO STAY ──────────────────────────────────
//
// Three regexes used to answer "is there a URL in this message?" — in
// `workflowClassifier`, `intentRouter` and `toolInputPlanner` — each over the
// RAW SENTENCE, each deciding what the user meant. `asAnalysableUrl` runs over
// `reference.value`, a field Chat Brain produced by already deciding the user
// was pointing at that thing. It asks what FORM a structured value takes, which
// is what `resolveCompanyIdentity` asks of a domain. That is validation, not
// interpretation.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  asAnalysableUrl, planUrlAnalysis,
} from "../../../supabase/functions/_shared/urlAnalysisSurface.ts";
import { routeRequest } from "../../../supabase/functions/_shared/objectiveRouter.ts";
import { bindRoute } from "../../../supabase/functions/_shared/chatBrainBinding.ts";
import { projectToLeadMission } from "../../../supabase/functions/_shared/projectToLeadMission.ts";
import { scanProposalForViolations } from "../../../supabase/functions/_shared/leadMissionCompiler.ts";
import {
  REQUEST_V1_VERSION, type RequestV1, type RequestObjective, type RequestReference,
} from "../../../supabase/functions/_shared/requestV1.ts";

const req = (
  objective: RequestObjective, references: RequestReference[],
  shape: "records" | "answer" = "records",
): RequestV1 => ({
  version: REQUEST_V1_VERSION, utterance: "Analyse this page", objective,
  parts: [{
    id: "p1", objective,
    subject: { entity: "company", references },
    output: { shape, count: null },
  }],
  ambiguity: [],
  authority: { may_spend: false, max_cost_units: null, requires_confirmation: true },
  provenance: {}, confidence: 0.9,
});

const PAGE = "https://stripe.com/jobs";

// ══ 1. THE DEFECT, REPRODUCED ══════════════════════════════════════════════

Deno.test("1. a URL in a proposal IS refused — which is why it must not get there", () => {
  // The safety scan is not weakened by any of this. It still refuses the URL;
  // the fix is that the URL never reaches a proposal.
  const p = projectToLeadMission(req("research", [{ kind: "named", value: PAGE }]));
  assertEquals(p.proposal.known_companies, [PAGE]);
  const violations = scanProposalForViolations(p.proposal);
  assertEquals(violations.length, 1);
  assertEquals(violations[0].kind, "url");
  assertEquals(violations[0].path, "known_companies[0]");
});

Deno.test("2. the router takes the page BEFORE the lead projection", () => {
  const route = routeRequest(req("research", [{ kind: "named", value: PAGE }]),
    { spendAllowed: true });
  assertEquals(route.kind, "url_analysis");
  assertEquals(route.url!.url, PAGE);
  assertEquals(route.lead, undefined, "no proposal is built, so none can carry a URL");
  assertEquals(bindRoute(route).kind, "url_analysis");
});

// ══ 2. A DOMAIN IS NOT A PAGE ══════════════════════════════════════════════

Deno.test("3. a bare hostname stays on the lead path", () => {
  // "stripe.com" identifies a COMPANY and belongs to identity resolution.
  // Treating it as a page would send every named company to Firecrawl.
  assertEquals(asAnalysableUrl("stripe.com"), null);
  assertEquals(asAnalysableUrl("Stripe"), null);
  assertEquals(asAnalysableUrl(""), null);
  assertEquals(asAnalysableUrl(null), null);
  assertEquals(asAnalysableUrl("https://notadomain/x"), null, "a host must be a host");

  const route = routeRequest(req("research", [{ kind: "named", value: "stripe.com" }]),
    { spendAllowed: true });
  assertEquals(route.kind, "lead_mission");
});

Deno.test("4. only research reads a page", () => {
  // A `read` quoting a URL asks what is already held about it and must reach no
  // provider. A `source` request describes a population with no single page.
  assertEquals(planUrlAnalysis(req("read", [{ kind: "named", value: PAGE }])).url, null);
  assertEquals(planUrlAnalysis(req("source", [{ kind: "named", value: PAGE }])).url, null);
  assertEquals(planUrlAnalysis(req("research", [{ kind: "named", value: PAGE }])).url, PAGE);

  const readRoute = routeRequest(req("read", [{ kind: "named", value: PAGE }], "answer"),
    { spendAllowed: true });
  assertEquals(readRoute.may_spend, false, "a read may never spend, URL or not");
});

Deno.test("5. a conversational referent is never treated as a page", () => {
  // `prior_result` values are pronouns and ordinals. Resolving them is the
  // referent resolver's job; this surface must not claim them.
  assertEquals(
    planUrlAnalysis(req("research", [{ kind: "prior_result", value: "them" }])).url, null);
  assertEquals(
    planUrlAnalysis(req("research", [
      { kind: "prior_result", value: PAGE },
    ])).url, null, "even a referent that looks like a link is still a referent");
});

// ══ 3. SPEND STAYS WHERE IT WAS ════════════════════════════════════════════

Deno.test("6. the page fetch needs the caller's authority like any research", () => {
  const allowed = routeRequest(req("research", [{ kind: "named", value: PAGE }]),
    { spendAllowed: true });
  const refused = routeRequest(req("research", [{ kind: "named", value: PAGE }]),
    { spendAllowed: false });
  assertEquals(allowed.may_spend, true);
  assertEquals(refused.may_spend, false, "nothing in the request may raise authority");
  assertEquals(refused.kind, "url_analysis", "and the route is unchanged by it");
});

// ══ 4. NO SENTENCE IS RE-READ ══════════════════════════════════════════════

Deno.test("7. the URL comes from the reference, never from the message", async () => {
  const src = await Deno.readTextFile(
    new URL("../../../supabase/functions/_shared/urlAnalysisSurface.ts", import.meta.url));
  const code = src.split("\n")
    .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
  assertFalse(/utterance\s*\.\s*match|utterance\s*\)\s*\.test|\.test\(\s*request\.utterance/.test(code),
    "the surface must not scan the raw sentence for a link");
  assert(code.includes("part.subject.references"),
    "it reads the references Chat Brain produced");
});

Deno.test("8. pilot-chat reaches Firecrawl only through the route", async () => {
  const pilot = await Deno.readTextFile(
    new URL("../../../supabase/functions/pilot-chat/index.ts", import.meta.url));
  const brainAt = pilot.indexOf("══ START OF THE CHAT BRAIN BLOCK");
  const baselineAt = pilot.indexOf("══ END OF THE CHAT BRAIN BLOCK", brainAt);
  const block = pilot.slice(brainAt, baselineAt);
  assert(block.includes('brainRoute.kind === "url_analysis"'),
    "the page route must be handled inside the understood path");
  assert(block.includes('"firecrawl_scrape_url"'),
    "and carry the same actor the legacy planner produced");
});

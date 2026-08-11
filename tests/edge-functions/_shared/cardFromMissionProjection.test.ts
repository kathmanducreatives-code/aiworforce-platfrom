// THE CONFIRMATION CARD IS DESCRIBED FROM THE MISSION.
//
// The card is what the user APPROVES. Every semantic field on it used to come
// from `extractLeadIntent(prompt)` — role family, persona, industry, geography,
// stage, count — and its qualified-lead route from `routeQualifiedLead(prompt)`.
// So the preview described a regex's reading of the sentence while the run
// executed the Mission's reading of the same sentence, and nothing compared the
// two. A regex also DECIDED whether a lead card was built at all
// (`hiring_signal.requested && role_family`), so "Find 5 AI workflow companies in
// Europe" — a lead request naming no hiring signal — fell through to the generic
// template card.
//
// `leadIntentFromMission` fills the same DTO from decided Mission fields plus the
// Company Brain, and `qualifiedLeadRouteFromMission` reads the route off what the
// Mission says the user asked to receive.
//
// No network, no provider, no model call.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  leadIntentFromMission, DEFAULT_LEAD_INTENT_COUNT, type MissionForLeadIntent,
} from "../../../supabase/functions/_shared/leadIntent.ts";
import {
  qualifiedLeadRouteFromMission, routeQualifiedLead,
} from "../../../supabase/functions/_shared/qualifiedLeadRouting.ts";
import { DEFAULT_REQUESTED_COUNT } from "../../../supabase/functions/_shared/leadMission.ts";

/** A sentence that shouts every semantic it is no longer allowed to decide. */
const LOUD_QUERY =
  "I want founders of B2B SaaS startups in the USA hiring RevOps — find 25 of them " +
  "so I can target them with my AI SaaS product. Only exact matches.";

function mission(over: Partial<MissionForLeadIntent> = {}): MissionForLeadIntent {
  return {
    original_user_query: LOUD_QUERY,
    target_entity: "company",
    requested_output: "qualified_companies",
    requested_count: null,
    confidence: 0.9,
    company_profile: { verticals: [], stages: [], locations: [] },
    required_signals: [],
    decision_makers: { roles: [] },
    ...over,
  };
}

const BRAIN = {
  icp: {
    industries: ["Staffing"], geography: "UK", disqualifiers: ["nonprofit"],
    company_size: "11-50", buyer_roles: ["Head of Talent"],
    negative_industries: ["Government"], allow_enterprise: false,
  },
  company: { category: "AI SaaS", industry: "Software" },
  competitors: ["Clay"],
};

// ───────────────────────────── the projection ────────────────────────────────

Deno.test("workflow kind and source come from the Mission's entity and signals", () => {
  assertEquals(leadIntentFromMission(mission({ target_entity: "person" })).workflow_type, "people_sourcing");
  assertEquals(leadIntentFromMission(mission({ target_entity: "person" })).source_type, "people");

  const hiring = leadIntentFromMission(mission({ required_signals: [{ type: "hiring" }] }));
  assertEquals(hiring.workflow_type, "company_hiring_sourcing");
  assertEquals(hiring.source_type, "jobs");

  const icp = leadIntentFromMission(mission());
  assertEquals(icp.workflow_type, "company_icp_sourcing");
  assertEquals(icp.source_type, "company_search");

  const social = leadIntentFromMission(mission({ requested_output: "social_posts" }));
  assertEquals(social.workflow_type, "linkedin_intent_sourcing");
  assertEquals(social.source_type, "linkedin_posts");
});

Deno.test("the persona is the Mission's decision makers, not the word 'founders'", () => {
  assertEquals(leadIntentFromMission(mission()).target_buyer, []);
  assertEquals(
    leadIntentFromMission(mission({ decision_makers: { roles: ["Head of Talent"] } })).target_buyer,
    ["Head of Talent"],
  );
});

Deno.test("the hiring signal and role family are the Mission's, not the sentence's", () => {
  const none = leadIntentFromMission(mission());
  assertEquals(none.hiring_signal.requested, false, "'hiring RevOps' in the query is not a decision");
  assertEquals(none.hiring_signal.role_family, null);
  assertEquals(none.hiring_signal.role_keywords, []);

  const decided = leadIntentFromMission(mission({
    required_signals: [{ type: "hiring", role_families: ["sales_ops"] }],
  }));
  assertEquals(decided.hiring_signal.requested, true);
  assertEquals(decided.hiring_signal.role_family, "sales_operations");
  assert(decided.hiring_signal.role_keywords.length > 0, "aliases still expand for the actor query");
  assert(decided.hiring_signal.exclude_role_keywords.length > 0);
});

Deno.test("industry, geography and stage follow the Mission, with the Brain as backfill", () => {
  const brainOnly = leadIntentFromMission(mission(), BRAIN);
  assertEquals(brainOnly.target_industry, ["Staffing"], "no decided vertical ⇒ the Brain's ICP");
  assertEquals(brainOnly.target_geography, ["UK"], "no decided location ⇒ the Brain's geography");
  assertEquals(brainOnly.target_stage, []);

  const decided = leadIntentFromMission(mission({
    company_profile: { verticals: ["b2b saas"], locations: ["United States"], stages: ["startup"] },
  }), BRAIN);
  assertEquals(decided.target_geography, ["United States"], "a decided location wins outright");
  assertEquals(decided.target_stage, ["startup"]);
  assert(decided.target_industry.includes("b2b saas"));
});

Deno.test("what the workspace SELLS comes from the Brain, never mined out of the sentence", () => {
  assertEquals(leadIntentFromMission(mission(), BRAIN).user_product?.category, "AI SaaS");
  assertEquals(leadIntentFromMission(mission()).user_product, undefined);
});

Deno.test("count and strictness are decided fields, not phrase matches", () => {
  assertEquals(
    leadIntentFromMission(mission()).count, DEFAULT_LEAD_INTENT_COUNT,
    "the sentence says 25; the Mission recorded no count",
  );
  assertEquals(DEFAULT_LEAD_INTENT_COUNT, DEFAULT_REQUESTED_COUNT, "one default, two modules");
  assertEquals(leadIntentFromMission(mission({ requested_count: 12 })).count, 12);

  assertEquals(
    leadIntentFromMission(mission()).strictness, "balanced",
    "the sentence says 'only exact matches'; the Mission did not",
  );
  assertEquals(
    leadIntentFromMission(mission({ no_broadening_requested: true })).strictness, "strict",
  );
});

Deno.test("a decided Mission never asks the user to disambiguate itself", () => {
  assertEquals(leadIntentFromMission(mission()).clarification_needed, false);
});

Deno.test("the ICP half still comes from the Brain, unchanged", () => {
  const i = leadIntentFromMission(mission(), BRAIN);
  assertEquals(i.disqualifiers, ["nonprofit"]);
  assertEquals(i.negative_industries, ["Government"]);
  assertEquals(i.target_company_size, ["11-50"]);
  assertEquals(i.competitors, ["Clay"]);
  assertEquals(i.buyer_roles, ["Head of Talent"]);
  assertEquals(i.allow_enterprise, false);
});

Deno.test("same sentence, different Missions, different cards", () => {
  const a = leadIntentFromMission(mission({
    target_entity: "person", requested_output: "contact_ready_leads",
    decision_makers: { roles: ["Founder"] },
    required_signals: [{ type: "hiring", role_families: ["sales_ops"] }],
  }));
  const b = leadIntentFromMission(mission());
  assert(
    JSON.stringify(a) !== JSON.stringify(b),
    "identical words must still produce different cards when the Missions differ",
  );
});

// ─────────────────────────────── the route ───────────────────────────────────

Deno.test("the qualified-lead route reads what the Mission says the user asked to receive", () => {
  const contact = qualifiedLeadRouteFromMission({
    target_entity: "person", requested_output: "contact_ready_leads",
  });
  assertEquals(contact.workflowKind, "qualified_lead_sourcing");
  assertEquals(contact.executionMode, "company_first");
  assertEquals(contact.countEntity, "contact_ready_lead");
  assertEquals(contact.quotaPolicy, "contact_only");
  assert(contact.reasonCodes.every((r) => r.startsWith("mission_")), contact.reasonCodes.join(","));

  const accounts = qualifiedLeadRouteFromMission({
    target_entity: "company", requested_output: "qualified_companies",
  });
  assertEquals(accounts.workflowKind, "account_opportunity_sourcing");
  assertEquals(accounts.executionMode, "fast");
  assertEquals(accounts.countEntity, "account_opportunity");
  assertEquals(accounts.quotaPolicy, "account_only");
});

Deno.test("the phrase-table router still exists for the PRE-mission question", () => {
  // It decides whether a lead request is happening at all, upstream of
  // compilation. That is the one question the Mission cannot answer, because it
  // is what causes the Mission to be compiled.
  assertEquals(
    routeQualifiedLead("Find 5 founders I can contact").workflowKind,
    "qualified_lead_sourcing",
  );
});

// ─────────────────────── structural: no second reader ────────────────────────

const PILOT = Deno.readTextFileSync(
  new URL("../../../supabase/functions/pilot-chat/index.ts", import.meta.url),
).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

function fnBody(src: string, name: string): string {
  const i = src.indexOf(name);
  assert(i >= 0, `${name} must exist`);
  const rest = src.slice(i);
  const end = rest.indexOf("\n}\n");
  return rest.slice(0, end > 0 ? end + 3 : rest.length);
}

Deno.test("pilot-chat no longer extracts a lead intent from the sentence", () => {
  assertEquals(
    [...PILOT.matchAll(/extractLeadIntent\(/g)].length, 0,
    "the card, the threaded lead_intent and the Start path all project from the Mission",
  );
  assert(PILOT.includes("leadIntentFromMission("), "and they project through the one helper");
});

Deno.test("a regex no longer decides whether a lead card is built", () => {
  const gen = fnBody(PILOT, "async function generateWorkflowConfirmation");
  assert(
    !/hiring_signal\.(?:requested|role_family)/.test(gen),
    "no hiring-signal precondition may gate the lead card: a lead request that " +
    "names no hiring signal is still a lead request",
  );
  assert(
    /LEAD_CONFIRMATION_CATEGORIES\.has\(category\)/.test(gen),
    "the branch must read the category the classifier already decided upstream",
  );
});

Deno.test("the card's own fields are read off the Mission, and the prompt is not re-scanned", () => {
  const card = fnBody(PILOT, "function buildHiringConfirmation");
  assert(
    /leadIntentFromMission\(mission,/.test(card),
    "the card's intent must be a projection",
  );
  assert(
    !/routeQualifiedLead\(/.test(card),
    "the card's route must come from the Mission, not from a phrase table",
  );
  assert(
    /qualifiedLeadRouteFromMission\(mission\)/.test(card),
    "…through the Mission route projection",
  );
  for (const reScan of [
    "normalizeCompanyVertical(industry, ...(intent.target_industry ?? []), prompt)",
    "inferCompanyStage(...(intent.company_stage ?? []), prompt)",
    "inferFamilyKey([], [prompt",
  ]) {
    assert(!card.includes(reScan), `the raw prompt is still a semantic source: ${reScan}`);
  }
});

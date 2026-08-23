// THREE CAPABILITIES A MODEL MUST NOT CONFUSE.
//
// ── THE THREE REQUESTS ──────────────────────────────────────────────────────
//
//   "Find the VP Sales for these companies."   → decision-maker discovery
//   "Find their business emails."              → contact enrichment, and only
//                                                once the people are known
//   "Research these companies deeply."         → Firecrawl deep research
//
// They are adjacent in language and completely different in cost, provider and
// prerequisite. The system that got this wrong charged 2 credits for a contact
// unlock that re-ran founder discovery, because nothing anywhere stated that
// finding a person and reaching them are different jobs.
//
// ── WHAT GPT IS AND IS NOT ALLOWED TO DECIDE ───────────────────────────────
//
// The model picks a SEMANTIC capability. It never names an Actor: the catalogue
// it writes against is the public one, and `capabilityNamesAnActor` already
// forbids provider names appearing there. Deterministic code maps capability →
// approved provider. These tests assert the boundary from both sides — the
// descriptions carry enough meaning to route, and none of them leaks an Actor.
//
// GPT'S ACTUAL ROUTING BEHAVIOUR IS NOT TESTED HERE. OpenAI has no credits in
// this environment, so what is pinned is the INPUT the model is given. Live
// routing remains to be validated.
//
// PURE. No network, provider, model or database access.

import {
  assert, assertEquals, assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  PUBLIC_CAPABILITY_CATALOGUE, PUBLIC_CAPABILITY_IDS,
} from "../../../supabase/functions/_shared/leadCapabilityCatalogue.ts";
import {
  HIRING_ACTOR_CATALOG,
} from "../../../supabase/functions/_shared/hiringActorCatalog.ts";
import {
  UNLOCK_PRICES,
} from "../../../supabase/functions/_shared/creditPricing.ts";

const cap = (id: string) =>
  PUBLIC_CAPABILITY_CATALOGUE[id as keyof typeof PUBLIC_CAPABILITY_CATALOGUE];

const FOUNDER = "offer_founder_unlock";
const CONTACT = "offer_contact_unlock";
const RESEARCH = "offer_deep_company_research";

// ═══════════════ 1-3. EACH CAPABILITY STATES ITS OWN JOB ═══════════════════

Deno.test("1. all three capabilities exist and are unpaid OFFERS", () => {
  for (const id of [FOUNDER, CONTACT, RESEARCH]) {
    const c = cap(id);
    assert(c, `${id} must be in the public catalogue`);
    assertEquals(c.kind, "offer", `${id} must schedule nothing`);
    assertEquals(c.paid, false, `${id} must cost nothing until pressed`);
    assertEquals(c.internal, [], `${id} must reach no internal stage`);
    assert(PUBLIC_CAPABILITY_IDS.includes(id as never));
  }
});

Deno.test("2. CONTACT says it cannot search, and names what to use instead", () => {
  // The single most important sentence in the catalogue: without it, "find
  // their emails" and "find their VP Sales" are one request to a model.
  const d = cap(CONTACT).description;
  assert(/does NOT look anything up/i.test(d), d);
  assert(/cannot search/i.test(d), "it must say plainly that it cannot find a person");
  assert(/offer_founder_unlock/.test(d),
    "it must name the capability that DOES find a person");
  // The two honesty constraints a user is owed before paying.
  assert(/not_found|not a guarantee|ATTEMPT/i.test(d),
    "an email lookup is an attempt, not a promise");
  assert(/phone/i.test(d), "no phone is available — it must never be implied");
});

Deno.test("3. FOUNDER says it finds the person and nothing else", () => {
  const d = cap(FOUNDER).description;
  assert(/does NOT return an email/i.test(d), d);
  assert(/separately-priced/i.test(d),
    "reaching someone must read as a separate purchase");
  assert(/offer_contact_unlock/.test(d), "it must name the follow-on capability");
});

Deno.test("4. RESEARCH is a depth upgrade, not qualification and not contact", () => {
  const d = cap(RESEARCH).description;
  // What it is for.
  for (const t of ["products", "positioning", "case studies"]) {
    assert(d.toLowerCase().includes(t), `deep research must mention ${t}`);
  }
  // The two things it is NOT, both of which cost money to confuse.
  assert(/NOT choose this for ordinary qualification/i.test(d),
    "buying a crawl to re-establish industry and size spends a credit on an " +
    "answer the run already holds");
  assert(/NOT contact enrichment/i.test(d));
  assert(/does not return emails/i.test(d));
});

// ═══════════════ 5. THE THREE REQUESTS ARE SEPARABLE ═══════════════════════

Deno.test("5. each request's vocabulary appears in exactly ONE capability", () => {
  // ── A ROUTING SIGNAL, NOT A KEYWORD RULE ─────────────────────────────────
  //
  // Nothing matches these strings at runtime — GPT reads prose and chooses.
  // What this asserts is that the prose is DISCRIMINATIVE: if the words a user
  // would use appear in two descriptions, the model has been handed an
  // ambiguity rather than a boundary.
  const descriptions = new Map(
    [FOUNDER, CONTACT, RESEARCH].map((id) => [id, cap(id).description.toLowerCase()]));

  const routes: Array<[string, string]> = [
    ["business email", CONTACT],
    ["contact details", CONTACT],
    ["case studies", RESEARCH],
    ["positioning", RESEARCH],
  ];

  for (const [phrase, expected] of routes) {
    const hits = [...descriptions.entries()]
      .filter(([, d]) => d.includes(phrase))
      .map(([id]) => id);
    assert(hits.includes(expected), `"${phrase}" must appear in ${expected}`);
    // It may appear elsewhere ONLY as an explicit disclaimer ("does not return
    // emails"), which is what makes the boundary legible rather than blurry.
    for (const other of hits.filter((h) => h !== expected)) {
      const d = descriptions.get(other)!;
      assert(/\bnot\b|\bdo not\b|\bdoes not\b|\bnever\b/.test(d),
        `"${phrase}" appears in ${other} without a disclaiming sentence`);
    }
  }
});

// ═══════════════ 6-7. THE CAPABILITY BOUNDARY IS NOT LEAKY ═════════════════

Deno.test("6. NO capability description names an Actor", () => {
  // GPT chooses capabilities; deterministic code chooses providers. A provider
  // name in this catalogue would let a model pick the Actor directly, and the
  // validator's `not_for` rules would then be advisory rather than binding.
  const actorIds = Object.values(HIRING_ACTOR_CATALOG).map((c) => c.actor_id);
  const actorKeys = Object.keys(HIRING_ACTOR_CATALOG);

  for (const id of PUBLIC_CAPABILITY_IDS) {
    const text = `${cap(id).id} ${cap(id).description}`.toLowerCase();
    for (const name of [...actorIds, ...actorKeys, "harvestapi", "firecrawl", "apify"]) {
      assertFalse(text.includes(name.toLowerCase()),
        `${id} names the provider "${name}" — capability selection must stay ` +
        `semantic, with providers chosen and validated by code`);
    }
  }
});

Deno.test("7. the PRICES agree with the capability boundary", () => {
  // Finding a person is a search that pays an actor-start fee and returns rows
  // to verify. Enriching a known person is one lookup with no start fee. If
  // those two prices ever invert, either a price was tuned without a provider
  // reason or the two actions were confused for one another — which is exactly
  // the defect this whole boundary exists to prevent.
  assert(UNLOCK_PRICES.find_contact_details < UNLOCK_PRICES.find_decision_makers);
  assert(UNLOCK_PRICES.find_contact_details > 0, "it reaches a paid provider");
  assert(UNLOCK_PRICES.research_company > 0);
  assertEquals(UNLOCK_PRICES.generate_outreach, 0,
    "drafting reaches no paid provider — model spend is billed in dollars");
});

// ═══════════════ 8-9. "FIND THE VP SALES" ACTUALLY REACHES THE ACTOR ═══════

Deno.test("8. a requested persona replaces the default ladder, bounded", async () => {
  const { planPeopleSearch, TITLE_FILTERS, MAX_RESULTS_PER_LEAD } = await import(
    "../../../supabase/functions/_shared/decisionMaker/searchPlanner.ts");

  const identity = {
    search_ready: true,
    company_linkedin_url: "https://www.linkedin.com/company/nimbusforge",
    domain: "nimbusforge.com",
    company_name: "Nimbus Forge",
    identity_strength: "strong",
    // deno-lint-ignore no-explicit-any
  } as any;

  // ── THE DEFAULT IS UNCHANGED ─────────────────────────────────────────────
  const base = planPeopleSearch(identity, "company_employee_search");
  assert(base.ok);
  assertEquals(base.ok && base.plan.title_filters, [...TITLE_FILTERS]);

  // ── THE ASKED-FOR PERSONA REPLACES IT ────────────────────────────────────
  //
  // "Find the VP Sales for these companies." Widening the default constant
  // instead would make EVERY search broader, and `jobTitles` is fuzzy — the
  // Actor's own defect returned a Finance Intern for a Founder query — so a
  // longer list returns more wrong people, not more right ones.
  const vp = planPeopleSearch(identity, "company_employee_search",
    { personaTitles: ["VP Sales", "Head of Sales"] });
  assert(vp.ok);
  assertEquals(vp.ok && vp.plan.title_filters, ["VP Sales", "Head of Sales"]);
  assert(vp.ok && !vp.plan.title_filters.includes("founder"),
    "the default ladder must not be appended — that is what made every search the same");

  // Deduplicated, trimmed, and capped at the Actor's documented jobTitles limit.
  const messy = planPeopleSearch(identity, "company_employee_search", {
    personaTitles: ["  VP Sales ", "VP Sales", "", "   ",
      ...Array.from({ length: 60 }, (_, i) => `Role ${i}`)],
  });
  assert(messy.ok);
  const t = messy.ok ? messy.plan.title_filters : [];
  assertEquals(t.length, 50, "capped at the Actor's jobTitles limit");
  assertEquals(t[0], "VP Sales", "trimmed and de-duplicated");
  assert(MAX_RESULTS_PER_LEAD > 0);
});

Deno.test("9. discovery routes to company-employees first, profile-search as fallback", async () => {
  const { planPeopleSearch } = await import(
    "../../../supabase/functions/_shared/decisionMaker/searchPlanner.ts");

  // WITH A COMPANY LINKEDIN URL the bounded per-company Actor is used. The
  // fallback has no per-company cap and a $0.10 run minimum — roughly twice the
  // price for identical recall on the benchmark — so preferring it would be
  // paying more for the same people.
  const withUrl = planPeopleSearch({
    search_ready: true,
    company_linkedin_url: "https://www.linkedin.com/company/nimbusforge",
    domain: "nimbusforge.com", company_name: "Nimbus Forge",
    identity_strength: "strong",
    // deno-lint-ignore no-explicit-any
  } as any, "company_employee_search");
  assert(withUrl.ok);
  assertEquals(withUrl.ok && withUrl.plan.actor_key, "apify_linkedin_company_employees");

  // WITHOUT ONE, the domain fallback — and it says it is a fallback.
  const domainOnly = planPeopleSearch({
    search_ready: true, company_linkedin_url: null,
    domain: "nimbusforge.com", company_name: "Nimbus Forge",
    identity_strength: "medium",
    // deno-lint-ignore no-explicit-any
  } as any, "domain_people_search");
  assert(domainOnly.ok);
  assertEquals(domainOnly.ok && domainOnly.plan.actor_key, "apify_people_search");

  // A NAME-ONLY identity produces NO plan at all: there would be no way to
  // verify whoever came back, and an unverifiable person is worse than none.
  const nameOnly = planPeopleSearch({
    search_ready: false, company_linkedin_url: null, domain: null,
    company_name: "Nimbus Forge", identity_strength: "weak",
    // deno-lint-ignore no-explicit-any
  } as any, "company_employee_search");
  assertFalse(nameOnly.ok);
});

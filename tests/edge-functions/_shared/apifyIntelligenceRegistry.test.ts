// WHY THIS FILE EXISTS.
//
// The registry is about to be the thing a model reasons from when it decides
// how to spend money. Its value is entirely in being TRUE — a confidently
// wrong record is worse than no record, because the planner will act on it.
//
// So these tests pin the properties that keep it honest: that discovery and
// enrichment Actors stay separated by what they actually consume, that adoption
// evidence is recorded rather than assumed, that the cost comparison accounts
// for start fees, and that a rejected Actor stays rejected with its reason.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  APIFY_INTELLIGENCE, REJECTED_ACTORS, STALE_AFTER_DAYS,
  actorIntelligence, actorsWithCapability, discoveryCapableActors,
  estimatedCostUsd, intelligenceBriefing, recordIsStale,
} from "../../../supabase/functions/_shared/apifyIntelligenceRegistry.ts";

Deno.test("1. an Actor that consumes URLs or domains is never discovery-capable", () => {
  // THE BOUNDARY. "Find companies using Shopify" and "does this company use
  // Shopify" are different questions, and only the second has an Actor. An
  // Actor whose input is a list of things you already have cannot start a
  // search, whatever its capability list overlaps with.
  for (const a of discoveryCapableActors()) {
    assert(a.input_entities.includes("query"),
      `${a.actor_id} is offered for discovery but consumes ${a.input_entities.join(", ")}`);
  }

  const builtwith = actorIntelligence("builtwith/builtwith-official-technology-scraper")!;
  assertEquals(builtwith.input_entities, ["domain"]);
  assertEquals(
    discoveryCapableActors().some((a) => a.actor_id === builtwith.actor_id), false,
    "BuiltWith's live schema has exactly two fields and no reverse lookup",
  );
});

Deno.test("2. every record says when and how it was verified", () => {
  // A record with no provenance is a guess. The whole registry is only usable
  // because each line of it can be traced back to a Store fetch on a date.
  for (const a of Object.values(APIFY_INTELLIGENCE)) {
    assert(/^\d{4}-\d{2}-\d{2}$/.test(a.last_verified_at), `${a.actor_id} needs a verified date`);
    assert(a.verified_via.startsWith("apify_store_api"), `${a.actor_id} needs a verification source`);
    assert(a.source_url.startsWith("https://apify.com/"), `${a.actor_id} needs its Store URL`);
    assert(a.actor_id.includes("/"), `${a.actor_id} must be a username/name Store id`);
    assertEquals(a.source_url.endsWith(a.actor_id), true,
      `${a.actor_id}'s URL and id must agree — a mismatch means one was typed`);
  }
});

Deno.test("3. an unrated Actor is recorded as unrated, not as good", () => {
  // `rating: null` and `rating: 5` are opposite claims, and a registry that
  // conflates them will rank an Actor nobody has ever assessed above one that
  // hundreds of people have.
  const crunchbase = actorIntelligence("memo23/crunchbase-scraper")!;
  assertEquals(crunchbase.adoption.rating, null, "80 users, 35 monthly, zero ratings");
  assertEquals(crunchbase.adoption.rating_count, 0);
  assert(crunchbase.confidence <= 0.5,
    "no community evidence at all must depress confidence");

  const postSearch = actorIntelligence("harvestapi/linkedin-post-search")!;
  assertEquals(postSearch.adoption.rating, 4.94);
  assert(postSearch.confidence > crunchbase.confidence,
    "23217 users and 14 ratings must outrank 80 users and none");
});

Deno.test("4. a thin rating is not treated as a strong one", () => {
  // Two Actors rated 5.0, from one and three ratings. The score carries almost
  // no information; the usage figure does. Anything ranking on rating alone
  // would put both above a 4.94 rated by fourteen people and used by 5249 a month.
  for (const id of [
    "builtwith/builtwith-official-technology-scraper",
    "harvestapi/linkedin-company-posts",
  ]) {
    const a = actorIntelligence(id)!;
    assertEquals(a.adoption.rating, 5);
    assert(a.adoption.rating_count <= 3);
    assert(a.confidence < 0.95, `${id} must not inherit confidence from a 5.0 of ${a.adoption.rating_count}`);
  }
});

Deno.test("5. cost comparison accounts for the start fee", () => {
  // The reason `easyapi/google-news-scraper` is rejected. A per-row price list
  // makes it look competitive; a 20-row corroboration run makes it four times
  // the price of what we registered.
  const news = actorIntelligence("data_xplorer/google-news-scraper-fast")!;
  assertEquals(news.cost.start_usd, 0);
  assertEquals(estimatedCostUsd(news, 20), 0.08);

  // The registered Crunchbase Actor is genuinely expensive, and the estimate
  // must say so rather than hiding it in a per-row figure.
  const cb = actorIntelligence("memo23/crunchbase-scraper")!;
  assert(estimatedCostUsd(cb, 100) > estimatedCostUsd(news, 100) * 2,
    "the most expensive registered Actor must estimate as such");
  assertEquals(estimatedCostUsd(cb, 0), 0.01, "the start fee is charged before any row");
});

Deno.test("6. a rejected Actor stays rejected, with evidence", () => {
  // "We looked and rejected it" and "we never looked" are different states, and
  // only one should stop the same Actor being proposed again next month.
  const ids = REJECTED_ACTORS.map((r) => r.actor_id);
  assert(ids.includes("xtracto/google-news-scraper"), "2 users and no rating");
  assert(ids.includes("easyapi/google-news-scraper"), "$0.09 start fee");

  for (const r of REJECTED_ACTORS) {
    assert(r.reason.length > 0 && r.evidence.length > 0, `${r.actor_id} needs a reason and evidence`);
    assertEquals(r.actor_id in APIFY_INTELLIGENCE, false,
      `${r.actor_id} must not also be registered`);
  }
});

Deno.test("7. the funding gate is recorded as a defect, not discovered at runtime", () => {
  // The Store schema states plainly that the funding amount, date and investors
  // unlock only with a Crunchbase session cookie from a real browser, and that
  // anonymous mode is 'signal-only' and capped at 15 results. A mission needing
  // a funding AMOUNT cannot be served by this Actor unattended, and the planner
  // has to be able to know that BEFORE it spends.
  const cb = actorIntelligence("memo23/crunchbase-scraper")!;
  const gate = cb.known_defects.find((d) => d.id === "crunchbase_funding_is_cookie_gated");
  assert(gate, "the cookie gate must be a first-class defect");
  assert(/cookie/i.test(gate!.summary));
  assert(cb.not_for.some((n) => /amount/i.test(n)),
    "and it must be stated in not_for, where the planner reads capability");
});

Deno.test("8. the briefing carries capability and defects, and invents nothing", () => {
  const briefing = intelligenceBriefing();
  assertEquals(briefing.length, Object.keys(APIFY_INTELLIGENCE).length);

  for (const entry of briefing) {
    // Every id in the briefing must resolve. This is what makes "GPT must never
    // invent an actor" checkable: the model can only echo ids it was given.
    assert(actorIntelligence(String(entry.actor_id)), `${entry.actor_id} must resolve`);
    for (const field of ["input_entities", "capabilities", "not_for",
      "supported_filters", "verified_enums", "known_defects", "adoption"]) {
      assert(field in entry, `the briefing must carry ${field}`);
    }
  }
});

Deno.test("9. capability lookup does not promise what an Actor cannot start", () => {
  // `technology_signal` has exactly one Actor and it cannot discover. A planner
  // asking "who can give me technology evidence" must get it; one asking "who
  // can find companies by technology" must get nobody.
  const tech = actorsWithCapability("technology_signal");
  assertEquals(tech.length, 1);
  assertEquals(tech[0].actor_id, "builtwith/builtwith-official-technology-scraper");
  assertEquals(
    tech.filter((a) => a.input_entities.includes("query")).length, 0,
    "no registered Actor can discover companies BY technology",
  );
});

Deno.test("10. stale knowledge is detectable", () => {
  // Schemas change, Actors are abandoned, prices move. A record nobody has
  // re-verified is a guess wearing a verification date.
  const a = actorIntelligence("harvestapi/linkedin-post-search")!;
  assertEquals(recordIsStale(a, new Date("2026-08-16T00:00:00Z")), false);
  assertEquals(recordIsStale(a, new Date("2027-01-01T00:00:00Z")), true);

  const justPast = new Date(
    Date.parse(`${a.last_verified_at}T00:00:00Z`) + (STALE_AFTER_DAYS + 1) * 86_400_000);
  assertEquals(recordIsStale(a, justPast), true);
});

Deno.test("11. enums are recorded verbatim, never paraphrased", () => {
  // The enum is the contract. A value outside it fails input validation after
  // the Actor has started and been billed, so a paraphrase here costs money.
  const post = actorIntelligence("harvestapi/linkedin-post-search")!;
  assertEquals(post.verified_enums.sortBy, ["relevance", "date"]);
  assertEquals(post.verified_enums.postedLimit.includes("3months"), true,
    "the live schema offers more than the documented 1h/24h/week/month");

  const cb = actorIntelligence("memo23/crunchbase-scraper")!;
  assertEquals(cb.verified_enums.dbEmployeeRange[0], "1-10");
  assertEquals(cb.verified_enums.investorStage.includes("Series A"), true);
});

Deno.test("12. every enum field is also a supported filter", () => {
  // An enum for a field the Actor does not accept is a paste error, and it
  // would let the planner build an input that cannot be sent.
  for (const a of Object.values(APIFY_INTELLIGENCE)) {
    for (const field of Object.keys(a.verified_enums)) {
      assert(a.supported_filters.includes(field),
        `${a.actor_id}: ${field} has an enum but is not a supported filter`);
    }
  }
});

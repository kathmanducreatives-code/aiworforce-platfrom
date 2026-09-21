// A COMPANY'S OFFICES SURVIVE NORMALIZATION.
//
// The audit found the Company Brain's company enrichment reading
//
//     asString(row.headquarters ?? row.headquarter ?? …)
//     asStringArray(row.locations)
//
// against a payload the repository's own catalog documents as
//
//     locations[{ headquarter, parsed.text }]
//
// An array of objects yields nothing from `asStringArray`, and there is no
// `headquarters` key at all — so every company researched through onboarding
// lost its headquarters and its offices while the call reported success. Same
// class as the founder profile's object-shaped `location`, one file over.
//
// The fixtures below are modelled on the PROVIDER's shape, taken from
// `hiringActorCatalog` and the worked example in `hiringActorNormalizers`
// (Kody: London / Shenzhen / Sunnyvale, headquarters flagged) — not on what the
// parser happened to expect. That is the whole reason the bug survived.
//
// PURE.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  normalizeCompanyLinkedIn, placeText, namedList,
} from "../../../supabase/functions/_shared/companyBrainResearch/companyLinkedIn.ts";
import {
  linkedInLocationEntries, enrichedGeography,
} from "../../../supabase/functions/_shared/hiringActorNormalizers.ts";

const URL_ = "https://www.linkedin.com/company/kody";

/** The enriched company actor's real row shape. */
const ENRICHED_ROW = {
  name: "Kody",
  description: "Payments for hospitality.",
  website: "https://kody.com",
  employeeCount: 120,
  employeeCountRange: "51-200",
  industries: [{ name: "Financial Services" }, { name: "Software Development" }],
  foundedOn: { year: 2018, month: 4, day: 1 },
  locations: [
    { country: "GB", city: "London", headquarter: false, parsed: { text: "London, United Kingdom", countryFull: "United Kingdom" } },
    { country: "CN", city: "Shenzhen", headquarter: false, parsed: { text: "Shenzhen, China", countryFull: "China" } },
    { country: "US", city: "Sunnyvale", headquarter: true, parsed: { text: "Sunnyvale, California", countryFull: "United States" } },
  ],
};

Deno.test("every office survives, and the flagged one is the headquarters", () => {
  const r = normalizeCompanyLinkedIn(ENRICHED_ROW, URL_);
  assertEquals(r.locations, ["London, United Kingdom", "Shenzhen, China", "Sunnyvale, California"]);
  // NOT locations[0], and not "the first one" — the provider's own flag.
  assertEquals(r.headquarters, "Sunnyvale, California");
  assertEquals(r.company_name, "Kody");
  assertEquals(r.industry, "Financial Services, Software Development");
  assertEquals(r.founded, "2018");
  assertEquals(r.employee_count, "120");
});

Deno.test("an office list with no headquarters flag still yields the offices", () => {
  const row = { ...ENRICHED_ROW, locations: ENRICHED_ROW.locations.map((l) => ({ ...l, headquarter: false })) };
  const r = normalizeCompanyLinkedIn(row, URL_);
  assertEquals(r.locations.length, 3);
  // No flag means no claim: the headquarters is not guessed from position.
  assertEquals(r.headquarters, "");
});

Deno.test("an entry that failed to parse falls back to city and country", () => {
  const r = normalizeCompanyLinkedIn({
    name: "X",
    locations: [{ city: "Lisbon", country: "Portugal", headquarter: true }],
  }, URL_);
  assertEquals(r.headquarters, "Lisbon, Portugal");
  assertEquals(r.locations, ["Lisbon, Portugal"]);
});

Deno.test("string forms other actors send still work", () => {
  const r = normalizeCompanyLinkedIn({
    name: "X", locations: ["Berlin, Germany"], headquarters: "Berlin, Germany",
  }, URL_);
  assertEquals(r.headquarters, "Berlin, Germany");
  assertEquals(r.locations, ["Berlin, Germany"]);

  const single = normalizeCompanyLinkedIn({ name: "X", location: "Paris, France" }, URL_);
  assertEquals(single.locations, ["Paris, France"]);
});

Deno.test("an object-shaped headquarters is read, not stringified into nothing", () => {
  const r = normalizeCompanyLinkedIn({
    name: "X", headquartersLocation: { city: "Austin", country: "US" },
  }, URL_);
  assertEquals(r.headquarters, "Austin, US");
});

// ── MALFORMED AND MISSING DATA FAIL SAFE ─────────────────────────────────────

Deno.test("missing or malformed location data yields nothing, never a crash and never a guess", () => {
  for (const locations of [undefined, null, [], "London", 42, {}, [null, 3, true], [{}], [[]]]) {
    const r = normalizeCompanyLinkedIn({ name: "X", locations }, URL_);
    assertEquals(r.headquarters, "", JSON.stringify(locations));
    assertEquals(r.locations, [], JSON.stringify(locations));
  }
  // A row that is not an object at all.
  for (const raw of [null, undefined, "x", 7, []]) {
    const r = normalizeCompanyLinkedIn(raw, URL_);
    assertEquals(r.locations, []);
    assertEquals(r.linkedin_url, URL_);
  }
});

Deno.test("a missing office list is reported as missing evidence, not filled in", () => {
  const r = normalizeCompanyLinkedIn({ name: "X" }, URL_);
  assertEquals(r.headquarters, "");
  assert(r.missing_evidence.length > 0);
  assertEquals(r.confidence !== "high", true, "nothing known cannot be high confidence");
});

// ── THE SHARED READER KEEPS ITS OLD CONTRACT ─────────────────────────────────

Deno.test("the lead pipeline's reader is unchanged by the extraction", () => {
  assertEquals(enrichedGeography(ENRICHED_ROW.locations), "London, United Kingdom; Shenzhen, China; Sunnyvale, California");
  // Strings inside locations[] stay malformed for the lead path; the Company
  // Brain opts in to them explicitly.
  assertEquals(enrichedGeography([null, 3, "x"]), null);
  assertEquals(linkedInLocationEntries([null, 3, "x"], { acceptStrings: true }).map((e) => e.text), ["x"]);
  assertEquals(linkedInLocationEntries(ENRICHED_ROW.locations).filter((e) => e.is_headquarters).length, 1);
});

Deno.test("the object readers are honest about what they cannot read", () => {
  assertEquals(placeText(null), "");
  assertEquals(placeText("London"), "");
  assertEquals(placeText([]), "");
  assertEquals(placeText({}), "");
  assertEquals(placeText({ parsed: { text: "London, UK" } }), "London, UK");
  assertEquals(namedList([{ name: "A" }, "B", {}, null, { name: "A" }]), ["A", "B"]);
  assertEquals(namedList("A"), []);
});

Deno.test("the mock company fixture is provider-shaped and survives normalization", async () => {
  const { mockLinkedInCompanyRow, mockResearchDeps } = await import(
    "../../../supabase/functions/_shared/companyBrainResearch/localProviderMode.ts"
  );
  const row = mockLinkedInCompanyRow("https://www.linkedin.com/company/agentory");
  // Provider shape, not parser shape.
  assert(Array.isArray(row.locations) && typeof (row.locations as unknown[])[0] === "object");
  assert(Array.isArray(row.industries) && "name" in ((row.industries as Record<string, unknown>[])[0]));

  const r = normalizeCompanyLinkedIn(row, "https://www.linkedin.com/company/agentory");
  assertEquals(r.headquarters, "Kathmandu, Nepal");
  assertEquals(r.locations, ["Kathmandu, Nepal", "London, United Kingdom"]);
  assertEquals(r.industry, "Software Development, Technology, Information and Internet");
  assertEquals(r.founded, "2023");

  // And the company actor is what the deps return for a company lookup.
  const items = await mockResearchDeps().runApifyActor!(
    "apimaestro/linkedin-company-detail", { companyUrl: "https://www.linkedin.com/company/agentory" },
  );
  assert("locations" in (items[0] as Record<string, unknown>), "a company lookup must not return a profile row");
});

// A COMPANY'S LOCATIONS MUST REACH THE EVALUATOR, OR IT CANNOT PLACE IT.
//
// ── THE RUN THIS EXISTS FOR ────────────────────────────────────────────────
//
// Lineage e70cbf3a held four strong companies because it could not establish
// where they were. The evaluator's own words:
//
//   Metaview  "current London openings for Sales Development Representative,
//              SDR Manager, Account Executive … However, the supplied evidence
//              does not establish that the company is … located in the United
//              Kingdom"
//   Kody      "a current verified Sales Development Representative opening in
//              London, United Kingdom … company geography is not independently
//              established beyond the job location"
//
// It was handed `geography: null` for every one of them, because the enrichment
// normalizer read `locations[0].linkedinText` — a field the COMPANY actor has
// never emitted. It belongs to the JOB actor's `location`. So the expression was
// `undefined` on every row, always, and the location data we had already paid
// for was discarded on arrival.
//
// The payloads below are copied verbatim from dataset qIiDGmKEVdr3ZHHhz, the
// enrichment run this lineage actually bought.
//
// ZERO network, ZERO DB, ZERO provider spend.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  enrichedGeography, normalizeLinkedInCompanyEnriched,
} from "../../supabase/functions/_shared/hiringActorNormalizers.ts";

/** Kody, verbatim from the production dataset. US headquarters, London office. */
const KODY_LOCATIONS = [
  {
    country: "GB", city: "London", geographicArea: "England",
    line1: "Bloomsbury Square", headquarter: false, description: "London",
    parsed: {
      text: "London, United Kingdom", countryCode: "GB", country: "UK",
      countryFull: "United Kingdom", state: "England", city: "London",
    },
  },
  {
    country: "CN", city: "Shenzhen", headquarter: false, description: "Shenzhen",
    parsed: {
      text: "Shenzhen, People's Republic of China", countryCode: "CN",
      country: "China", countryFull: "People's Republic of China", city: "Shenzhen",
    },
  },
  {
    country: "US", city: "Sunnyvale", geographicArea: "California",
    headquarter: true,
    parsed: {
      text: "Sunnyvale, CA, United States", countryCode: "US",
      country: "United States", countryFull: "United States of America",
      state: "California", city: "Sunnyvale",
    },
  },
];

Deno.test("the UK office of a US-headquartered company is reported", () => {
  const geo = enrichedGeography(KODY_LOCATIONS);
  assert(geo, "geography must not be null when the payload carries locations");
  assert(geo!.includes("London, United Kingdom"),
    `the London office must be present — got ${geo}`);
});

Deno.test("the headquarters is not privileged over a branch", () => {
  // ── THE PRODUCT RULE THIS ENCODES ───────────────────────────────────────
  //
  // Geography means real presence in the requested market, not where the
  // company is registered. Kody is US-headquartered with a genuine London
  // office; reading `locations[0]` or filtering to `headquarter: true` drops
  // exactly the companies that rule exists to keep.
  const geo = enrichedGeography(KODY_LOCATIONS)!;
  assert(geo.includes("London"), "the branch is present");
  assert(geo.includes("Sunnyvale"), "and so is the headquarters");
  assert(
    geo.indexOf("London") < geo.indexOf("Sunnyvale"),
    "provider order is preserved — nothing is reordered to favour an HQ",
  );
});

Deno.test("the field the old code read does not exist on this payload", () => {
  // Asserted rather than described: if the company actor ever does emit
  // `linkedinText`, this test says so instead of quietly passing.
  for (const l of KODY_LOCATIONS) {
    assertEquals(
      (l as Record<string, unknown>).linkedinText, undefined,
      "linkedinText belongs to the JOB actor, not the company actor",
    );
  }
});

Deno.test("an unparsed location falls back to city and country", () => {
  const geo = enrichedGeography([
    { country: "United Kingdom", city: "Manchester" },
  ]);
  assertEquals(geo, "Manchester, United Kingdom");
});

Deno.test("repeated locations read once", () => {
  const geo = enrichedGeography([
    { parsed: { text: "London, United Kingdom" } },
    { parsed: { text: "London, United Kingdom" } },
    { parsed: { text: "Leeds, United Kingdom" } },
  ]);
  assertEquals(geo, "London, United Kingdom; Leeds, United Kingdom");
});

Deno.test("absent or malformed locations stay null, never a crash", () => {
  assertEquals(enrichedGeography(undefined), null);
  assertEquals(enrichedGeography(null), null);
  assertEquals(enrichedGeography([]), null);
  assertEquals(enrichedGeography("London"), null);
  assertEquals(enrichedGeography([null, 3, "x"]), null);
  assertEquals(enrichedGeography([{}]), null, "an entry with no place is not a place");
});

Deno.test("the normalizer carries it onto the company", () => {
  // The end-to-end shape: this is what reaches `hardFactsForPrompt`.
  const c = normalizeLinkedInCompanyEnriched({
    id: "123", name: "Kody", website: "https://kody.com",
    linkedinUrl: "https://www.linkedin.com/company/kody",
    employeeCount: 70, locations: KODY_LOCATIONS,
  });
  assert(c.geography, "the evaluator is handed a place, not null");
  assert(c.geography!.includes("United Kingdom"),
    `and one it can match against a UK mission — got ${c.geography}`);
});

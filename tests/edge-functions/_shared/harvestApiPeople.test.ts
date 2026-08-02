// Unit tests for the HarvestAPI LinkedIn Profile Search adapter.
// Run with:  node --experimental-strip-types harvestApiPeople.test.ts
// (pure module, no network / no Deno needed)

import { strict as assert } from "node:assert";
import { buildHarvestApiPeopleInput, normalizeLocationName } from "../../supabase/functions/_shared/harvestApiPeople.ts";

let pass = 0;
let fail = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    pass++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    fail++;
    console.log(`  FAIL ${name}`);
    console.log(`       ${(e as Error).message}`);
  }
}

// ---- Test 1: "Find 10 individual React developer profiles in London" ----
// Planner produces role_keywords as DISTINCT title aliases (one element per
// title); a multi-word title stays one element. location "London", max 10.
test("T1 react developer London — core mapping", () => {
  const out = buildHarvestApiPeopleInput({
    query: "react developer",
    location: "London",
    role_keywords: ["React Developer"],
    max_results: 10,
  });
  assert.equal(out.profileScraperMode, "Full");
  assert.equal(out.maxItems, 10);
  assert.equal(out.startPage, 1);
  assert.deepEqual(out.locations, ["London"]);
  assert.deepEqual(out.currentJobTitles, ["React Developer"]);
  // searchQuery is a concise market/category query only; location lives in
  // locations[] and the title in currentJobTitles[] (not duplicated into searchQuery).
  assert.equal(out.searchQuery, "react developer");
  // No raw Agentory fields leaked.
  assert.equal("location" in out, false);
  assert.equal("max_results" in out, false);
  assert.equal("role_keywords" in out, false);
  assert.equal("query" in out, false);
});

// When the planner (Gemini) supplies expanded titles via filters, they win.
test("T1b planner-supplied expanded titles win", () => {
  const out = buildHarvestApiPeopleInput({
    query: "react developer",
    location: "London",
    role_keywords: ["react", "developer"],
    max_results: 10,
    user_input: { currentJobTitles: ["React Developer", "React Engineer", "Frontend Engineer"] },
  });
  assert.deepEqual(out.currentJobTitles, ["React Developer", "React Engineer", "Frontend Engineer"]);
  assert.deepEqual(out.locations, ["London"]);
});

// ---- Test 2: "20 SaaS founders in the United States who recently posted" ----
test("T2 founders US recentlyPosted — filters + location normalization", () => {
  const out = buildHarvestApiPeopleInput({
    query: "saas founders",
    location: "us", // planner may emit the abbreviation
    role_keywords: ["founder"],
    max_results: 20,
    user_input: {
      recentlyPostedOnLinkedIn: true,
      currentJobTitles: ["Founder", "Co-Founder", "CEO"],
    },
  });
  assert.equal(out.recentlyPostedOnLinkedIn, true);
  assert.deepEqual(out.locations, ["United States"]); // "us" -> full name
  assert.deepEqual(out.currentJobTitles, ["Founder", "Co-Founder", "CEO"]);
  assert.equal(out.maxItems, 20);
});

// ---- Test 3: "engineers currently at Google" ----
test("T3a company NAME is dropped (not a LinkedIn URL)", () => {
  const out = buildHarvestApiPeopleInput({
    query: "engineers at google",
    location: null,
    role_keywords: ["engineer"],
    max_results: 10,
    user_input: { currentCompanies: ["google"] }, // a name, not a URL
  });
  assert.equal("currentCompanies" in out, false, "company name must be dropped");
});

test("T3b real LinkedIn company URL is kept", () => {
  const out = buildHarvestApiPeopleInput({
    query: "engineers at google",
    location: null,
    role_keywords: ["engineer"],
    max_results: 10,
    user_input: { currentCompanies: ["https://www.linkedin.com/company/google/"] },
  });
  assert.deepEqual(out.currentCompanies, ["https://www.linkedin.com/company/google/"]);
});

// ---- Guard tests ----
test("G1 default scraper mode is Full, never email search by default", () => {
  const out = buildHarvestApiPeopleInput({ query: "x", location: null, role_keywords: ["engineer"], max_results: 5 });
  assert.equal(out.profileScraperMode, "Full");
});

test("G2 explicit 'Full + email search' override is honored only when asked", () => {
  const out = buildHarvestApiPeopleInput({
    query: "x", location: null, role_keywords: ["engineer"], max_results: 5,
    user_input: { profileScraperMode: "Full + email search" },
  });
  assert.equal(out.profileScraperMode, "Full + email search");
});

test("G3 invalid scraper mode falls back to Full", () => {
  const out = buildHarvestApiPeopleInput({
    query: "x", location: null, role_keywords: ["engineer"], max_results: 5,
    user_input: { profileScraperMode: "Turbo" },
  });
  assert.equal(out.profileScraperMode, "Full");
});

test("G4 searchQuery capped at 300 chars", () => {
  const out = buildHarvestApiPeopleInput({
    query: "a".repeat(500), location: null, role_keywords: [], max_results: 5,
  });
  assert.equal((out.searchQuery as string).length, 300);
});

test("G5 unknown filter keys are not forwarded", () => {
  const out = buildHarvestApiPeopleInput({
    query: "x", location: "London", role_keywords: ["engineer"], max_results: 5,
    user_input: { someRandomField: "nope", mongoDbConnectionString: "secret://x" },
  });
  assert.equal("someRandomField" in out, false);
  assert.equal("mongoDbConnectionString" in out, false);
});

test("G6 maxItems floor/clamp", () => {
  assert.equal(buildHarvestApiPeopleInput({ query: "x", location: null, role_keywords: [], max_results: 0 }).maxItems, 10);
  assert.equal(buildHarvestApiPeopleInput({ query: "x", location: null, role_keywords: [], max_results: 9999 }).maxItems, 100);
});

test("G7 location normalization helper", () => {
  assert.equal(normalizeLocationName("uk"), "United Kingdom");
  assert.equal(normalizeLocationName("USA"), "United States");
  assert.equal(normalizeLocationName("Berlin"), "Berlin");
  assert.equal(normalizeLocationName(null), null);
});

test("G8 optional string[] filters pass through when present", () => {
  const out = buildHarvestApiPeopleInput({
    query: "x", location: null, role_keywords: ["engineer"], max_results: 5,
    user_input: { seniorityLevelIds: ["3", "4"], excludeLocations: ["India"] },
  });
  assert.deepEqual(out.seniorityLevelIds, ["3", "4"]);
  assert.deepEqual(out.excludeLocations, ["India"]);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

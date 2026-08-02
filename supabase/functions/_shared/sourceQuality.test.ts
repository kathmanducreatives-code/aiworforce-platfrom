// Tests for sourceQuality.classifyResults — the accept/reject gate that runs
// before leads are persisted. Focus: assistant / founder-support hiring must
// reject generic founder/CEO profile rows and accept real support-role hires.
//
// Run with: supabase--test_edge_functions

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyResults } from "./sourceQuality.ts";
import type { SourcedItem, SourcingCriteria, StrictConstraints } from "./sourcingRetry.ts";

const NO_STRICT: StrictConstraints = { location: false, industry: false, stage: false, count_exact: false };

function item(name: string, title: string, extra: Partial<SourcedItem> = {}): SourcedItem {
  return { name, title, company: name, ...extra };
}

Deno.test("classifyResults: support request rejects 'Co-Founder @ Company' profile row", () => {
  const c: SourcingCriteria = { requested: 5, role: "Executive Assistant", source_type: "jobs" };
  const r = classifyResults([item("Acme", "Co-Founder @ Company")], c, NO_STRICT);
  assertEquals(r.accepted.length, 0);
  assert(r.rejected.some((x) => /assistant|support|profile/i.test(x.reason)));
});

Deno.test("classifyResults: support request accepts Executive Assistant hire", () => {
  const c: SourcingCriteria = { requested: 5, role: "Executive Assistant", source_type: "jobs" };
  const r = classifyResults([item("Acme", "Executive Assistant to CEO")], c, NO_STRICT);
  assertEquals(r.accepted.length, 1);
});

Deno.test("classifyResults: jobs source rejects CEO profile title even without a role", () => {
  // No c.role → the role check is skipped, but the jobs-source profile-title
  // guard must still reject a bare CEO title (profile data, not a job posting).
  const c: SourcingCriteria = { requested: 5, source_type: "jobs" };
  const r = classifyResults([item("Acme", "CEO")], c, NO_STRICT);
  assertEquals(r.accepted.length, 0);
  assert(r.rejected.some((x) => /profile/i.test(x.reason)));
});

Deno.test("classifyResults: 'EA to CEO' survives the profile-title guard", () => {
  const c: SourcingCriteria = { requested: 5, role: "Executive Assistant", source_type: "jobs" };
  const r = classifyResults([item("Acme", "EA to CEO")], c, NO_STRICT);
  assertEquals(r.accepted.length, 1);
});

Deno.test("classifyResults: 'Founder Associate' is a support role, not rejected", () => {
  const c: SourcingCriteria = { requested: 5, role: "Executive Assistant", source_type: "jobs" };
  const r = classifyResults([item("Acme", "Founder Associate")], c, NO_STRICT);
  assertEquals(r.accepted.length, 1);
});

Deno.test("classifyResults: people source still accepts founder title (no regression)", () => {
  // people_profiles is NOT a jobs source → the profile-title guard must not fire.
  const c: SourcingCriteria = { requested: 5, role: "founder", source_type: "people_profiles" };
  const r = classifyResults([item("Jane Doe", "Founder & CEO")], c, NO_STRICT);
  assertEquals(r.accepted.length, 1);
});

Deno.test("classifyResults: support request rejects an unrelated GTM hire", () => {
  // An SDR hire in an assistant-role search is not what was asked → reject rather
  // than fill the result with off-target rows.
  const c: SourcingCriteria = { requested: 5, role: "Executive Assistant", source_type: "jobs" };
  const r = classifyResults([item("Acme", "Hiring SDR")], c, NO_STRICT);
  assertEquals(r.accepted.length, 0);
});

Deno.test("classifyResults: missing name is rejected", () => {
  const c: SourcingCriteria = { requested: 5, role: "Executive Assistant", source_type: "jobs" };
  const r = classifyResults([item("", "Executive Assistant")], c, NO_STRICT);
  assertEquals(r.accepted.length, 0);
  assert(r.reject_reason_counts["missing name/company"] > 0);
});

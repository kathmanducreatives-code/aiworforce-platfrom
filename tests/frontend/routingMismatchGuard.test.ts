// A JOB TITLE IN A HIRING CLAUSE IS NOT THE ENTITY BEING REQUESTED.
//
// ── THE FALSE POSITIVE ─────────────────────────────────────────────────────
//
// 2026-08-31, production. The user asked:
//
//   "Find me 5 B2B SaaS companies in the UK with 20-200 employees that are
//    actively hiring SDRs, BDRs, Account Executives, or other sales roles."
//
// The Pilot compiled it correctly — target_entity: company, requested_output:
// qualified_companies, requested_count: 5, verticals ["b2b saas…"], locations
// ["United Kingdom"] — and returned a company workflow, which is what was asked
// for.
//
// The dev routing guard decided by scanning the sentence for person nouns. It
// matched the single word "Executives", out of "Account Executives" — a role the
// TARGET COMPANIES ARE HIRING — declared a routing mismatch, and disabled Start
// on a perfectly routed request:
//
//   "This request requires qualified-lead sourcing, but an account-only
//    workflow was returned. Start is disabled to prevent running the legacy
//    path."
//
// Same trap the backend has now corrected twice: a word naming the SIGNAL read
// as the TARGET. `missionTargetsIntermediaries` ignores the raw query for
// exactly this reason.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  requestImpliesQualifiedLead,
} from "../../src/lib/qualifiedLead/routingExpectation.ts";

/** The sentence, verbatim from `messages`. */
const THE_REQUEST =
  "Find me 5 B2B SaaS companies in the UK with 20–200 employees that are " +
  "actively hiring SDRs, BDRs, Account Executives, or other sales roles.";

/** The mission the Pilot actually returned for it. */
const COMPANY_MISSION = {
  target_entity: "company",
  requested_output: "qualified_companies",
};

// ══ THE REGRESSION ════════════════════════════════════════════════════════

Deno.test("THE 2026-08-31 REQUEST NO LONGER TRIPS THE GUARD", () => {
  assertEquals(
    requestImpliesQualifiedLead({ mission: COMPANY_MISSION, originalRequest: THE_REQUEST }),
    false,
    "a company mission is a company mission, however many job titles the sentence lists",
  );
});

Deno.test("…and it would have tripped it before", () => {
  // The old rule, reproduced, so the fix is demonstrably what changed.
  const OLD = /\b(founders?|co-?founders?|owners?|ceos?|presidents?|decision[-\s]?makers?|people to contact|contacts?|executives?)\b/i;
  assert(OLD.test(THE_REQUEST), "the sentence really does contain a person noun");
  assertEquals(OLD.exec(THE_REQUEST)?.[0], "Executives");
});

// ══ THE GUARD STILL GUARDS ════════════════════════════════════════════════

Deno.test("A GENUINE PERSON MISSION STILL IMPLIES QUALIFIED LEADS", () => {
  // The mismatch this guard exists to catch must still be caught.
  assertEquals(requestImpliesQualifiedLead({
    mission: { target_entity: "person", requested_output: "contact_ready_leads" },
    originalRequest: "Find me 5 founders at UK B2B SaaS companies",
  }), true);
});

Deno.test("a person OUTPUT is enough on its own", () => {
  assertEquals(requestImpliesQualifiedLead({
    mission: { target_entity: "company", requested_output: "contact_ready_leads" },
    originalRequest: "anything",
  }), true, "contact-ready leads are people whatever the entity says");
});

Deno.test("other company outputs do not imply it", () => {
  for (const requested_output of ["qualified_companies", "enriched_companies", "job_listings"]) {
    assertEquals(requestImpliesQualifiedLead({
      mission: { target_entity: "company", requested_output },
      originalRequest: THE_REQUEST,
    }), false, requested_output);
  }
});

// ══ THE LEXICAL FALLBACK, FOR WHEN THERE IS NO MISSION ════════════════════

Deno.test("with NO mission, a hiring clause is stripped before matching", () => {
  // Nothing structural to read, so the sentence is all there is — but a role the
  // target is hiring is still not the requested entity.
  assertEquals(requestImpliesQualifiedLead({
    mission: null, originalRequest: THE_REQUEST,
  }), false);
});

Deno.test("with no mission, a REAL person request is still recognised", () => {
  for (const q of [
    "Find me 5 founders at UK B2B SaaS companies",
    "Get me the CEOs of 10 manufacturing firms",
    "I need 20 qualified leads",
    "Find decision-makers at companies hiring SDRs",
    "give me contact-ready leads in fintech",
  ]) {
    assertEquals(requestImpliesQualifiedLead({ mission: null, originalRequest: q }), true, q);
  }
});

Deno.test("the hiring clause does not swallow a person target stated before it", () => {
  // "founders" precedes the hiring verb, so it survives the strip.
  assertEquals(requestImpliesQualifiedLead({
    mission: null,
    originalRequest: "Find founders at B2B SaaS companies that are hiring Account Executives",
  }), true);
});

Deno.test("several hiring verbs are all stripped", () => {
  for (const verb of ["hiring", "recruiting", "seeking", "advertising for", "posting"]) {
    assertEquals(requestImpliesQualifiedLead({
      mission: null,
      originalRequest: `Find 5 SaaS companies ${verb} Account Executives and CEOs`,
    }), false, verb);
  }
});

Deno.test("an empty or absent request is not a qualified-lead request", () => {
  assertEquals(requestImpliesQualifiedLead({ mission: null, originalRequest: "" }), false);
  assertEquals(
    requestImpliesQualifiedLead({ mission: undefined, originalRequest: "" }), false);
});

// ══ THE WIRING ════════════════════════════════════════════════════════════

const CARD = Deno.readTextFileSync(new URL(
  "../../src/components/chat/workspace/bubbles/WorkflowConfirmationCard.tsx",
  import.meta.url));

Deno.test("the card asks the predicate rather than scanning the sentence", () => {
  assert(CARD.includes("requestImpliesQualifiedLead({ mission, originalRequest })"),
    "the guard must read the mission");
  assert(!/const impliesQualifiedLead\s*=\s*\n?\s*\/\\b\(founders/.test(CARD),
    "the inline person-noun regex must be gone from the card");
});

Deno.test("the guard is still DEV-only and still blocks Start", () => {
  // Both properties matter: it must never reach an end user, and when it does
  // fire in dev it must actually prevent the legacy path from running.
  assert(/routingMismatch = import\.meta\.env\.DEV && impliesQualifiedLead && !qualifiedLead/
    .test(CARD));
  assert(/if \(blocked \|\| routingMismatch\) return;/.test(CARD));
});

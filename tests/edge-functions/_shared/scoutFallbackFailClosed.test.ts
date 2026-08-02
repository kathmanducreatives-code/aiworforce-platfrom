// Regression for the live Q1 Scout-fallback failure (plan c0f0d7eb).
//
// Part 1 (this file, "reproduce" commit): prove — with the REAL production
// hand-off helpers and the frozen live data — that Scout fabricated 10 founders
// with no provider backing, that the provider index was empty (source_with_apify
// never ran), and that the hand-off guard WOULD block all 10 the moment it is
// reached. The live defect was that routing skipped the guard entirely.
//
// Later commits add the fail-closed routing/finalization assertions.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildProviderIndexFromItems,
  parseScoutCandidates,
  guardScoutToAria,
} from "../../supabase/functions/_shared/leadHandoffGuard.ts";
import {
  FROZEN_ACCEPTED_PROVIDER_ITEMS,
  FROZEN_FABRICATED_COUNT,
  FROZEN_LIVE_FAILURE_FACTS,
  FROZEN_SCOUT_FABRICATED_OUTPUT,
} from "../../supabase/functions/_shared/scoutFallbackFixture.ts";

Deno.test("repro: frozen Scout output parses to exactly 10 fabricated founders", () => {
  const candidates = parseScoutCandidates(FROZEN_SCOUT_FABRICATED_OUTPUT, null);
  assertEquals(candidates.length, FROZEN_FABRICATED_COUNT);
  // Every fabricated identity has NO provider URL of any kind.
  for (const c of candidates) {
    assertEquals(c.source_url ?? null, null);
    assertEquals(c.evidence_url ?? null, null);
  }
});

Deno.test("repro: no Apify run ⇒ empty provider index", () => {
  const index = buildProviderIndexFromItems(FROZEN_ACCEPTED_PROVIDER_ITEMS as never[]);
  assertEquals(index.companies.size, 0);
  assertEquals(index.people.size, 0);
  assertEquals(index.urls.size, 0);
});

Deno.test("repro: guardScoutToAria BLOCKS all 10 the moment it is reached (guard works; live defect was the bypass)", () => {
  const candidates = parseScoutCandidates(FROZEN_SCOUT_FABRICATED_OUTPUT, null);
  const index = buildProviderIndexFromItems(FROZEN_ACCEPTED_PROVIDER_ITEMS as never[]);
  const guard = guardScoutToAria(candidates, index);
  assertEquals(guard.verified.length, 0);
  assertEquals(guard.rejected.length, FROZEN_FABRICATED_COUNT);
  assertEquals(guard.shouldStop, true); // ⇒ Aria must NOT be invoked
});

Deno.test("repro: guardScoutToAria also blocks when the index is null (no sourcing path ran at all)", () => {
  const candidates = parseScoutCandidates(FROZEN_SCOUT_FABRICATED_OUTPUT, null);
  const guard = guardScoutToAria(candidates, null);
  assertEquals(guard.verified.length, 0);
  assertEquals(guard.shouldStop, true);
});

Deno.test("repro: frozen live failure facts document the unsafe pre-fix outcome", () => {
  // These are the observed live values the hotfix must flip.
  assertEquals(FROZEN_LIVE_FAILURE_FACTS.provider_calls, 0);
  assertEquals(FROZEN_LIVE_FAILURE_FACTS.fabricated_scout_candidates, 10);
  assertEquals(FROZEN_LIVE_FAILURE_FACTS.candidates_reaching_aria, 10);
  assertEquals(FROZEN_LIVE_FAILURE_FACTS.aria_invoked, true);
  assertEquals(FROZEN_LIVE_FAILURE_FACTS.marked_complete, true);
  assertEquals(FROZEN_LIVE_FAILURE_FACTS.persisted_leads, 0);
});

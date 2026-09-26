// THE CHAT'S EMPTY STATE READS THE COMPANY BRAIN'S V2 SHAPE — IT NEVER THROWS.
//
// Production, 2026-09-26: opening the chat after asking Pilot a question showed
// "Chat hit an error — Cannot read properties of undefined (reading
// 'industries')". `EmptyState` read `brain.icp.industries[0]`, but the brain it
// holds is `normalizeCompanyBrain(...)` — a `CompanyBrainV2`, which has no
// `icp` at all (industries live on `target_customer`, with a legacy profile's
// `icp.industries` folded in). So the read threw on every render, for every
// workspace; `tsc` had been reporting it as TS2339 since 873f7edd.
//
// Pure. No React, no network.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { toSavedBrainView } from "../../src/lib/companyBrainView.ts";

const industryOf = (profile: unknown) => toSavedBrainView(profile as never).brain.target_customer.industries[0]?.trim();

Deno.test("an empty, missing or legacy profile yields a readable industry list — never a throw", () => {
  assertEquals(industryOf(null), undefined);
  assertEquals(industryOf({}), undefined);
  assertEquals(industryOf({ icp: { industries: ["B2B SaaS", "fintech"] } }), "B2B SaaS", "a legacy icp is folded in");
  assertEquals(industryOf({ schema_version: 2, target_customer: { industries: ["Logistics"] } }), "Logistics");
});

Deno.test("EmptyState reads target_customer, not the icp a V2 brain does not have", async () => {
  const src = await Deno.readTextFile(new URL("../../src/components/chat/workspace/EmptyState.tsx", import.meta.url));
  assertFalse(/brain\.icp\b/.test(src), "brain.icp does not exist on CompanyBrainV2");
  assert(/brain\.target_customer\.industries/.test(src));
});

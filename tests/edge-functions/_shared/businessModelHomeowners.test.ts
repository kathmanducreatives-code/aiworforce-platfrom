// "For homeowners" names a consumer buyer. Residential trades (roofing, HVAC, plumbing) say it
// instead of "consumers", so without it a homeowner-only roofer was never read as consumer and
// was saved as "needs verification" (ATLAS pilot rehearsal 2026-11-09).
import { assert, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { statedFacets } from "../../../supabase/functions/_shared/businessModelMatch.ts";

const consumer = (s: string) => statedFacets([s]).has("consumer_customer");

Deno.test("a homeowner audience is a consumer customer", () => {
  assert(consumer("Sunny Roofs replaces roofs for homeowners."));
  assert(consumer("Trusted HVAC repair serving local home owners since 1998."));
  assert(consumer("We help first-time homebuyers find the right inspector."));
  assert(consumer("Flexible storage designed for renters."));
});

Deno.test("a business audience is still not a consumer customer", () => {
  assertFalse(consumer("Ironline Builders is a commercial general contractor serving developers and property management companies."));
  assertFalse(consumer("Midstate distributes MRO supplies to manufacturers and maintenance teams."));
});

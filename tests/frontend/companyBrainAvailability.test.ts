import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  companyBrainWritesBlocked, COMPANY_BRAIN_UNAVAILABLE_MESSAGE,
} from "../../src/lib/env/companyBrainAvailability.ts";

Deno.test("Company Brain writes: blocked only on the isolated TEST project", () => {
  assert(companyBrainWritesBlocked({ VITE_SUPABASE_URL: "https://tlvnfrxzjhsjgdofwehb.supabase.co" }));
  assertEquals(companyBrainWritesBlocked({ VITE_SUPABASE_URL: "https://ohsdatpvfdjdemstoiuj.supabase.co" }), false);
  assertEquals(companyBrainWritesBlocked({ VITE_SUPABASE_URL: "https://some-other-project.supabase.co" }), false);
  assertEquals(companyBrainWritesBlocked({}), false);
  assertEquals(companyBrainWritesBlocked({ VITE_SUPABASE_URL: 42 }), false);
});

Deno.test("Company Brain unavailable copy: says why, says what still works, never claims a conflict", () => {
  assertStringIncludes(COMPANY_BRAIN_UNAVAILABLE_MESSAGE, "blocks Company Brain writes by design");
  assertStringIncludes(COMPANY_BRAIN_UNAVAILABLE_MESSAGE, "ORION still answers");
  assert(!/changed elsewhere|still loading/i.test(COMPANY_BRAIN_UNAVAILABLE_MESSAGE));
});

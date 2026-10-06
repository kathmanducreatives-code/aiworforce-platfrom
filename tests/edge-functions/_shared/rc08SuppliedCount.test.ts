// RC08 — SUPPLIED COMPANIES ARE THE COUNT (quality run 2026-10-06, Fix Wave 2 step 2).
//
// A mission that names its companies and states no number asks for exactly
// those companies, not the default 5; spelling variants of one name are one
// company. Pure.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DEFAULT_REQUESTED_COUNT, dedupeSuppliedCompanies, effectiveRequestedCount,
} from "../../../supabase/functions/_shared/leadMission.ts";

Deno.test("RC08: no stated count → the supplied companies are the count; a stated count still wins", () => {
  assertEquals(effectiveRequestedCount({ requested_count: null, company_profile: { known_companies: ["LlamaIndex"] } }), 1);
  assertEquals(effectiveRequestedCount({ requested_count: null, company_profile: { known_companies: ["Ramp", "Mercury"] } }), 2);
  assertEquals(effectiveRequestedCount({ requested_count: 3, company_profile: { known_companies: ["LlamaIndex"] } }), 3);
  assertEquals(effectiveRequestedCount({ requested_count: null, company_profile: { known_companies: [] } }), DEFAULT_REQUESTED_COUNT);
  assertEquals(effectiveRequestedCount({ requested_count: null }), DEFAULT_REQUESTED_COUNT, "callers that pass no profile are unchanged");
});

Deno.test("RC08: spelling variants of one name are one company; different names are not merged", () => {
  assertEquals(dedupeSuppliedCompanies(["LlamaIndex", "Llama Index", "llama-index", "OpenAI", "Open AI"]), ["LlamaIndex", "OpenAI"]);
  assertEquals(dedupeSuppliedCompanies(["Ramp", "Rampart", "Mercury"]), ["Ramp", "Rampart", "Mercury"]);
  assertEquals(dedupeSuppliedCompanies(["Solana Labs", "Solana"]), ["Solana Labs", "Solana"], "a different name is a different company");
});

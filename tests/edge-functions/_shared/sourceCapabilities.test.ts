import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { getSourceCapability, isSourceConfigured, listSourceCapabilities, type CapabilitySourceType } from "../../../supabase/functions/_shared/sourceCapabilities.ts";
import { leadRequestToToolInput } from "../../../supabase/functions/_shared/leadIntake.ts";

const ALL: CapabilitySourceType[] = [
  "icp_search", "hiring_signal", "linkedin_intent_posts", "linkedin_comments",
  "competitor_engagement", "people_profiles", "company_search", "decision_makers",
];

Deno.test("capabilities: all 8 source options have an entry with honest message + output contract", () => {
  for (const st of ALL) {
    const c = getSourceCapability(st);
    assert(c, `missing capability for ${st}`);
    assert(c!.unavailable_message.length > 10, `${st} needs an unavailable_message`);
    assert(c!.output_contract.required_fields.length >= 1, `${st} needs an output contract`);
    assertEquals(typeof c!.configured, "boolean");
  }
  assertEquals(listSourceCapabilities().length, 8);
});

Deno.test("capabilities: linkedin_posts alias resolves to linkedin_intent_posts", () => {
  assertEquals(getSourceCapability("linkedin_posts")?.source_type, "linkedin_intent_posts");
});

Deno.test("capabilities: runtime configured derived from actor env (jobs token present)", () => {
  Deno.env.set("APIFY_API_TOKEN", "test-token"); // enables apify_jobs (enabled:true + required_env)
  // Jobs-backed sources become configured; people/comments still need their own flags.
  assert(isSourceConfigured("hiring_signal"), "hiring should be configured with jobs token");
  assert(isSourceConfigured("company_search"), "company_search reuses jobs → configured");
  assert(isSourceConfigured("icp_search"), "icp configured via any_of (jobs route)");
  assert(!isSourceConfigured("people_profiles"), "people needs its own actor flag");
  assert(!isSourceConfigured("decision_makers"), "decision-makers needs people actor");
  assert(!isSourceConfigured("linkedin_comments"), "comments needs its own actor flag");
});

Deno.test("capabilities: unconfigured sources expose a fallback_action", () => {
  assertEquals(getSourceCapability("icp_search")?.fallback_action, "company_search");
  assertEquals(getSourceCapability("people_profiles")?.fallback_action, "company_search");
  assertEquals(getSourceCapability("linkedin_comments")?.fallback_action, "linkedin_intent_posts");
  assertEquals(getSourceCapability("competitor_engagement")?.fallback_action, "linkedin_intent_posts");
});

// Phase 11 #4-7 — no source silently routes to the Jobs actor incorrectly.
Deno.test("routing: people/profile + linkedin sources never use the jobs actor", () => {
  const r = (st: string, extra: Record<string, unknown> = {}) =>
    leadRequestToToolInput({ source_type: st as never, mode: "people", count: 5, needs_outreach: false, original_user_request: "x", company_brain_context_used: false, ...extra });
  assertEquals(r("people_profiles").selected_actor_key, "apify_people_search");
  assertEquals(r("linkedin_posts").selected_actor_key, "apify_linkedin_posts");
  assertEquals(r("competitor_engagement", { competitors: ["Clay"] }).selected_actor_key, "apify_linkedin_posts");
  // hiring/company DO use jobs (correct).
  assertEquals(r("hiring_signal").selected_actor_key, "apify_jobs");
  assertEquals(r("company_search", { company_category: "Recruiting Agency" }).selected_actor_key, "apify_jobs");
});

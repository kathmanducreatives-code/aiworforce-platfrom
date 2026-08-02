import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  inferContactPersona, deriveOpportunityStatus, recommendNextAction,
  buildLeadResultsHeader, canDraftOutreach, guessDomain, enrichmentStatus, isContactReadySource,
} from "../../supabase/functions/_shared/leadOpportunity.ts";

Deno.test("#1 hiring signal (companies only) → needs_contact", () => {
  assertEquals(deriveOpportunityStatus({ source_type: "hiring_signal", has_contact: false }), "needs_contact");
  assert(!isContactReadySource("hiring_signal"));
});

Deno.test("#2 people source with profile → contact_found", () => {
  assertEquals(deriveOpportunityStatus({ source_type: "people_profiles", has_contact: true }), "contact_found");
  assert(isContactReadySource("people_profiles"));
});

Deno.test("#3 no contact → draft outreach blocked", () => {
  assert(!canDraftOutreach(null));
  assert(!canDraftOutreach({ name: null }));
  assert(canDraftOutreach({ name: "Jane Doe" }));
  assert(canDraftOutreach({ linkedin_url: "https://linkedin.com/in/x" }));
});

Deno.test("#4 no website → enrichment needs domain (until discovery)", () => {
  const none = guessDomain({ company: null });
  assertEquals(none.confidence, "unavailable");
  assertEquals(enrichmentStatus(none), "needs_domain");
});

Deno.test("#4b probable domain from company name is labelled, not asserted", () => {
  const g = guessDomain({ company: "HireRight Inc" });
  assertEquals(g.confidence, "probable");
  assertEquals(g.domain, "hireright.com");
  assertEquals(enrichmentStatus(g), "needs_confirmation");
});

Deno.test("#4c real website/source URL → found → enrichable", () => {
  assertEquals(guessDomain({ website: "https://www.stripe.com/jobs" }).confidence, "found");
  assertEquals(enrichmentStatus(guessDomain({ website: "stripe.com" })), "enrichable");
  // LinkedIn/job-board source URLs are NOT treated as the company domain
  assertEquals(guessDomain({ source_url: "https://www.linkedin.com/jobs/123", company: "Fin" }).confidence, "probable");
});

Deno.test("#5 accounts, no contacts → next action find_contacts", () => {
  const na = recommendNextAction({ accounts: 4, contacts: 0 });
  assertEquals(na.action, "find_contacts");
  assert(/no one to contact/i.test(na.reason));
});

Deno.test("#6 contacts, no enrichment → next action research_company", () => {
  assertEquals(recommendNextAction({ accounts: 4, contacts: 4, enriched_contacts: 0 }).action, "research_company");
});

Deno.test("#7 contacts + enrichment → next action draft_outreach", () => {
  assertEquals(recommendNextAction({ accounts: 4, contacts: 4, enriched_contacts: 4 }).action, "draft_outreach");
});

Deno.test("tool failure → fix_integration; partial → broaden_search", () => {
  assertEquals(recommendNextAction({ accounts: 0, contacts: 0, tool_failed: true }).action, "fix_integration");
  assertEquals(recommendNextAction({ accounts: 0, contacts: 0, requested: 5 }).action, "broaden_search");
});

Deno.test("#8 header never says 'lead leads'", () => {
  assertEquals(buildLeadResultsHeader({ accounts: 4, contacts: 0 }), "4 account opportunities found");
  assertEquals(buildLeadResultsHeader({ accounts: 1, contacts: 0 }), "1 account opportunity found");
  assertEquals(buildLeadResultsHeader({ accounts: 5, contacts: 5 }), "5 contact-ready leads found");
  assertEquals(buildLeadResultsHeader({ accounts: 4, contacts: 2 }), "4 opportunities · 2 contacts found");
  for (const h of [buildLeadResultsHeader({ accounts: 4, contacts: 0 }), buildLeadResultsHeader({ accounts: 0, contacts: 0 })]) {
    assert(!/lead leads/i.test(h));
  }
});

Deno.test("persona inference by signal role", () => {
  assert(inferContactPersona("Senior Account Executive").personas.includes("VP Sales"));
  assert(inferContactPersona("ABM Marketing Manager").personas.includes("Head of Growth"));
  assert(inferContactPersona("Technical Recruiter").personas.includes("Head of People"));
  assertEquals(inferContactPersona("").primary, "Founder");
});

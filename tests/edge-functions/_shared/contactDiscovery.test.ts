import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isFindContactsRequest, personaForAccounts, buildContactSearchQueries,
  normalizeDiscoveredContact, matchContactToAccount, planContactAttachments,
  contactDiscoveryFallback, resolveCompanyContactTarget, type AccountForContacts,
} from "../../../supabase/functions/_shared/contactDiscovery.ts";

const accounts: AccountForContacts[] = [
  { lead_candidate_id: "lc1", company: "HireRight Inc", signal_role: "Account Executive" },
  { lead_candidate_id: "lc2", company: "Stripe", signal_role: "Account Executive" },
  { lead_candidate_id: "lc3", company: "Fin", signal_role: "Account Executive" },
];

Deno.test("detects find-decision-makers asks", () => {
  assert(isFindContactsRequest("Find decision-makers at these companies."));
  assert(isFindContactsRequest("find contacts"));
  assert(!isFindContactsRequest("Find 5 companies hiring GTM roles."));
});

Deno.test("persona inferred from account signal role (sales → VP Sales primary)", () => {
  const p = personaForAccounts(accounts);
  assertEquals(p.primary, "VP Sales");
  assert(p.personas.includes("Founder"));
});

Deno.test("builds capped persona@company queries (no raw descriptions)", () => {
  const p = personaForAccounts(accounts);
  const q = buildContactSearchQueries(accounts, p, { maxQueries: 4 });
  assertEquals(q.length, 4);
  assert(q.includes("VP Sales at HireRight Inc"));
  assert(q.every((s) => s.split(" ").length <= 6));
});

Deno.test("normalizeDiscoveredContact drops nameless results (no invent)", () => {
  assertEquals(normalizeDiscoveredContact({ company: "Stripe", title: "VP Sales" }), null);
  const c = normalizeDiscoveredContact({ name: "Jane Doe", title: "VP Sales", company: "Stripe", linkedinUrl: "https://linkedin.com/in/jane" });
  assert(c && c.name === "Jane Doe" && c.linkedin_url?.includes("jane"));
});

Deno.test("matchContactToAccount matches by company (exact + normalized)", () => {
  const c = normalizeDiscoveredContact({ name: "Jane", company: "HireRight", title: "VP Sales", linkedinUrl: "https://linkedin.com/in/jane" })!;
  assertEquals(matchContactToAccount(c, accounts), "lc1"); // "HireRight" ~ "HireRight Inc"
  const none = normalizeDiscoveredContact({ name: "Bob", company: "Unrelated Co", title: "VP Sales", linkedinUrl: "https://linkedin.com/in/bob" })!;
  assertEquals(matchContactToAccount(none, accounts), null);
});

Deno.test("planContactAttachments: one contact per account, deduped, no invented", () => {
  const raw = [
    { name: "Jane", company: "HireRight", title: "VP Sales", linkedinUrl: "https://linkedin.com/in/jane" },
    { name: "Jane2", company: "HireRight", title: "Head of Sales", linkedinUrl: "https://linkedin.com/in/jane2" }, // 2nd for same account → ignored
    { company: "Stripe", title: "VP Sales", linkedinUrl: "https://linkedin.com/in/x" }, // no name → dropped
    { name: "Carl", company: "Stripe", title: "VP Sales", linkedinUrl: "https://linkedin.com/in/carl" }, // attaches to lc2
    { name: "Nobody", company: "Acme", title: "CEO", linkedinUrl: "https://linkedin.com/in/nobody" }, // no matching account → dropped
  ];
  const plan = planContactAttachments(raw, accounts);
  assertEquals(plan.length, 2);
  assertEquals(plan.find((p) => p.lead_candidate_id === "lc1")?.contact.name, "Jane");
  assertEquals(plan.find((p) => p.lead_candidate_id === "lc2")?.contact.name, "Carl");
});

Deno.test("fallback message is honest + offers alternatives, never invents", () => {
  const m = contactDiscoveryFallback();
  assert(/configured/i.test(m) && /invent/i.test(m));
});

Deno.test("resolveCompanyContactTarget resolves and filters company fields", () => {
  const row = {
    account_id: "a1",
    company: "Stripe",
    signal_role: "Account Executive",
    account: {
      id: "a1",
      name: "Stripe",
      domain: "stripe.com",
      website_url: "https://stripe.com",
      linkedin_url: "https://linkedin.com/company/stripe",
      location: "San Francisco",
    },
    signal: {
      source_url: "https://linkedin.com/jobs/view/12345",
    }
  };
  
  const target = resolveCompanyContactTarget(row);
  assertEquals(target.account_id, "a1");
  assertEquals(target.company_name, "Stripe");
  assertEquals(target.domain, "stripe.com");
  assertEquals(target.website_url, "https://stripe.com");
  assertEquals(target.linkedin_company_url, "https://linkedin.com/company/stripe");
  assert(target.confidence_notes.length === 0);
  assert(!target.needs_company_resolution);
  
  // Job board website/domain dropping
  const jobRow = {
    account: {
      name: "Scale AI",
      website_url: "https://linkedin.com/jobs/view/999",
      domain: "linkedin.com",
    }
  };
  const target2 = resolveCompanyContactTarget(jobRow);
  assertEquals(target2.website_url, undefined);
  assertEquals(target2.domain, undefined);
  assert(target2.needs_company_resolution);
  assert(target2.confidence_notes.includes("website_url is a job board link"));
});

Deno.test("normalizeDiscoveredContact rejects invalid/wrong profiles", () => {
  // Reject missing name
  assertEquals(normalizeDiscoveredContact({ title: "CEO", linkedinUrl: "url", company: "Stripe" }), null);
  // Reject missing profile URL
  assertEquals(normalizeDiscoveredContact({ name: "Jane", title: "CEO", company: "Stripe" }), null);
  // Reject missing title
  assertEquals(normalizeDiscoveredContact({ name: "Jane", linkedinUrl: "url", company: "Stripe" }), null);
  // Reject wrong title keyword
  assertEquals(normalizeDiscoveredContact({ name: "Jane", title: "Marketing Intern", linkedinUrl: "url", company: "Stripe" }), null);
  // Reject weak company signal
  assertEquals(normalizeDiscoveredContact({ name: "Jane", title: "CEO", linkedinUrl: "url" }), null);
  
  // Correct profile
  const c = normalizeDiscoveredContact({ name: "Jane", title: "VP Sales", linkedinUrl: "https://linkedin.com/in/jane", company: "Stripe" });
  assert(c !== null);
  assertEquals(c!.name, "Jane");
});

Deno.test("exact company URL matching and best candidate scoring", () => {
  const customAccounts: AccountForContacts[] = [
    { lead_candidate_id: "lc1", company: "Acme", linkedin_company_url: "https://linkedin.com/company/acme" },
  ];
  
  // URL matching
  const c = normalizeDiscoveredContact({
    name: "Alice",
    title: "CEO",
    linkedinUrl: "url1",
    company: "Acme Corp",
    companyUrl: "https://linkedin.com/company/acme",
  })!;
  const plan = planContactAttachments([c], customAccounts);
  assertEquals(plan.length, 1);
  assertEquals(plan[0].lead_candidate_id, "lc1");
  
  // Score-based selection: primary title gets higher score
  const c1 = normalizeDiscoveredContact({
    name: "Low Title",
    title: "Head of Growth",
    linkedinUrl: "url1",
    company: "Acme",
  })!;
  const c2 = normalizeDiscoveredContact({
    name: "High Title",
    title: "CEO", // primary for generic fallback is Founder/CEO
    linkedinUrl: "url2",
    company: "Acme",
  })!;
  
  const planMultiple = planContactAttachments([c1, c2], customAccounts);
  assertEquals(planMultiple.length, 1);
  assertEquals(planMultiple[0].contact.name, "High Title"); // CEO score is higher than Head of Growth
});

Deno.test("normalizeDiscoveredContact extracts company_url from nested currentPosition and matches account company url", () => {
  const accountsWithUrls: AccountForContacts[] = [
    { lead_candidate_id: "lc_google", company: "Tabz (FKA HealNow)", linkedin_company_url: "https://www.linkedin.com/company/google" },
  ];
  const rawContact = {
    name: "Janine Lee",
    linkedinUrl: "https://www.linkedin.com/in/janinelee",
    currentPosition: [
      {
        position: "Global Head of Learning",
        companyName: "Google",
        companyLinkedinUrl: "https://www.linkedin.com/company/google/"
      }
    ]
  };
  const c = normalizeDiscoveredContact(rawContact);
  assert(c);
  assertEquals(c.company_url, "https://www.linkedin.com/company/google/");
  
  const match = matchContactToAccount(c, accountsWithUrls);
  assertEquals(match, "lc_google");
});


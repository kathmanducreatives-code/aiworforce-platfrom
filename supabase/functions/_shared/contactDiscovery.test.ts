import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isFindContactsRequest, personaForAccounts, buildContactSearchQueries,
  normalizeDiscoveredContact, matchContactToAccount, planContactAttachments,
  contactDiscoveryFallback, type AccountForContacts,
} from "./contactDiscovery.ts";

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
  const c = normalizeDiscoveredContact({ name: "Jane", company: "HireRight" })!;
  assertEquals(matchContactToAccount(c, accounts), "lc1"); // "HireRight" ~ "HireRight Inc"
  const none = normalizeDiscoveredContact({ name: "Bob", company: "Unrelated Co" })!;
  assertEquals(matchContactToAccount(none, accounts), null);
});

Deno.test("planContactAttachments: one contact per account, deduped, no invented", () => {
  const raw = [
    { name: "Jane", company: "HireRight", title: "VP Sales", linkedinUrl: "x" },
    { name: "Jane2", company: "HireRight", title: "Head of Sales" }, // 2nd for same account → ignored
    { company: "Stripe", title: "VP Sales" },                        // no name → dropped
    { name: "Carl", company: "Stripe", title: "VP Sales" },          // attaches to lc2
    { name: "Nobody", company: "Acme" },                             // no matching account → dropped
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

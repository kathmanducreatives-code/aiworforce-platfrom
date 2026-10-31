// Realistic offline fixtures for the discovery engine. Synthetic companies and people.
// Apify rows follow the catalogued live output shapes (hiringActorCatalog.ts);
// LeadOcean rows follow the shapes observed in validation test V.

import type { ActorInvoker } from "../../../../supabase/functions/_shared/discoveryProviders/adapters/apify.ts";
import { leadOceanAdapter } from "../../../../supabase/functions/_shared/discoveryProviders/adapters/leadocean.ts";
import { memoryLedger } from "../../../../supabase/functions/_shared/discoveryProviders/budget.ts";
import { ExclusionIndex } from "../../../../supabase/functions/_shared/leadPipeline/exclusions.ts";
import { memoryEvidenceCache } from "../../../../supabase/functions/_shared/discoveryEngine/cache.ts";
import { leadOceanSource } from "../../../../supabase/functions/_shared/discoveryEngine/sources/leadocean.ts";
import { apifySource } from "../../../../supabase/functions/_shared/discoveryEngine/sources/apify.ts";
import { apolloSource } from "../../../../supabase/functions/_shared/discoveryEngine/sources/apollo.ts";
import type { PlannerContext } from "../../../../supabase/functions/_shared/discoveryEngine/planner.ts";
import type { InterpreterModel } from "../../../../supabase/functions/_shared/discoveryEngine/spec.ts";
import { loPage, loPerson, mockFetch, noSleep, type MockReply, type Synthetic } from "../discoveryProviders/fixtures.ts";
import { companyRecord } from "../leadPipeline/fixtures.ts";

export const NOW = () => new Date("2026-10-31T12:00:00Z");
export const WS = "33333333-3333-4333-8333-333333333333";
export const WS_OTHER = "44444444-4444-4444-8444-444444444444";

/** What GPT returns for each example request (the interpreter's model output). */
export const MODEL_OUTPUT: Record<string, unknown> = {
  "Find 10 founders of US SaaS companies with 10-100 employees.": {
    target: "people", quantity: 10, roles: ["Founder", "Co-Founder", "CEO"], company: { industries: ["SaaS"], descriptors: [], employees: { min: 10, max: 100 } },
    geography: { hq: ["United States"], person: [] }, signals: [], hard: ["geography_hq", "employee_range", "roles"],
    grounding: { geography_hq: "US", employee_range: "10-100 employees", roles: "founders" }, preferences: [], contact: { phone: "none" }, verification: {},
  },
  "Find US companies hiring Account Executives in the past 30 days.": {
    target: "companies", quantity: 10, roles: [], company: { industries: [], descriptors: [], employees: null },
    geography: { hq: ["United States"], person: [] }, signals: [{ kind: "hiring", roles: ["Account Executive"], withinDays: 30, required: true }],
    hard: ["geography_hq", "signal:hiring"], grounding: { geography_hq: "US companies", "signal:hiring": "hiring Account Executives in the past 30 days" },
  },
  "Find US SaaS founders at companies hiring salespeople.": {
    target: "people", quantity: 10, roles: ["Founder", "Co-Founder", "CEO"], company: { industries: ["SaaS"], descriptors: [], employees: null },
    geography: { hq: ["United States"], person: [] }, signals: [{ kind: "hiring", roles: ["Sales Representative", "Account Executive", "SDR"], withinDays: null, required: true }],
    hard: ["geography_hq", "roles", "signal:hiring"], grounding: { geography_hq: "US", roles: "founders", "signal:hiring": "hiring salespeople" },
  },
  "Find US marketing agencies posting about AI automation.": {
    target: "companies", quantity: 10, roles: [], company: { industries: ["marketing agency"], descriptors: [], employees: null },
    geography: { hq: ["United States"], person: [] }, signals: [{ kind: "posts", topics: ["AI automation"], withinDays: 90, required: true }],
    hard: ["geography_hq", "signal:posts"], grounding: { geography_hq: "US", "signal:posts": "posting about AI automation" },
  },
  "Find founders at recently funded US companies with 10-200 employees.": {
    target: "people", quantity: 10, roles: ["Founder", "Co-Founder"], company: { industries: [], descriptors: [], employees: { min: 10, max: 200 } },
    geography: { hq: ["United States"], person: [] }, signals: [{ kind: "funding", withinDays: 365, required: false }],
    hard: ["geography_hq", "employee_range", "roles"], grounding: { geography_hq: "US", employee_range: "10-200 employees", roles: "founders" },
  },
};
export const fixtureModel: InterpreterModel = (_s, user) => Promise.resolve(structuredClone(MODEL_OUTPUT[user] ?? {}));

export const ALL_ON = (over: Partial<PlannerContext["providers"]> = {}): PlannerContext => ({
  providers: { leadocean: { enabled: true, permitted: true }, apify: { enabled: true, permitted: true }, apollo: { enabled: false, permitted: false, reason: "not validated" }, ...over },
  caps: { leadoceanRecords: 100, apifyUsd: 2 },
});

// ── Apify rows ──────────────────────────────────────────────────────────────
export function jobRow(slug: string, o: { title?: string; posted?: string; hq?: string; band?: [number, number]; website?: string } = {}) {
  return {
    id: `job-${slug}`, title: o.title ?? "Account Executive", linkedinUrl: `https://www.linkedin.com/jobs/view/${slug}-1`, jobState: "LISTED", postedDate: o.posted ?? "2026-10-22",
    company: { id: `c-${slug}`, universalName: slug, name: slug[0].toUpperCase() + slug.slice(1), linkedinUrl: `https://www.linkedin.com/company/${slug}`,
      website: o.website ?? `https://${slug}.example`, employeeCountRange: { start: (o.band ?? [51, 200])[0], end: (o.band ?? [51, 200])[1] },
      industries: [{ name: "Software Development" }], locations: [{ headquarter: true, parsed: { text: o.hq ?? "Austin, Texas, United States" } }] },
    location: { linkedinText: "Austin, TX" }, workplaceType: "hybrid",
  };
}
export const postRow = (slug: string, text: string, date = "2026-10-25T09:00:00.000Z", authorType = "company") => ({
  type: "post", id: `p-${slug}`, linkedinUrl: `https://www.linkedin.com/posts/${slug}-1`, content: text, postedAt: { date },
  author: { name: slug, linkedinUrl: authorType === "company" ? `https://www.linkedin.com/company/${slug}` : `https://www.linkedin.com/in/${slug}`, type: authorType },
});
export const employeeRow = (first: string, last: string, slug: string, title = "Co-Founder & CEO") => ({
  id: `ACwAA${first}${last}`, firstName: first, lastName: last, linkedinUrl: `https://www.linkedin.com/in/ACwAA${first}${last}`,
  currentPositions: [{ title, companyName: slug, companyLinkedinUrl: `https://www.linkedin.com/company/${slug}`, current: true }],
});
export const US_RECORD = (slug: string, band: [number, number] = [51, 200]) => companyRecord(slug, { name: slug, website: `https://${slug}.example`, hqCountry: "US", city: "Austin", band });
export const CA_RECORD = (slug: string) => companyRecord(slug, { name: slug, website: `https://${slug}.example`, hqCountry: "CA", city: "Toronto", band: [51, 200] });

export interface ApifyScript { jobs?: unknown[]; posts?: unknown[]; employees?: unknown[]; records?: Record<string, unknown>; hang?: string[]; fail?: string[] }
export function apifyMock(script: ApifyScript) {
  const calls: { actor: string; input: Record<string, unknown> }[] = [];
  const invoke: ActorInvoker = (actor, input) => {
    calls.push({ actor, input });
    if (script.hang?.includes(actor)) return new Promise(() => {});
    if (script.fail?.includes(actor)) return Promise.reject(new Error(`${actor} down`));
    switch (actor) {
      case "apify_linkedin_job_search": return Promise.resolve({ items: script.jobs ?? [], chargedUsd: 0.001 + 0.001 * (script.jobs ?? []).length });
      case "apify_linkedin_post_search": return Promise.resolve({ items: script.posts ?? [], chargedUsd: 0.00005 + 0.002 * (script.posts ?? []).length });
      case "apify_linkedin_company_employees": return Promise.resolve({ items: script.employees ?? [], chargedUsd: 0.05 });
      case "apify_linkedin_company_details": {
        const items = (input.companies as string[]).map((u) => script.records?.[/company\/([^/]+)/.exec(u)![1]]).filter(Boolean);
        return Promise.resolve({ items, chargedUsd: 0.00005 + 0.004 * items.length });
      }
      default: return Promise.resolve({ items: [], chargedUsd: 0.001 });
    }
  };
  return { invoke, calls, actorCalls: (a: string) => calls.filter((c) => c.actor === a) };
}

export function leadOceanMock(searchReplies: MockReply[]) {
  const f = mockFetch({ "POST /v1/search": searchReplies, "POST /v1/search/companies": searchReplies, "POST /v1/people/phone": [{ status: 500, body: {} }] });
  return { adapter: leadOceanAdapter({ apiKey: "offline", fetch: f.fetch, sleep: noSleep, now: NOW }), calls: f.calls };
}
export const loReply = (people: Synthetic[]): MockReply => ({ body: loPage(people.map(loPerson)) });
export const founder = (id: string, slug: string, o: Partial<Synthetic> = {}): Synthetic =>
  ({ id, name: `Founder ${id}`, title: "Founder & CEO", company: slug, domain: `${slug}.example`, industry: "Software Development", employees: 60, phone: "+1 512 555 0" + id.slice(-3), ...o });

export function world(lo: MockReply[], ap: ApifyScript) {
  const l = leadOceanMock(lo);
  const a = apifyMock(ap);
  return {
    l, a,
    sources: { leadocean: leadOceanSource(l.adapter), apify: apifySource(a.invoke), apollo: apolloSource(null) },
    ledger: memoryLedger(), cache: memoryEvidenceCache(), existing: new ExclusionIndex([], NOW),
  };
}

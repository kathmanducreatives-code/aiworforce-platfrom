// Synthetic inputs for the lead pipeline's offline tests. No real company or person.

import type { ActorInvoker } from "../../../../supabase/functions/_shared/discoveryProviders/adapters/apify.ts";
import { leadOceanAdapter } from "../../../../supabase/functions/_shared/discoveryProviders/adapters/leadocean.ts";
import type { ContactPoint } from "../../../../supabase/functions/_shared/discoveryProviders/types.ts";
import { configureIcp, ICP_A } from "../../../../supabase/functions/_shared/leadPipeline/icp.ts";
import { conn, loPage, loPerson, mockFetch, noSleep, type Synthetic } from "../discoveryProviders/fixtures.ts";

export const NOW = () => new Date("2026-10-31T12:00:00Z");
export const WS = "22222222-2222-4222-8222-222222222222";
export const ICP = configureIcp(ICP_A, { requestedCount: 5 });
export const CONNECTIONS = [conn("leadocean")];
export const LIMITS = { overfetch: 1 };

export const PEOPLE: Synthetic[] = [
  { id: "1001", name: "Ada Quill", title: "Founder & CEO", company: "Acme Saas", domain: "acmesaas.example", industry: "Software Development", employees: 60, phone: "+1 512 555 0101" },
  { id: "1002", name: "Bo Lark", title: "Chief Revenue Officer", company: "Beta Cloud", domain: "betacloud.example", industry: "Software Development", employees: 120, phone: "+1 416 555 0102" },
  { id: "1003", name: "Cy Moss", title: "CEO", company: "Gamma Ops", domain: "gammaops.example", industry: "Technology; Information and Internet", employees: 40 },
  { id: "1004", name: "Di Fenn", title: "Founder", company: "Delta Flow", domain: "deltaflow.example", industry: "Software Development", employees: 30, phone: "+1 303 555 0104" },
  { id: "1005", name: "Ed Rook", title: "VP Sales", company: "Epsilon Labs", domain: "epsilonlabs.example", industry: "IT Services and IT Consulting", employees: 90, phone: "+1 617 555 0105" },
];

/** harvestapi/linkedin-company rows (documented output fields the Apify engine's normalizer reads). */
export function companyRecord(slug: string, o: { name: string; website: string; hqCountry: string; city: string; band: [number, number]; description?: string }) {
  return {
    id: `li-${slug}`, name: o.name, linkedinUrl: `https://www.linkedin.com/company/${slug}`, website: o.website,
    description: o.description ?? null, employeeCount: o.band[0] + 5, employeeCountRange: { start: o.band[0], end: o.band[1] },
    locations: [{ headquarter: true, city: o.city, country: o.hqCountry, parsed: { text: `${o.city}, ${o.hqCountry === "US" ? "United States" : "Canada"}`, countryFull: o.hqCountry === "US" ? "United States" : "Canada" } }],
    companyType: "Privately Held",
  };
}

export const COMPANY_RECORDS: Record<string, unknown> = {
  acmesaas: companyRecord("acmesaas", { name: "Acme Saas", website: "https://acmesaas.example", hqCountry: "US", city: "Austin", band: [51, 200], description: "B2B SaaS workflow platform for teams." }),
  betacloud: companyRecord("betacloud", { name: "Beta Cloud", website: "https://betacloud.example", hqCountry: "CA", city: "Toronto", band: [51, 200] }),
  // gammaops: no record (not_found)
  deltaflow: companyRecord("deltaflow", { name: "Delta Flow", website: "https://deltaflow.example", hqCountry: "US", city: "Denver", band: [11, 50] }),
  epsilonlabs: companyRecord("epsilonlabs", { name: "Epsilon Labs", website: "https://epsilonlabs.example", hqCountry: "US", city: "Boston", band: [51, 200] }),
};

export function apifyMock(opts: { failJobs?: boolean } = {}) {
  const calls: { actor: string; input: Record<string, unknown>; key: string }[] = [];
  const invoke: ActorInvoker = (actor, input, o) => {
    calls.push({ actor, input, key: o.idempotencyKey });
    if (actor === "apify_linkedin_company_details") {
      const items = (input.companies as string[]).map((u) => COMPANY_RECORDS[/company\/([^/]+)/.exec(u)![1]]).filter(Boolean);
      return Promise.resolve({ items, runId: "run-company", chargedUsd: 0.00005 + 0.004 * items.length });
    }
    if (actor === "apify_linkedin_job_search") {
      if (opts.failJobs) return Promise.reject(new Error("actor failed"));
      const target = String((input.company as string[])[0]);
      if (!target.includes("acmesaas")) return Promise.resolve({ items: [], runId: "run-jobs-empty", chargedUsd: 0.001 });
      return Promise.resolve({ items: [{ id: "j1", linkedinUrl: "https://www.linkedin.com/jobs/view/j1", title: "Sales Development Representative", postedDate: "2026-10-20", company: { name: "Acme Saas", linkedinUrl: "https://www.linkedin.com/company/acmesaas" }, location: { linkedinText: "Austin, TX" } }], runId: "run-jobs", chargedUsd: 0.002 });
    }
    if (actor === "apify_linkedin_company_posts") {
      // An undated hiring post: never counted as recent.
      return Promise.resolve({ items: [{ content: "We're hiring across our go-to-market team!", linkedinUrl: "https://www.linkedin.com/posts/x1", postedAt: "2 weeks ago" }], runId: "run-posts", chargedUsd: 0.00205 });
    }
    return Promise.resolve({ items: [], runId: "run-other" });
  };
  return { invoke, calls };
}

export function leadOceanMock(people: Synthetic[] = PEOPLE) {
  const f = mockFetch({ "POST /v1/search": [{ body: loPage(people.map(loPerson)) }] });
  const deps = { apiKey: "offline-test-key", fetch: f.fetch, sleep: noSleep, now: NOW };
  return { adapter: leadOceanAdapter(deps), deps, calls: f.calls };
}

export function phoneMock() {
  const calls: string[] = [];
  const types: Record<string, string> = { "1001": "mobile", "1005": "office", "1004": "mobile", "1002": "mobile" };
  const call = (_deps: unknown, input: { personId?: string | null; linkedinUrl?: string | null }) => {
    const id = input.personId ?? "?";
    calls.push(id);
    const pts: ContactPoint[] = types[id] ? [{ kind: "phone", value: `+1 512 555 0${id.slice(-3)}`, type: types[id], provider: "leadocean", recordId: id, verification: "provider_supplied_unverified", retrievedAt: NOW().toISOString() }] : [];
    return Promise.resolve({ found: pts.length > 0, points: pts, credits: 1, recordId: id });
  };
  return { call, calls };
}

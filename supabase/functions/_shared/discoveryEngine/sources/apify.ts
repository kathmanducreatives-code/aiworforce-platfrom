// Apify as a discovery source. Every run goes through the ledgered invoker
// (leadPipeline/apifyInvoker.ts): reserved at its worst case before it starts,
// replayed if settled, never re-run after an uncertain charge, inside the step's
// USD ceiling. Input shapes and defects are the actor catalogue's
// (hiringActorCatalog.ts); rows are provider claims.

import type { ActorInvoker } from "../../discoveryProviders/adapters/apify.ts";
import type { ProviderCompany, ProviderPerson } from "../../discoveryProviders/types.ts";
import { normalizeLinkedInJob } from "../../hiringActorNormalizers.ts";
import { companyLinkedInSlug, normalizeDomain } from "../../decisionMaker/companyIdentity.ts";
import { ledgeredInvoker, PIPELINE_ACTORS } from "../../leadPipeline/apifyInvoker.ts";
import { SIGNAL_ACTORS, signalsFromJobs, signalsFromPosts, worstCaseUsd } from "../../leadPipeline/signals.ts";
import { emptyResult, type DiscoverySource, type SourceRunInput, type SourceRunResult } from "../sources.ts";

const ACTOR = { hiring: "apify_linkedin_job_search", posts: "apify_linkedin_post_search", employees: "apify_linkedin_company_employees", people: "apify_people_search" } as const;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const US = /^(us|usa|united states( of america)?)$/i;

export function jobPostedLimit(days: number | null): string | null {
  if (days == null) return null;
  return days <= 1 ? "24h" : days <= 7 ? "week" : "month";
}
export function postPostedLimit(days: number | null): string | null {
  if (days == null) return null;
  return days <= 1 ? "24h" : days <= 7 ? "week" : days <= 31 ? "month" : days <= 92 ? "3months" : days <= 183 ? "6months" : "year";
}
const locationsOf = (hq: string[]) => hq.map((g) => (US.test(g) ? "United States" : g)).slice(0, 2);

/** A company named by a job row — the employer's own LinkedIn page fields, as claims. */
function companyFromJobRow(r: Record<string, unknown>, at: string): ProviderCompany | null {
  const c = (r.company ?? {}) as Record<string, unknown>;
  const linkedinUrl = str(c.linkedinUrl);
  const slug = companyLinkedInSlug(linkedinUrl);
  if (!slug) return null;
  const range = (c.employeeCountRange ?? null) as { start?: number; end?: number } | null;
  const hq = Array.isArray(c.locations) ? (c.locations as Record<string, unknown>[]).find((l) => l.headquarter === true) : undefined;
  const hqText = str((hq?.parsed as Record<string, unknown> | undefined)?.text);
  return {
    provider: "apify", recordId: `li_company:${c.id ?? slug}`, retrievedAt: at,
    name: str(c.name), domain: normalizeDomain(c.website), linkedinUrl,
    industry: Array.isArray(c.industries) ? (c.industries as Record<string, unknown>[]).map((i) => str(i.name)).filter((x): x is string => !!x) : null,
    hqCountry: hqText ? hqText.split(",").pop()!.trim() : null,
    employeeRange: range && typeof range.start === "number" ? { min: range.start, max: typeof range.end === "number" ? range.end : null } : null,
  };
}

export function apifySource(invoke: ActorInvoker | null): DiscoverySource {
  return {
    id: "apify",
    async run(input: SourceRunInput): Promise<SourceRunResult> {
      if (!invoke) return emptyResult(["Apify is not connected for this workspace"], "not_connected");
      const at = input.now.toISOString();
      const ledgered = ledgeredInvoker(invoke, input.ledger, { workspaceId: input.workspaceId, missionId: `${input.missionId}:${input.stepId}`, maxUsd: input.maxCost });
      const key = (actor: string) => `${input.missionId}:${input.stepId}:${actor}`;
      const fits = (actor: string, items: number) => worstCaseUsd({ key: actor, ...PIPELINE_ACTORS[actor] }, items) <= input.maxCost + 1e-9;
      const call = async (actor: string, body: Record<string, unknown>, items: number) => {
        type R = { ok: true; run: import("../../discoveryProviders/adapters/apify.ts").ActorRun } | { ok: false; error: string };
        if (!fits(actor, items)) return { ok: false, error: `worst case for ${items} item(s) exceeds the step ceiling $${input.maxCost}` } as R;
        try { return { ok: true, run: await ledgered(actor, body, { maxItems: items, idempotencyKey: key(actor) }) } as R; }
        catch (e) { return { ok: false, error: `${actor} failed (${(e as Error)?.name ?? "error"}); not retried` } as R; }
      };
      /** The most items the step's remaining budget can pay for, at the worst case (partial progress, never overspend). */
      const affordable = (actor: string) => {
        const a = PIPELINE_ACTORS[actor];
        const room = input.maxCost - a.perStartUsd;
        if (room < a.emptyUsd - 1e-9) return 0;
        return a.perItemUsd > 0 ? Math.floor((room + 1e-9) / a.perItemUsd) : input.maxItems;
      };
      const spentOf = (actor: string, run: { items: unknown[]; chargedUsd?: number | null }) =>
        run.chargedUsd ?? worstCaseUsd({ key: actor, ...PIPELINE_ACTORS[actor] }, Math.max(1, run.items.length));

      switch (input.capability) {
        case "companies_by_hiring": {
          const sig = input.spec.signals.find((s) => s.kind === "hiring");
          const titles = (sig?.roles?.length ? sig.roles : input.spec.roles).slice(0, 3);
          if (!titles.length) return emptyResult(["hiring discovery needs at least one job title"], "unsupported");
          const locations = locationsOf(input.spec.geography.hq);
          // maxItems is PER title PER location (catalogue): split the step's ceiling.
          const lanes = titles.length * Math.max(1, locations.length);
          const per = Math.min(Math.max(1, Math.floor(input.maxItems / lanes)), Math.floor(affordable(ACTOR.hiring) / lanes));
          if (per < 1) return emptyResult([`the remaining budget $${input.maxCost} cannot pay for one job per title and location`], "budget");
          const total = per * lanes;
          const posted = jobPostedLimit(sig?.withinDays ?? null);
          const r = await call(ACTOR.hiring, { jobTitles: titles, ...(locations.length ? { locations } : {}), ...(posted ? { postedLimit: posted } : {}), maxItems: per, sortBy: "date" }, total);
          if (!r.ok) return emptyResult([r.error], "failed");
          const out = emptyResult(sig?.withinDays && sig.withinDays > 30 ? [`the job actor's widest window is a month; ${sig.withinDays} days narrowed to 30`] : []);
          for (const it of r.run.items) {
            const row = (it ?? {}) as Record<string, unknown>;
            const c = companyFromJobRow(row, at);
            if (!c) continue;
            out.companies.push(c);
            const slug = companyLinkedInSlug(c.linkedinUrl)!;
            out.signals.push(...signalsFromJobs([row], { kind: "company", key: `li:${slug}` }, SIGNAL_ACTORS.jobs, { chargedUsd: null }, input.now, sig?.withinDays ?? 30, new RegExp(titles.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "i")));
          }
          out.spent = spentOf(ACTOR.hiring, r.run); out.replayed = r.run.chargedUsd === 0;
          return out;
        }
        case "companies_by_posts": {
          const sig = input.spec.signals.find((s) => s.kind === "posts");
          const topics = (sig?.topics ?? []).slice(0, 3);
          if (!topics.length) return emptyResult(["post discovery needs a topic"], "unsupported");
          const per = Math.min(Math.max(1, Math.floor(input.maxItems / topics.length)), Math.floor(affordable(ACTOR.posts) / topics.length));
          if (per < 1) return emptyResult([`the remaining budget $${input.maxCost} cannot pay for one post per topic`], "budget");
          const posted = postPostedLimit(sig?.withinDays ?? null);
          const r = await call(ACTOR.posts, { searchQueries: topics, maxPosts: per, ...(posted ? { postedLimit: posted } : {}), sortBy: "date", profileScraperMode: "short", scrapeComments: false, scrapeReactions: false }, per * topics.length);
          if (!r.ok) return emptyResult([r.error], "failed");
          const out = emptyResult();
          let personAuthors = 0;
          for (const it of r.run.items) {
            const row = (it ?? {}) as Record<string, unknown>;
            if (row.type && row.type !== "post") continue;
            const author = (row.author ?? {}) as Record<string, unknown>;
            // Only a COMPANY page names a company; a person's headline is not employment (catalogue defect).
            if (author.type !== "company") { personAuthors++; continue; }
            const slug = companyLinkedInSlug(author.linkedinUrl);
            if (!slug) continue;
            out.companies.push({ provider: "apify", recordId: `li_company:${slug}`, retrievedAt: at, name: str(author.name), linkedinUrl: str(author.linkedinUrl) });
            out.signals.push(...signalsFromPosts([row], { kind: "company", key: `li:${slug}` }, SIGNAL_ACTORS.companyPosts, { chargedUsd: null }, input.now, sig?.withinDays ?? 90));
          }
          if (personAuthors) out.notes.push(`${personAuthors} post(s) by people skipped: an author's headline does not establish employment`);
          out.spent = spentOf(ACTOR.posts, r.run); out.replayed = r.run.chargedUsd === 0;
          return out;
        }
        case "people_at_companies": {
          const urls = input.seeds.map((s) => s.linkedinUrl).filter((u): u is string => !!u).slice(0, 100);
          if (!urls.length) return emptyResult(["no seed company carries a LinkedIn URL"], "unsupported");
          const perCompany = Math.min(Math.max(1, Math.min(3, Math.floor(input.maxItems / urls.length))), Math.floor(affordable(ACTOR.employees) / urls.length));
          if (perCompany < 1) return emptyResult([`the remaining budget $${input.maxCost} cannot cover one profile per company`], "budget");
          const r = await call(ACTOR.employees, { companies: urls, jobTitles: input.spec.roles.slice(0, 10), profileScraperMode: "Short ($4 per 1k)", maxItems: perCompany * urls.length, maxItemsPerCompany: perCompany, companyBatchMode: "all_at_once" }, perCompany * urls.length);
          if (!r.ok) return emptyResult([r.error], "failed");
          const out = emptyResult();
          const seedSlugs = new Set(urls.map((u) => companyLinkedInSlug(u)));
          for (const it of r.run.items) {
            const p = (it ?? {}) as Record<string, unknown>;
            const pos = (Array.isArray(p.currentPositions) ? p.currentPositions as Record<string, unknown>[] : []).find((x) => x.current !== false && seedSlugs.has(companyLinkedInSlug(x.companyLinkedinUrl)));
            if (!pos) continue;
            out.people.push({
              provider: "apify", recordId: `li_member:${p.id ?? p.linkedinUrl}`, retrievedAt: at,
              fullName: str(p.fullName) ?? ([str(p.firstName), str(p.lastName)].filter(Boolean).join(" ") || null), firstName: str(p.firstName),
              title: str(pos.title), linkedinUrl: str(p.linkedinUrl),
              company: { provider: "apify", recordId: `li_company:${companyLinkedInSlug(pos.companyLinkedinUrl)}`, retrievedAt: at, name: str(pos.companyName), linkedinUrl: str(pos.companyLinkedinUrl) },
              employerIsCurrent: true,
            } as ProviderPerson);
          }
          out.spent = spentOf(ACTOR.employees, r.run); out.replayed = r.run.chargedUsd === 0;
          return out;
        }
        case "people_by_firmographics": {
          const roles = input.spec.roles.slice(0, 10);
          if (!roles.length) return emptyResult(["people search needs roles"], "unsupported");
          const n = Math.min(input.maxItems, affordable(ACTOR.people));
          if (n < 1) return emptyResult([`the remaining budget $${input.maxCost} is below the $0.10 search-page minimum`], "budget");
          const r = await call(ACTOR.people, { currentJobTitles: roles, ...(input.spec.geography.hq.length ? { locations: locationsOf(input.spec.geography.hq) } : {}), maxItems: n, profileScraperMode: "Short" }, n);
          if (!r.ok) return emptyResult([r.error], "failed");
          const out = emptyResult(["Apify people search has no industry filter: industry is checked downstream"]);
          for (const it of r.run.items) {
            const p = (it ?? {}) as Record<string, unknown>;
            const pos = (Array.isArray(p.currentPositions) ? p.currentPositions as Record<string, unknown>[] : [])[0];
            out.people.push({
              provider: "apify", recordId: `li_member:${p.id ?? p.linkedinUrl}`, retrievedAt: at,
              fullName: [str(p.firstName), str(p.lastName)].filter(Boolean).join(" ") || null, firstName: str(p.firstName), title: str(pos?.title), linkedinUrl: str(p.linkedinUrl),
              company: pos && companyLinkedInSlug(pos.companyLinkedinUrl) ? { provider: "apify", recordId: `li_company:${companyLinkedInSlug(pos.companyLinkedinUrl)}`, retrievedAt: at, name: str(pos.companyName), linkedinUrl: str(pos.companyLinkedinUrl) } : null,
              employerIsCurrent: pos ? pos.current !== false : null,
            } as ProviderPerson);
          }
          out.spent = spentOf(ACTOR.people, r.run); out.replayed = r.run.chargedUsd === 0;
          return out;
        }
        default:
          return emptyResult([`Apify does not discover by ${input.capability}`], "unsupported");
      }
    },
  };
}

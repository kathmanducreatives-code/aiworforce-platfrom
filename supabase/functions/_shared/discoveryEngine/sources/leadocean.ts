// LeadOcean as a discovery source: people / company search over its index.
// Rows are provider claims; the shared engine decides. Same ledger discipline as
// discoveryProviders/orchestrator.ts: every page reserved under an idempotency
// key before it is bought; a settled key replays; an uncertain charge is never
// re-bought; no retries.

import type { DiscoveryAdapter } from "../../discoveryProviders/adapter.ts";
import { redactContactValues } from "../../discoveryProviders/orchestrator.ts";
import { planDiscovery, type ProviderConnectionState } from "../../discoveryProviders/routing.ts";
import { ProviderError, type DiscoveryRequirements } from "../../discoveryProviders/types.ts";
import type { SearchPage } from "../../discoveryProviders/adapter.ts";
import { emptyResult, type DiscoverySource, type SourceRunInput, type SourceRunResult } from "../sources.ts";
import type { DiscoverySpec } from "../spec.ts";

/** Free-text industries → LeadOcean's exact labels (closed list of 534). Unmapped words go to employer keywords. */
const LABELS: Record<string, string[]> = {
  saas: ["Software Development", "Technology; Information and Internet"],
  software: ["Software Development"],
  "marketing agency": ["Marketing Services", "Advertising Services", "Marketing and Advertising"],
  "marketing agencies": ["Marketing Services", "Advertising Services", "Marketing and Advertising"],
  agency: ["Marketing Services", "Advertising Services", "Marketing and Advertising"],
  agencies: ["Marketing Services", "Advertising Services", "Marketing and Advertising"],
  "lead generation": ["Marketing Services", "Advertising Services"],
};
const FUNDING_RECENT_YEAR = (now: Date) => now.getUTCFullYear() - 1;

/** Narrowing hints for a spec. Never a requirement; never widens. */
export function leadOceanHints(spec: DiscoverySpec, now: Date): Record<string, unknown> {
  const words = [...spec.company.industries, ...spec.company.descriptors].map((w) => w.toLowerCase());
  const industry = [...new Set(words.flatMap((w) => LABELS[w] ?? []))];
  const keywords = words.filter((w) => !LABELS[w]);
  const h: Record<string, unknown> = {};
  if (industry.length) h.industry = industry;
  if (keywords.length) h.companyKeywords = keywords;
  if (spec.geography.person.length) h.country = spec.geography.person.map((c) => (/^(us|usa|united states)$/i.test(c) ? "US" : c));
  if (spec.signals.some((s) => s.kind === "funding")) h.minLastFundingYear = FUNDING_RECENT_YEAR(now);
  return h;
}

export function leadOceanSource(adapter: DiscoveryAdapter | null): DiscoverySource {
  return {
    id: "leadocean",
    async run(input: SourceRunInput): Promise<SourceRunResult> {
      if (!adapter) return emptyResult(["LeadOcean is not connected for this workspace"], "not_connected");
      const hints: Record<string, unknown> = { ...leadOceanHints(input.spec, input.now) };
      let req: DiscoveryRequirements = input.requirements;
      if (input.capability === "people_at_companies") {
        const urls = input.seeds.map((s) => s.linkedinUrl).filter((u): u is string => !!u).slice(0, 100);
        const domains = input.seeds.filter((s) => !s.linkedinUrl && s.domain).map((s) => s.domain!).slice(0, 100);
        if (!urls.length && !domains.length) return emptyResult(["no seed company carries a LinkedIn URL or domain"]);
        if (urls.length) hints.companyLinkedin = urls; else hints.domain = domains;
        delete hints.industry; delete hints.companyKeywords; // the seed list already defines the companies
      } else if (input.capability === "companies_by_firmographics") {
        req = { ...req, targetEntity: "company" };
        if (hints.companyKeywords) { hints.keywords = hints.companyKeywords; delete hints.companyKeywords; }
        delete hints.country;
      }
      req = { ...req, requestedCount: Math.max(1, input.maxItems), providerHints: { leadocean: hints } };
      const conn: ProviderConnectionState = { provider: "leadocean", connected: true, enabled: true, commercialTermsConfirmed: true, remainingCredits: null, recentFailures: 0 };
      const plan = planDiscovery({ requirements: req, connections: [conn], selection: ["leadocean"], limits: { overfetch: 1, maxRecordsPerStep: input.maxItems } });
      const step = plan.steps[0];
      if (plan.status !== "ready" || !step) return emptyResult([`LeadOcean cannot run this step: ${plan.blockedReason ?? plan.refused.map((r) => r.reason).join("; ")}`], "unsupported");
      const out = emptyResult();
      let cursor: string | null = null;
      for (let page = 0; page < step.maxPages && out.people.length + out.companies.length < input.maxItems; page++) {
        const limit = Math.min(step.pageSize, input.maxItems - out.people.length - out.companies.length, input.maxCost - out.spent);
        if (limit <= 0) { out.stopped = "budget"; break; }
        const key = `${input.missionId}:${input.stepId}:${plan.planHash}:leadocean:p${page}`;
        const r = await input.ledger.reserve({ workspaceId: input.workspaceId, missionId: input.missionId, provider: "leadocean", key, credits: limit, providerCap: input.maxCost, missionCap: Infinity });
        if (!r.ok) { out.stopped = `ledger: ${r.reason}`; break; }
        let res: SearchPage;
        if (r.replay) { res = r.result as SearchPage; out.replayed = true; }
        else {
          try { res = redactContactValues(await adapter.search(step, req, cursor, limit)); }
          catch (e) {
            const pe = e instanceof ProviderError ? e : new ProviderError("leadocean", "charge_uncertain", "search failed after the request");
            if (pe.kind === "charge_uncertain") await input.ledger.markUncertain(key); else await input.ledger.release(key);
            out.stopped = pe.kind; out.notes.push(`LeadOcean page ${page} failed (${pe.kind}); not retried`);
            break;
          }
          await input.ledger.settle(key, res.creditsCharged, res);
          out.spent += res.creditsCharged;
        }
        out.companies.push(...res.companies);
        out.people.push(...res.people);
        if (res.ignoredFilters.length) out.notes.push(`LeadOcean did not apply: ${res.ignoredFilters.join(", ")}`);
        if (!res.nextCursor) break;
        cursor = res.nextCursor;
      }
      return out;
    },
  };
}

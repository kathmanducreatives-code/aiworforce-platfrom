// Optional: is the discovered decision-maker CURRENTLY at the company, by a
// source other than LeadOcean?
//
// harvestapi/linkedin-company-employees (registered `apify_linkedin_company_employees`,
// hiringActorCatalog.ts): one batched run for all eligible companies, short profiles
// only, `jobTitles` from the ICP, a per-company cap. $0.02 per run + $0.003 per
// short profile (BRONZE, re-read 2026-10-31).
//
// Known defects the catalogue records, respected here:
//   * linkedinUrl is the opaque ACwAAA member id — a person is matched by
//     normalized full NAME + the current position's company LinkedIn slug, never URL
//   * jobTitles is fuzzy — the returned title is re-classified deterministically
//
// Outcomes per company: `confirmed` (same name, current position at this company,
// a decision-maker title), `other_decision_maker` (the company has one, not this
// person), `not_found`, `unavailable` (not run / failed / over budget). Only
// `confirmed` makes employment `independent_current`. Never a hard requirement:
// a missing check leaves an eligible company eligible.

import type { ActorInvoker } from "../discoveryProviders/adapters/apify.ts";
import { classifyDecisionMakerRole } from "../decisionMaker/roleFamily.ts";
import { companyLinkedInSlug } from "../decisionMaker/companyIdentity.ts";
import { normalizePersonName } from "../decisionMaker/personProfile.ts";

// emptyUsd 0.03 encodes the catalogued $0.05 minimum per run (start $0.02 + at least $0.03).
export const COMPANY_EMPLOYEES_ACTOR = Object.freeze({ key: "apify_linkedin_company_employees", actorId: "harvestapi/linkedin-company-employees", perItemUsd: 0.003, perStartUsd: 0.02, emptyUsd: 0.03 });

export type FounderCheckState = "confirmed" | "other_decision_maker" | "not_found" | "unavailable";
export interface FounderCheck { companyKey: string; state: FounderCheckState; title: string | null; source: string | null; reason: string | null }

export interface FounderTarget { companyKey: string; companyLinkedinUrl: string; personName: string | null }

const nameKey = (v: unknown) => normalizePersonName(v)?.toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim() ?? null;

export async function checkFounders(
  targets: readonly FounderTarget[], invoke: ActorInvoker | null,
  opts: { maxUsd: number; perCompany: number; jobTitles: string[]; idPrefix: string },
): Promise<{ checks: Map<string, FounderCheck>; spentUsd: number; stopped: string | null }> {
  const checks = new Map<string, FounderCheck>();
  const una = (t: FounderTarget, reason: string) => checks.set(t.companyKey, { companyKey: t.companyKey, state: "unavailable", title: null, source: null, reason });
  if (!targets.length) return { checks, spentUsd: 0, stopped: null };
  if (!invoke) { targets.forEach((t) => una(t, "Apify is not connected for this run")); return { checks, spentUsd: 0, stopped: null }; }
  const maxItems = targets.length * opts.perCompany;
  const worst = COMPANY_EMPLOYEES_ACTOR.perStartUsd + Math.max(COMPANY_EMPLOYEES_ACTOR.perItemUsd * maxItems, COMPANY_EMPLOYEES_ACTOR.emptyUsd);
  if (worst > opts.maxUsd + 1e-9) { targets.forEach((t) => una(t, `worst case $${worst.toFixed(4)} exceeds the $${opts.maxUsd} ceiling`)); return { checks, spentUsd: 0, stopped: "budget" }; }
  try {
    const run = await invoke(COMPANY_EMPLOYEES_ACTOR.key, {
      companies: targets.map((t) => t.companyLinkedinUrl), jobTitles: opts.jobTitles, profileScraperMode: "Short ($4 per 1k)",
      maxItems, maxItemsPerCompany: opts.perCompany, companyBatchMode: "all_at_once",
    }, { maxItems, idempotencyKey: `${opts.idPrefix}:${COMPANY_EMPLOYEES_ACTOR.key}:${targets.map((t) => t.companyKey).sort().join(",")}` });
    const bySlug = new Map<string, { name: string | null; title: string | null }[]>();
    for (const it of run.items) {
      const r = (it ?? {}) as Record<string, unknown>;
      const name = nameKey(r.fullName ?? [r.firstName, r.lastName].filter(Boolean).join(" "));
      const positions = Array.isArray(r.currentPositions) ? r.currentPositions as Record<string, unknown>[] : [];
      for (const pos of positions) {
        if (pos.current === false) continue;
        const slug = companyLinkedInSlug(pos.companyLinkedinUrl);
        if (!slug) continue;
        bySlug.set(slug, [...(bySlug.get(slug) ?? []), { name, title: typeof pos.title === "string" ? pos.title : null }]);
      }
    }
    for (const t of targets) {
      const people = bySlug.get(companyLinkedInSlug(t.companyLinkedinUrl) ?? "") ?? [];
      const dm = people.filter((p) => { const r = classifyDecisionMakerRole(p.title); return r.role_family !== "other" && !r.disqualified_by; });
      const want = nameKey(t.personName);
      const me = want ? dm.find((p) => p.name === want) : undefined;
      checks.set(t.companyKey, me
        ? { companyKey: t.companyKey, state: "confirmed", title: me.title, source: COMPANY_EMPLOYEES_ACTOR.key, reason: null }
        : dm.length
          ? { companyKey: t.companyKey, state: "other_decision_maker", title: dm[0].title, source: COMPANY_EMPLOYEES_ACTOR.key, reason: "the company's current decision-makers do not include the discovered person" }
          : { companyKey: t.companyKey, state: "not_found", title: null, source: COMPANY_EMPLOYEES_ACTOR.key, reason: "no current decision-maker returned for this company" });
    }
    const spent = run.chargedUsd ?? (COMPANY_EMPLOYEES_ACTOR.perStartUsd + COMPANY_EMPLOYEES_ACTOR.perItemUsd * run.items.length);
    return { checks, spentUsd: Math.round(spent * 1e6) / 1e6, stopped: null };
  } catch (e) {
    targets.forEach((t) => una(t, `founder check failed (${(e as Error)?.name ?? "error"}); not retried`));
    return { checks, spentUsd: worst, stopped: "charge_uncertain" };
  }
}

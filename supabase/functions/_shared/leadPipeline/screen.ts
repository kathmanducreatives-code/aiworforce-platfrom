// Initial ICP screening — a SPENDING decision on provider claims, never a
// qualification.
//
// LeadOcean rows are discovery claims (docs/LEADOCEAN_FINAL_VERDICT.md: ~29% wrong
// HQ, understated headcounts, founder over-match). They may not prove a hard
// requirement, but an OBVIOUS mismatch in the row is reason enough not to buy
// Apify verification for it:
//
//   duplicate         the company was already walked (checkpoint) or appears
//                     twice in this batch under the same LinkedIn company
//   no_decision_maker no contact in the row reads as a founder / revenue leader
//                     (the Apify engine's own role classifier decides)
//   headcount_far_out the provider's headcount is far outside the ICP band —
//                     below half the minimum, or above twice the maximum
//                     (LeadOcean undercounts large companies, so "far" is generous)
//   unverifiable      no LinkedIn company URL: Apify cannot read the record;
//                     the candidate stays needs_verification, nothing is bought
//
// A screened-out candidate is classified `rejected` with basis `screened`: a
// reversible spending decision, recorded with the provider claim it rests on —
// never `verified` ineligibility.

import { classifyDecisionMakerRole } from "../decisionMaker/roleFamily.ts";
import { companyLinkedInSlug } from "../decisionMaker/companyIdentity.ts";
import type { CanonicalPerson } from "../discoveryProviders/normalize.ts";
import type { VerifiedLead } from "../discoveryProviders/verify.ts";
import type { IcpConfig } from "./icp.ts";

export type ScreenOutcome = "verify" | "duplicate" | "no_decision_maker" | "headcount_far_out" | "unverifiable" | "already_rejected";

export interface ScreenResult {
  companyKey: string;
  outcome: ScreenOutcome;
  /** The LinkedIn company slug Apify reads by; the dedupe key for paid calls. */
  slug: string | null;
  reasons: string[];
  /** For ordering paid verification: a recent provider-reported round first (a claim, used for priority only). */
  priority: number;
}

const first = <T>(xs: { value: T }[]): T | null => xs[0]?.value ?? null;

export function screenCandidates(
  leads: readonly VerifiedLead[], icp: Pick<IcpConfig, "employees">, contactOf: (l: VerifiedLead) => CanonicalPerson | null, alreadyWalked: ReadonlySet<string>, now: Date,
  opts: { requireDecisionMaker?: boolean } = {},
): ScreenResult[] {
  const seenSlugs = new Map<string, string>();
  const out: ScreenResult[] = [];
  for (const l of leads) {
    const key = l.company.key;
    const slug = companyLinkedInSlug(first(l.company.linkedinUrl));
    const funding = first(l.company.funding);
    const roundYear = funding?.roundDate ? Number(funding.roundDate.slice(0, 4)) : funding?.lastRoundYear ?? null;
    const priority = roundYear ? Math.max(0, 5 - (now.getUTCFullYear() - roundYear)) : 0;
    const res = (outcome: ScreenOutcome, reasons: string[]): ScreenResult => ({ companyKey: key, outcome, slug, reasons, priority });
    if (alreadyWalked.has(key)) { out.push(res("duplicate", ["company already walked in an earlier run (checkpoint)"])); continue; }
    if (slug && seenSlugs.has(slug)) { out.push(res("duplicate", [`same LinkedIn company as ${seenSlugs.get(slug)}`])); continue; }
    if (slug) seenSlugs.set(slug, key);
    if (l.status === "rejected" && l.rejectionBasis === "proven") { out.push(res("already_rejected", l.reasons.slice(0, 3))); continue; }
    const p = contactOf(l);
    const role = p ? classifyDecisionMakerRole(first(p.title)) : null;
    if ((opts.requireDecisionMaker ?? true) && (!role || role.role_family === "other" || role.disqualified_by)) {
      out.push(res("no_decision_maker", [p ? `provider title "${first(p.title) ?? ""}" is not a decision-maker role` : "no contact in the row"]));
      continue;
    }
    const n = first(l.company.employeeCount);
    if (n != null && (n < icp.employees.min / 2 || n > icp.employees.max * 2)) {
      out.push(res("headcount_far_out", [`provider headcount ${n} is far outside ${icp.employees.min}–${icp.employees.max} (provider claim)`]));
      continue;
    }
    if (!slug) { out.push(res("unverifiable", ["no LinkedIn company URL: the company record cannot be read"])); continue; }
    out.push(res("verify", []));
  }
  return out;
}

/** Which candidates the Apify company-record budget covers, highest priority first. */
export function verificationBatch(screened: readonly ScreenResult[], maxUsd: number, perStartUsd: number, perItemUsd: number): { buy: ScreenResult[]; overBudget: ScreenResult[] } {
  const want = screened.filter((s) => s.outcome === "verify").sort((a, b) => b.priority - a.priority || a.companyKey.localeCompare(b.companyKey));
  const fit = Math.max(0, Math.floor((maxUsd - perStartUsd + 1e-9) / perItemUsd));
  return { buy: want.slice(0, fit), overBudget: want.slice(fit) };
}

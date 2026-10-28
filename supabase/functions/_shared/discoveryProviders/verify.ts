// Check every merged record against the ORIGINAL hard requirements.
//
// Each requirement gets one outcome, with its evidence:
//   matched          a provider-reported value (or the company's own site) satisfies it
//   provider_filter  no value came back, but the provider applied the filter itself
//                    and did not report ignoring it
//   contradicted     the values that came back violate it
//   conflicting      providers disagree (one satisfies, another violates)
//   unknown          nothing to decide it with
// A lead is `rejected` on any contradiction, `qualified` when every
// requirement is matched or provider-filtered, and `needs_verification`
// otherwise. It is never qualified on a requirement nobody checked.
//
// `verification` says how a qualified lead was established: `evidence` when
// every requirement was matched against a returned value, `provider_attested`
// when at least one rests on the provider's own filter.
//
// Pure.

import type { SiteEvidence } from "./adapters/apify.ts";
import { geoLevel, normCountry } from "./adapter.ts";
import { normDomain, type CanonicalCompany, type CanonicalPerson, type MergeResult } from "./normalize.ts";
import type { Claim, DiscoveryRequirements, FilterKey, HardRequirement, ProviderId, Range } from "./types.ts";

export type CheckOutcome = "matched" | "provider_filter" | "contradicted" | "conflicting" | "unknown";

export interface CheckEvidence {
  provider: ProviderId;
  recordId: string;
  field: string;
  value: unknown;
  retrievedAt: string;
  url?: string | null;
}

export interface RequirementCheck {
  criterionId: string;
  key: FilterKey;
  label: string;
  outcome: CheckOutcome;
  evidence: CheckEvidence[];
  note: string;
}

export type LeadStatus = "qualified" | "needs_verification" | "rejected";

export interface VerifiedContact {
  person: CanonicalPerson;
  status: LeadStatus;
  checks: RequirementCheck[];
}

export interface VerifiedLead {
  company: CanonicalCompany;
  status: LeadStatus;
  verification: "evidence" | "provider_attested" | null;
  checks: RequirementCheck[];
  contacts: VerifiedContact[];
  reasons: string[];
}

// ── Matching helpers ────────────────────────────────────────────────────────

const GENERIC = new Set(["agency", "agencies", "company", "companies", "firm", "firms", "business", "businesses", "services", "provider", "providers", "and", "the", "of"]);

/** "manufacturing" → "manufactur"; "staffing agencies" → ["staffing"]. */
export function stems(phrase: string): string[] {
  return phrase.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !GENERIC.has(w))
    .map((w) => w.replace(/(ings|ing|ers|er|ies|es|s)$/, "")).filter((w) => w.length >= 3);
}

function mentions(text: string, phrase: string): boolean {
  const t = text.toLowerCase();
  const s = stems(phrase);
  return s.length > 0 && s.every((x) => t.includes(x));
}

const ROLE_SYNONYMS: Record<string, string[]> = {
  ceo: ["ceo", "chief executive"],
  cto: ["cto", "chief technology", "chief technical"],
  coo: ["coo", "chief operating"],
  cfo: ["cfo", "chief financial"],
  cmo: ["cmo", "chief marketing"],
  founder: ["founder", "co-founder", "cofounder"],
  owner: ["owner", "proprietor"],
  president: ["president"],
};

export function titleMatchesRole(title: string, role: string): boolean {
  const t = title.toLowerCase();
  const r = role.toLowerCase().trim();
  const alts = ROLE_SYNONYMS[r] ?? ROLE_SYNONYMS[r.replace(/[^a-z]/g, "")] ?? [r];
  return alts.some((a) => {
    // "president" must not match "vice president".
    if (a === "president" && /vice[\s-]+president/.test(t)) return false;
    return new RegExp(`(^|[^a-z])${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`).test(t);
  });
}

function evidenceOf(c: Claim, field: string): CheckEvidence {
  return { provider: c.provider, recordId: c.recordId, field, value: c.value, retrievedAt: c.retrievedAt };
}

function fold(per: { ok: boolean; claim: Claim; field: string }[]): { outcome: CheckOutcome | null; evidence: CheckEvidence[] } {
  if (!per.length) return { outcome: null, evidence: [] };
  const ev = per.map((p) => evidenceOf(p.claim, p.field));
  if (per.every((p) => p.ok)) return { outcome: "matched", evidence: ev };
  if (per.every((p) => !p.ok)) return { outcome: "contradicted", evidence: ev };
  return { outcome: "conflicting", evidence: ev };
}

function inRange(n: number, r: Range): boolean {
  return (r.min === null || n >= r.min) && (r.max === null || n <= r.max);
}

// ── Company checks ──────────────────────────────────────────────────────────

function checkCompany(h: HardRequirement, c: CanonicalCompany, site: SiteEvidence[]): { outcome: CheckOutcome | null; evidence: CheckEvidence[]; note: string } {
  const list = Array.isArray(h.values) ? h.values : [];
  const siteText = site.filter((s) => s.kind === "site_text" && s.text).map((s) => s);
  const siteEv = (s: SiteEvidence): CheckEvidence => ({ provider: "apify", recordId: s.runId ?? `site:${s.domain}`, field: "site_text", value: null, retrievedAt: s.at, url: s.url });
  switch (h.key) {
    case "industry": {
      const per = c.industry.map((cl) => ({ ok: cl.value.some((v) => list.some((r) => mentions(v, r))), claim: cl as Claim, field: "industry" }));
      const r = fold(per);
      const kw = c.keywords.filter((cl) => cl.value.some((v) => list.some((x) => mentions(v, x))));
      if (r.outcome === "contradicted" && kw.length) return { outcome: "conflicting", evidence: [...r.evidence, ...kw.map((k) => evidenceOf(k, "keywords"))], note: "industry and keywords disagree" };
      if (r.outcome) return { ...r, note: "provider-reported industry" };
      if (kw.length) return { outcome: "matched", evidence: kw.map((k) => evidenceOf(k, "keywords")), note: "provider-reported keywords" };
      const s = siteText.find((x) => list.some((r) => mentions(x.text!, r)));
      if (s) return { outcome: "matched", evidence: [siteEv(s)], note: "the company's own site describes it this way" };
      return { outcome: null, evidence: [], note: "no industry returned" };
    }
    case "excluded_company_types": {
      const hay: { text: string; claim: Claim; field: string }[] = [
        ...c.industry.flatMap((cl) => cl.value.map((v) => ({ text: v, claim: cl as Claim, field: "industry" }))),
        ...c.keywords.flatMap((cl) => cl.value.map((v) => ({ text: v, claim: cl as Claim, field: "keywords" }))),
        ...c.name.map((cl) => ({ text: cl.value, claim: cl as Claim, field: "name" })),
      ];
      const hit = hay.filter((x) => list.some((e) => mentions(x.text, e)));
      if (hit.length) return { outcome: "contradicted", evidence: hit.map((x) => evidenceOf(x.claim, x.field)), note: `matches an excluded type (${list.join(", ")})` };
      const siteHit = siteText.find((x) => list.some((e) => x.text!.toLowerCase().includes(e.toLowerCase().replace(/ies$/, "y").replace(/s$/, ""))));
      if (siteHit) return { outcome: "contradicted", evidence: [siteEv(siteHit)], note: "the company's own site describes it as an excluded type" };
      if (c.industry.length) return { outcome: "matched", evidence: c.industry.map((cl) => evidenceOf(cl, "industry")), note: "reported industry is not an excluded type" };
      if (siteText.length) return { outcome: "matched", evidence: [siteEv(siteText[0])], note: "the company's own site does not describe an excluded type" };
      return { outcome: null, evidence: [], note: "nothing returned to rule the exclusion out" };
    }
    case "geography_hq":
    case "excluded_geography": {
      const per: { ok: boolean; claim: Claim; field: string }[] = [];
      for (const v of list) {
        const level = geoLevel(v);
        const want = normCountry(v)!;
        const claims = level === "country" ? c.hqCountry : level === "us_state" ? c.hqRegion : c.hqCity;
        for (const cl of claims) per.push({ ok: normCountry(cl.value) === want, claim: cl, field: level === "country" ? "hq_country" : level === "us_state" ? "hq_region" : "hq_city" });
        // A state or city in the US is contradicted by a non-US country.
        if (level !== "country" && !claims.length) for (const cl of c.hqCountry) if (normCountry(cl.value) !== "united states") per.push({ ok: false, claim: cl, field: "hq_country" });
      }
      // any-of: per value set, a claim satisfies if it matches ANY requested place.
      const byClaim = new Map<Claim, { ok: boolean; claim: Claim; field: string }>();
      for (const p of per) { const e = byClaim.get(p.claim); byClaim.set(p.claim, e ? { ...e, ok: e.ok || p.ok } : p); }
      const folded = [...byClaim.values()];
      if (h.key === "excluded_geography") {
        const bad = folded.filter((p) => p.ok);
        if (bad.length) return { outcome: "contradicted", evidence: bad.map((p) => evidenceOf(p.claim, p.field)), note: "headquartered in an excluded place" };
        return c.hqCountry.length ? { outcome: "matched", evidence: c.hqCountry.map((x) => evidenceOf(x, "hq_country")), note: "headquarters outside the excluded places" } : { outcome: null, evidence: [], note: "no headquarters returned" };
      }
      const r = fold(folded);
      return { ...r, note: r.outcome ? "provider-reported headquarters" : "no headquarters returned" };
    }
    case "employee_range": {
      const r = h.values as Range;
      const per: { ok: boolean | null; claim: Claim; field: string }[] = [
        ...c.employeeCount.map((cl) => ({ ok: inRange(cl.value, r), claim: cl as Claim, field: "employee_count" })),
        ...c.employeeRange.map((cl) => {
          const v = cl.value;
          const within = (v.min ?? 0) >= (r.min ?? 0) && v.max !== null && (r.max === null || v.max <= r.max);
          const disjoint = (r.max !== null && v.min !== null && v.min > r.max) || (r.min !== null && v.max !== null && v.max < r.min);
          return { ok: within ? true : disjoint ? false : null, claim: cl as Claim, field: "employee_range" };
        }),
      ];
      const decided = per.filter((p): p is { ok: boolean; claim: Claim; field: string } => p.ok !== null);
      const f = fold(decided);
      if (!f.outcome && per.length) return { outcome: null, evidence: per.map((p) => evidenceOf(p.claim, p.field)), note: "reported size band straddles the limit" };
      return { ...f, note: f.outcome ? "provider-reported headcount" : "no headcount returned" };
    }
    case "known_companies": {
      const want = new Set(list.map((d) => normDomain(d) ?? d.toLowerCase()));
      const per = [...c.domain.map((cl) => ({ ok: want.has(cl.value), claim: cl as Claim, field: "domain" }))];
      const r = fold(per);
      return { ...r, note: "company domain" };
    }
    case "signal": {
      const roles = site.filter((s) => s.kind === "open_roles");
      const pos = roles.find((s) => (s.count ?? 0) > 0);
      if (pos) return { outcome: "matched", evidence: [{ provider: "apify", recordId: pos.runId ?? `roles:${pos.domain}`, field: "open_roles", value: pos.count, retrievedAt: pos.at }], note: `${pos.count} open role(s) found` };
      return { outcome: null, evidence: [], note: roles.length ? "no open roles found" : "signal not checked" };
    }
    default:
      return { outcome: null, evidence: [], note: `no check for ${h.key}` };
  }
}

function checkPerson(h: HardRequirement, p: CanonicalPerson): { outcome: CheckOutcome | null; evidence: CheckEvidence[]; note: string } {
  const list = Array.isArray(h.values) ? h.values : [];
  if (h.key === "roles") {
    const r = fold(p.title.map((cl) => ({ ok: list.some((role) => titleMatchesRole(cl.value, role)), claim: cl as Claim, field: "title" })));
    return { ...r, note: "provider-reported title" };
  }
  if (h.key === "geography_person") {
    const r = fold(p.country.map((cl) => ({ ok: list.some((v) => normCountry(v) === normCountry(cl.value)), claim: cl as Claim, field: "country" })));
    return { ...r, note: "provider-reported person location" };
  }
  return { outcome: null, evidence: [], note: "" };
}

function asserted(key: FilterKey, sources: { assertedFilters: string[]; ignoredFilters: string[] }[]): boolean {
  return sources.some((s) => s.assertedFilters.includes(key) && !s.ignoredFilters.includes(key));
}

function finish(h: HardRequirement, r: { outcome: CheckOutcome | null; evidence: CheckEvidence[]; note: string }, sources: { assertedFilters: string[]; ignoredFilters: string[] }[]): RequirementCheck {
  let outcome = r.outcome;
  let note = r.note;
  if (!outcome) {
    if (asserted(h.key, sources)) { outcome = "provider_filter"; note = `${note}; the provider applied this filter`; }
    else {
      outcome = "unknown";
      if (sources.some((s) => s.ignoredFilters.includes(h.key))) note = `${note}; the provider reported ignoring this filter`;
    }
  }
  return { criterionId: h.criterionId, key: h.key, label: h.label, outcome, evidence: r.evidence, note };
}

function statusOf(checks: RequirementCheck[]): LeadStatus {
  if (checks.some((c) => c.outcome === "contradicted")) return "rejected";
  if (checks.every((c) => c.outcome === "matched" || c.outcome === "provider_filter")) return "qualified";
  return "needs_verification";
}

const PERSON_KEYS: FilterKey[] = ["roles", "geography_person"];

export function verifyLeads(req: DiscoveryRequirements, merged: MergeResult, siteEvidence: SiteEvidence[] = []): VerifiedLead[] {
  const companyHard = req.hard.filter((h) => !PERSON_KEYS.includes(h.key));
  const personHard = req.hard.filter((h) => PERSON_KEYS.includes(h.key));
  // Roles of a company-target mission are checked on its contacts, not owed by the company.
  const rolesForContacts: HardRequirement[] = personHard.length ? personHard
    : req.roles.length ? [{ criterionId: "decision_makers.roles", key: "roles", values: req.roles, label: `Role: ${req.roles.join(" or ")}`, representable: true }] : [];
  const out: VerifiedLead[] = [];
  for (const c of merged.companies) {
    const site = siteEvidence.filter((s) => c.domain.some((d) => d.value === s.domain));
    const checks = companyHard.map((h) => finish(h, checkCompany(h, c, site), c.sources));
    if (c.identityConflicts.length) {
      checks.push({ criterionId: "identity", key: "known_companies", label: "Identity", outcome: "conflicting", evidence: [], note: c.identityConflicts.join("; ") });
    }
    const contacts: VerifiedContact[] = merged.people.filter((p) => p.companyKey === c.key).map((p) => {
      const pc = rolesForContacts.map((h) => finish(h, checkPerson(h, p), p.sources));
      if (p.identityConflicts.length) pc.push({ criterionId: "identity", key: "roles", label: "Identity", outcome: "conflicting", evidence: [], note: p.identityConflicts.join("; ") });
      return { person: p, checks: pc, status: statusOf(pc) };
    });
    let status = statusOf(checks);
    const order: Record<CheckOutcome, number> = { contradicted: 0, conflicting: 1, unknown: 2, provider_filter: 3, matched: 4 };
    const reasons = checks.filter((x) => x.outcome !== "matched" && x.outcome !== "provider_filter")
      .sort((a, b) => order[a.outcome] - order[b.outcome]).map((x) => `${x.label}: ${x.outcome} — ${x.note}`);
    // A people mission needs at least one person who passes.
    if (req.targetEntity === "person" && status !== "rejected") {
      const best = contacts.some((x) => x.status === "qualified") ? "qualified" : contacts.some((x) => x.status === "needs_verification") ? "needs_verification" : "rejected";
      if (best === "rejected") reasons.push("no contact meets the person requirements");
      if (best !== "qualified" && status === "qualified") status = best;
    }
    const verification = status === "qualified" ? (checks.every((x) => x.outcome === "matched") ? "evidence" : "provider_attested") : null;
    out.push({ company: c, status, verification, checks, contacts, reasons });
  }
  return out;
}

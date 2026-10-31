// THE EVIDENCE CONTRACT: what a discovered lead rests on, kept apart by kind.
//
// One record per lead, built from the merged provider claims and the shared
// engine's verdict. Every fact says WHO said it (provider + record id + field),
// WHEN (retrieved, and the provider's own update stamp), how long it stays
// usable (the shared EVIDENCE_VALIDITY_DAYS table), and its STATUS:
//
//   provider_reported       a provider's row says so; nothing independent
//   independently_verified  the shared engine established it from canonical
//                           evidence (company record, funding pair, job evidence)
//   contradicted            the shared engine disproved it
//   unknown                 nobody returned it
//
// Nothing here upgrades a status. `independently_verified` is read from the
// shared engine's passing checks and the actor that proved them; a provider
// row is `provider_reported` however confident the provider is.
//
// Pure.

import { EVIDENCE_VALIDITY_DAYS, type EvidenceDimension } from "../candidateObservation.ts";
import type { CanonicalCompany, CanonicalPerson } from "./normalize.ts";
import type { SharedQualification } from "./sharedQualification.ts";
import type { Claim, ContactPointVerification, FundingClaim, ProviderId } from "./types.ts";
import type { VerifiedLead } from "./verify.ts";
import { titleMatchesRole } from "./verify.ts";

export const EVIDENCE_CONTRACT_VERSION = "discovery-evidence-contract-v1" as const;

export type FactStatus = "provider_reported" | "independently_verified" | "contradicted" | "unknown";

export interface Provenance {
  provider: ProviderId;
  recordId: string;
  sourceField: string;
  retrievedAt: string;
  providerUpdatedAt: string | null;
  /** When this kind of fact stops being usable (shared validity table). Null = durable. */
  validUntil: string | null;
}

export interface Fact<T> {
  status: FactStatus;
  /** Every provider's claim, kept: disagreements are visible, never averaged. */
  claims: { value: T; provenance: Provenance }[];
  /** For independently_verified / contradicted: the shared engine's reason and proving actor. */
  verifiedBy?: { actor: string | null; reason: string };
}

export interface PersonEvidence {
  personKey: string;
  identity: Fact<{ fullName: string | null; firstName: string | null; linkedinUrl: string | null }>;
  /** Current employment: who the provider says employs this person now. */
  employment: Fact<{ companyKey: string | null; title: string | null; current: boolean | null }>;
  /** Does the title match a requested role — on the provider's title, so provider_reported at best. */
  decisionMaker: { roles: string[]; matched: boolean | null; status: FactStatus };
  contact: {
    email: { available: boolean | null; verification: ContactPointVerification[] };
    phone: { available: boolean | null; verification: ContactPointVerification[]; independentlyVerifiedDirect: boolean };
  };
}

export interface LeadEvidence {
  version: typeof EVIDENCE_CONTRACT_VERSION;
  company: {
    identity: Fact<{ name: string | null; domain: string | null; linkedinUrl: string | null }>;
    headquarters: Fact<{ country: string | null; region: string | null; city: string | null }>;
    employeeCount: Fact<number>;
    employeeRange: Fact<{ min: number | null; max: number | null }>;
    industry: Fact<string[]>;
    /** Hiring evidence and posting dates: no provider in this layer returns dated postings. */
    hiring: Fact<{ postedAt: string | null }>;
    funding: Fact<FundingClaim>;
  };
  people: PersonEvidence[];
  /** The ONLY qualification verdict: the shared engine's. */
  qualification: { eligibility: SharedQualification["eligibility"] | "not_evaluated"; gaps: string[] };
}

const DAY = 86_400_000;

function validUntil(dim: EvidenceDimension | null, at: string): string | null {
  const days = dim ? EVIDENCE_VALIDITY_DAYS[dim] : undefined;
  const t = Date.parse(at);
  return days == null || !Number.isFinite(t) ? null : new Date(t + days * DAY).toISOString();
}

function prov(c: Claim, dim: EvidenceDimension | null, updatedAt: (c: Claim) => string | null): Provenance {
  return {
    provider: c.provider, recordId: c.recordId, sourceField: c.sourceField, retrievedAt: c.retrievedAt,
    providerUpdatedAt: c.providerUpdatedAt ?? updatedAt(c), validUntil: validUntil(dim, c.retrievedAt),
  };
}

/** The shared engine's answer for one evidence dimension, if it decided one. */
function sharedFor(shared: SharedQualification | null, dims: string[]): { status: FactStatus; actor: string | null; reason: string } | null {
  const checks = (shared?.checks ?? []).filter((c) => dims.includes(c.dimension));
  const fail = checks.find((c) => c.result === "fail");
  if (fail) return { status: "contradicted", actor: fail.actor, reason: fail.reason };
  const pass = checks.find((c) => c.result === "pass" && c.actor && !c.actor.endsWith("_discovery"));
  if (pass) return { status: "independently_verified", actor: pass.actor, reason: pass.reason };
  return null;
}

function fact<T>(claims: { value: T; provenance: Provenance }[], decided: ReturnType<typeof sharedFor>): Fact<T> {
  if (decided) return { status: decided.status, claims, verifiedBy: { actor: decided.actor, reason: decided.reason } };
  return { status: claims.length ? "provider_reported" : "unknown", claims };
}

function grouped<T>(claims: Claim[][], build: (cs: Claim[]) => T, dim: EvidenceDimension | null, upd: (c: Claim) => string | null) {
  // One entry per provider record, so one record's city and country stay together.
  const by = new Map<string, Claim[]>();
  for (const list of claims) for (const c of list) {
    const k = `${c.provider}:${c.recordId}`;
    by.set(k, [...(by.get(k) ?? []), c]);
  }
  return [...by.values()].map((cs) => ({ value: build(cs), provenance: prov(cs[0], dim, upd) }));
}

function personEvidence(p: CanonicalPerson, roles: string[], upd: (c: Claim) => string | null): PersonEvidence {
  const title = p.title[0]?.value ?? null;
  const emails = p.contactPoints.filter((x) => x.kind === "email");
  const phones = p.contactPoints.filter((x) => x.kind === "phone");
  return {
    personKey: p.key,
    identity: fact(grouped([p.fullName, p.firstName, p.linkedinUrl], (cs) => ({
      fullName: (cs.find((c) => c.sourceField === "full_name")?.value as string) ?? null,
      firstName: (cs.find((c) => c.sourceField === "first_name")?.value as string) ?? null,
      linkedinUrl: (cs.find((c) => c.sourceField === "linkedin_url")?.value as string) ?? null,
    }), null, upd), null),
    employment: fact(grouped([p.title, p.employerIsCurrent], (cs) => ({
      companyKey: p.companyKey,
      title: (cs.find((c) => c.sourceField === "title")?.value as string) ?? null,
      current: (cs.find((c) => c.sourceField === "employer_is_current")?.value as boolean) ?? null,
    }), "team_composition", upd), null),
    decisionMaker: {
      roles,
      matched: title && roles.length ? roles.some((r) => titleMatchesRole(title, r)) : null,
      // A title is the provider's word: no canonical source here re-reads it.
      status: title ? "provider_reported" : "unknown",
    },
    contact: {
      email: { available: p.hasEmail[0]?.value ?? (emails.length ? true : null), verification: emails.map((e) => e.verification) },
      phone: {
        available: p.hasPhone[0]?.value ?? (phones.length ? true : null),
        verification: phones.map((e) => e.verification),
        independentlyVerifiedDirect: phones.some((x) => x.verification === "independently_verified" && /direct|mobile/i.test(x.type ?? "")),
      },
    },
  };
}

export function leadEvidence(lead: VerifiedLead, roles: string[]): LeadEvidence {
  const c: CanonicalCompany = lead.company;
  const s = lead.shared;
  const upd = (cl: Claim) => c.sources.find((x) => x.provider === cl.provider && x.recordId === cl.recordId)?.providerUpdatedAt ?? null;
  const one = <T>(list: Claim<T>[], dim: EvidenceDimension | null) => list.map((cl) => ({ value: cl.value, provenance: prov(cl, dim, upd) }));
  return {
    version: EVIDENCE_CONTRACT_VERSION,
    company: {
      identity: fact(grouped([c.name, c.domain, c.linkedinUrl], (cs) => ({
        name: (cs.find((x) => x.sourceField === "name")?.value as string) ?? null,
        domain: (cs.find((x) => x.sourceField === "domain")?.value as string) ?? null,
        linkedinUrl: (cs.find((x) => x.sourceField === "linkedin_url")?.value as string) ?? null,
      }), null, upd), sharedFor(s, ["known_companies"])),
      headquarters: fact(grouped([c.hqCountry, c.hqRegion, c.hqCity], (cs) => ({
        country: (cs.find((x) => x.sourceField === "hq_country")?.value as string) ?? null,
        region: (cs.find((x) => x.sourceField === "hq_region")?.value as string) ?? null,
        city: (cs.find((x) => x.sourceField === "hq_city")?.value as string) ?? null,
      }), "geography", upd), sharedFor(s, ["geography"])),
      employeeCount: fact(one(c.employeeCount, "headcount"), null),
      employeeRange: fact(one(c.employeeRange, "company_size_band"), sharedFor(s, ["company_size"])),
      industry: fact(one(c.industry, "industry"), sharedFor(s, ["industry", "business_model"])),
      hiring: fact<{ postedAt: string | null }>([], sharedFor(s, ["hiring"])),
      funding: fact(one(c.funding, "funding"), sharedFor(s, ["funding", "company_stage"])),
    },
    people: lead.contacts.map((x) => personEvidence(x.person, roles, upd)),
    qualification: { eligibility: s?.eligibility ?? "not_evaluated", gaps: [...(s?.gaps ?? [])] },
  };
}

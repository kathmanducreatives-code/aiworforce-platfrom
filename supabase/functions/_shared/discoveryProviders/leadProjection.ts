// A discovery run → the rows the existing Leads dashboard reads
// (`accounts`, `contacts`, `lead_candidates`), with the attribution kept in
// `raw.agentory_discovery`. The Lead Library reads it through
// `src/lib/leadLibrary/providerAttribution.ts`.
//
// Discovery stores NO contact values. A search row's emails and phones are
// reduced to availability and the provider's status; the values are written
// only by enrichment, under its own authorization (`enrich.ts`). Rejected
// leads are not projected at all.
//
// Pure: it returns rows; the caller decides whether to write them.

import type { DiscoveryRun } from "./orchestrator.ts";
import type { CanonicalCompany, CanonicalPerson } from "./normalize.ts";
import type { RequirementCheck, VerifiedLead } from "./verify.ts";

export const ATTRIBUTION_VERSION = "provider-discovery-v1" as const;

export interface ProjectedLead {
  account: { workspace_id: string; name: string; domain: string | null; website_url: string | null; linkedin_url: string | null; location: string | null; industry: string | null; employee_count: string | null; source: string; raw: Record<string, unknown> };
  contacts: { workspace_id: string; full_name: string | null; title: string | null; linkedin_url: string | null; company: string | null; location: string | null; email: null; phone: null; source: string; raw: Record<string, unknown> }[];
  lead_candidate: { workspace_id: string; lead_type: string; status: string; fit_score: number | null; reason: string; raw: Record<string, unknown> };
}

const first = <T>(xs: { value: T }[]): T | null => (xs.length ? xs[0].value : null);

function checksOut(checks: RequirementCheck[]) {
  return checks.map((c) => ({
    criterion_id: c.criterionId, label: c.label, outcome: c.outcome, note: c.note,
    evidence: c.evidence.map((e) => ({ provider: e.provider, record_id: e.recordId, field: e.field, value: e.value, retrieved_at: e.retrievedAt, url: e.url ?? null })),
  }));
}

function providersOf(x: CanonicalCompany | CanonicalPerson) {
  return x.sources.map((s) => ({ provider: s.provider, record_id: s.recordId, retrieved_at: s.retrievedAt, provider_updated_at: s.providerUpdatedAt }));
}

function availability(p: CanonicalPerson) {
  const emails = p.contactPoints.filter((c) => c.kind === "email");
  const phones = p.contactPoints.filter((c) => c.kind === "phone");
  return {
    email: emails.length > 0 || p.hasEmail.some((c) => c.value === true),
    email_statuses: emails.map((e) => ({ provider: e.provider, status: e.providerStatus ?? null, verification: e.verification, provider_verified_at: e.providerVerifiedAt ?? null })),
    phone: phones.length > 0 || p.hasPhone.some((c) => c.value === true),
    // Never verified by discovery, whatever the provider says.
    phone_verification: phones.length ? (phones.every((x) => x.verification === "provider_flagged") ? "provider_flagged" : "provider_supplied_unverified") : null,
  };
}

function location(c: CanonicalCompany): string | null {
  const parts = [first(c.hqCity), first(c.hqRegion), first(c.hqCountry)].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

function size(c: CanonicalCompany): string | null {
  const n = first(c.employeeCount);
  if (n !== null) return String(n);
  const r = first(c.employeeRange);
  return r ? `${r.min ?? 0}-${r.max ?? ""}`.replace(/-$/, "+") : null;
}

export function projectLead(lead: VerifiedLead, ctx: { workspaceId: string; missionId: string; run: Pick<DiscoveryRun, "planHash" | "finishedAt"> }): ProjectedLead | null {
  if (lead.status === "rejected") return null;
  const c = lead.company;
  const domain = first(c.domain);
  const providers = [...new Set(c.sources.map((s) => s.provider))];
  const attribution = {
    version: ATTRIBUTION_VERSION,
    mission_id: ctx.missionId,
    plan_hash: ctx.run.planHash,
    status: lead.status,
    verification: lead.verification,
    discovered_at: ctx.run.finishedAt,
    providers: providersOf(c),
    checks: checksOut(lead.checks),
    conflicts: c.conflicts,
    identity_conflicts: c.identityConflicts,
    reasons: lead.reasons,
  };
  return {
    account: {
      workspace_id: ctx.workspaceId,
      name: first(c.name) ?? domain ?? "Unknown company",
      domain, website_url: domain ? `https://${domain}` : null,
      linkedin_url: first(c.linkedinUrl), location: location(c),
      industry: first(c.industry)?.[0] ?? null, employee_count: size(c),
      source: `provider_discovery:${providers.join("+")}`,
      raw: { agentory_discovery: attribution },
    },
    contacts: lead.contacts.filter((x) => x.status !== "rejected").map((x) => ({
      workspace_id: ctx.workspaceId,
      full_name: first(x.person.fullName) ?? first(x.person.firstName),
      title: first(x.person.title), linkedin_url: first(x.person.linkedinUrl),
      company: first(c.name), location: first(x.person.country),
      email: null, phone: null,
      source: `provider_discovery:${[...new Set(x.person.sources.map((s) => s.provider))].join("+")}`,
      raw: { agentory_discovery: { version: ATTRIBUTION_VERSION, person_key: x.person.key, status: x.status, providers: providersOf(x.person), checks: checksOut(x.checks), conflicts: x.person.conflicts, availability: availability(x.person) } },
    })),
    lead_candidate: {
      workspace_id: ctx.workspaceId,
      lead_type: "provider_discovery",
      status: lead.status === "qualified" ? "qualified" : "new",
      fit_score: null,
      reason: lead.status === "qualified" ? `Meets every hard requirement (${lead.verification === "evidence" ? "evidence" : "provider-attested"})` : `Needs verification: ${lead.reasons.join("; ")}`,
      raw: { agentory_discovery: attribution },
    },
  };
}

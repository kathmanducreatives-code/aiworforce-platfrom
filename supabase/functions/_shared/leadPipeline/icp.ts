// The two ICPs this pipeline discovers, as configuration.
//
// An ICP is split into three parts that must never be confused:
//
//   eligibility  hard criteria, compiled by the REAL mission compiler and decided
//                by the shared engine (evaluateEligibility): US headquarters, a
//                size band, a decision-maker role. These are the only gates.
//   narrowing    provider filters that shrink a paid search (LeadOcean industry
//                labels, employer keywords, seniority bands, hasPhone). They pick
//                candidates; they never qualify one (discoveryProviders.providerHints).
//   relevance    what makes an eligible company a BETTER fit (a clear B2B SaaS
//                offering; lead-gen / outbound / demand-gen agency services).
//                Used by ranking only — it can order leads, never admit one.
//
// "B2B SaaS" is deliberately NOT a hard criterion: Agentory's controlled
// business-model vocabulary and LeadOcean's 534 industry labels share no exact
// term, so as a hard rule no company could ever qualify (docs/PROVIDER_CAPABILITIES.md §4).
//
// The size bound is stated once (employee_range). A restated equal bound in
// hard_constraints is also safe now (missionCriteria.restatesEmployeeBound).

import { compileLeadMission } from "../leadMissionCompiler.ts";
import type { MissionCriterion } from "../missionCriteria.ts";
import { requirementsFromMission } from "../discoveryProviders/requirements.ts";
import type { DiscoveryRequirements } from "../discoveryProviders/types.ts";

export type IcpId = "icp_a_b2b_saas" | "icp_b_agency";
/** A configured ICP, or one derived from an interpreted request by the strategy planner (`strategy.ts`). */
export type IcpConfigId = IcpId | `spec:${string}`;

export interface IcpConfig {
  id: IcpConfigId;
  label: string;
  /** How a person would ask for it; the compiler reads this with the proposal. */
  query: string;
  requestedCount: number;
  employees: { min: number; max: number };
  /** Role titles the decision-maker search uses (LeadOcean title keywords, OR). */
  roleTitles: string[];
  /** Narrowing only. */
  leadocean: { industry: string[]; companyKeywords?: string[]; seniority: string[]; hasPhone?: boolean; excludeTitle?: string[]; personCountry?: string[] };
  /** Ranking only. */
  relevance: { positive: string[]; negative: string[]; industryLabels: string[] };
}

/**
 * LeadOcean's founder / C-suite bands also match people who only hold the word:
 * the final benchmark returned an "Investor" (c_suite band) and an "iOS Developer
 * Co-founder". Narrowing only — the shared engine still decides the role.
 */
export const NON_DECISION_TITLES = ["Investor", "Advisor", "Board Member", "Intern", "Developer", "Assistant"];

export const ICP_A: IcpConfig = Object.freeze({
  id: "icp_a_b2b_saas",
  label: "US B2B SaaS — founders, CEOs and revenue leaders",
  // The query states ONLY what is gated on (HQ, size, role). Naming "B2B SaaS"
  // here makes the compiler emit hard industry criteria no provider can filter
  // exactly — so LeadOcean is refused and nothing qualifies. SaaS focus is
  // narrowing + relevance below.
  query: "Find US-headquartered companies with 11-200 employees and their founder, CEO or head of revenue.",
  requestedCount: 25,
  employees: { min: 11, max: 200 },
  roleTitles: ["Founder", "Co-Founder", "CEO", "Chief Executive Officer", "Chief Revenue Officer", "VP of Sales", "VP Sales", "Head of Sales", "Head of Revenue"],
  leadocean: {
    industry: ["Software Development", "Technology; Information and Internet", "IT Services and IT Consulting"],
    seniority: ["owner", "founder", "c_suite", "vp", "head"],
    excludeTitle: NON_DECISION_TITLES,
    // Where the PERSON is (hqCountry is the employer): 8 of 9 benchmark people at
    // "US-HQ" companies were abroad. US phone outreach needs US-located people.
    personCountry: ["US"],
  },
  relevance: {
    positive: ["b2b", "saas", "software as a service", "platform", "api", "for teams", "for businesses", "enterprise", "smb", "workflow", "crm"],
    negative: ["agency", "consultancy", "staffing", "recruiting", "outsourcing", "consumer app", "marketplace for consumers", "game studio"],
    industryLabels: ["Software Development", "Technology; Information and Internet"],
  },
}) as IcpConfig;

export const ICP_B: IcpConfig = Object.freeze({
  id: "icp_b_agency",
  label: "US marketing and outbound agencies — owners and managing partners",
  query: "Find US-headquartered companies with 5-200 employees and their owner, founder, CEO or managing partner.",
  requestedCount: 25,
  employees: { min: 5, max: 200 },
  roleTitles: ["Owner", "Founder", "Co-Founder", "CEO", "Chief Executive Officer", "Managing Partner", "Managing Director", "President"],
  leadocean: {
    industry: ["Marketing Services", "Advertising Services", "Marketing and Advertising", "Business Consulting and Services"],
    // Employer keywords: applied by LeadOcean only when the matching companies number
    // 50,000 or fewer; otherwise named in unsupportedFilters (and so not relied on).
    companyKeywords: ["lead generation", "outbound", "demand generation", "appointment setting", "sales development"],
    seniority: ["owner", "founder", "c_suite", "partner"],
    excludeTitle: NON_DECISION_TITLES,
    // Where the PERSON is (hqCountry is the employer): 8 of 9 benchmark people at
    // "US-HQ" companies were abroad. US phone outreach needs US-located people.
    personCountry: ["US"],
  },
  relevance: {
    positive: ["lead generation", "lead gen", "outbound", "cold email", "demand generation", "appointment setting", "sdr", "sales development", "pipeline", "abm", "growth agency"],
    negative: ["staffing", "recruiting", "real estate", "law firm", "print shop", "event venue"],
    industryLabels: ["Marketing Services", "Advertising Services", "Marketing and Advertising"],
  },
}) as IcpConfig;

export const ICPS: Readonly<Record<IcpId, IcpConfig>> = Object.freeze({ icp_a_b2b_saas: ICP_A, icp_b_agency: ICP_B });

/** Override any part of an ICP (count, size, roles, narrowing) without editing the defaults. */
export function configureIcp(base: IcpConfig, over: Partial<Omit<IcpConfig, "id">> = {}): IcpConfig {
  return {
    ...base, ...over,
    employees: { ...base.employees, ...(over.employees ?? {}) },
    leadocean: { ...base.leadocean, ...(over.leadocean ?? {}) },
    relevance: { ...base.relevance, ...(over.relevance ?? {}) },
  };
}

/**
 * Requirements no company can meet together. Refused as `contradictory_requirements`
 * before anything is planned or bought (the same refusal requestFeasibility gives a
 * mission), so a mistyped size is never sent to a provider as an empty search.
 */
export function icpContradictions(icp: IcpConfig): string[] {
  const out: string[] = [];
  const { min, max } = icp.employees;
  if (min > max) out.push(`at least ${min} and at most ${max} employees (which did you mean?)`);
  if (min < 0 || max < 0) out.push("a negative employee count");
  if (!icp.roleTitles.length) out.push("no decision-maker role to find");
  return out;
}

const BASE_PROPOSAL = {
  requested_contact_ready_count: null, company_types: [], soft_preferences: [], preferred_signals: [], adjacent_signals: [],
  excluded_signals: [], allowed_broadening: { role_families: [], company_types: [], geographies: [], employee_range: { min: null, max: null } },
  required_evidence: [], preferred_source_strategy: [], evaluation_instructions: "", founder_unlock_recommended: false,
  confidence: 0.8, unknowns: [],
};

export interface CompiledIcp {
  icp: IcpConfig;
  requirements: DiscoveryRequirements;
  /** The compiler's criteria — what the shared engine decides on. */
  criteria: MissionCriterion[];
}

/** Compile an ICP with the real compiler; narrowing hints attach to the requirements (bound to the plan hash). */
export function compileIcp(icp: IcpConfig, extraHints: Record<string, unknown> = {}): CompiledIcp {
  const proposal = {
    ...BASE_PROPOSAL,
    requested_opportunity_count: icp.requestedCount,
    geographies: ["United States"],
    employee_range: { min: icp.employees.min, max: icp.employees.max },
    decision_maker_roles: icp.roleTitles,
    hard_constraints: [{ field: "geography", operator: "in", value: ["United States"], reason: "US-headquartered" }],
    disallowed_broadening: ["geography", "employee_range", "role"],
    required_capabilities: ["general_company_discovery", "company_details_enrichment", "portfolio_ranking"],
  };
  const compiled = compileLeadMission({ originalUserQuery: icp.query, proposal: proposal as never, requestedCount: icp.requestedCount });
  const requirements = requirementsFromMission(compiled.final_mission as never);
  return { icp, requirements: { ...requirements, providerHints: { leadocean: leadoceanHints(icp, extraHints) } }, criteria: requirements.criteria };
}

/** The ICP's LeadOcean narrowing filters (never requirements), plus any extra (e.g. the checkpoint's excludeIds). */
export function leadoceanHints(icp: IcpConfig, extraHints: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...(icp.leadocean.industry.length ? { industry: icp.leadocean.industry } : {}),
    ...(icp.leadocean.seniority.length ? { seniority: icp.leadocean.seniority } : {}),
    ...(icp.leadocean.companyKeywords?.length ? { companyKeywords: icp.leadocean.companyKeywords } : {}),
    ...(icp.leadocean.hasPhone !== undefined ? { hasPhone: icp.leadocean.hasPhone } : {}),
    ...(icp.leadocean.excludeTitle?.length ? { excludeTitle: icp.leadocean.excludeTitle } : {}),
    ...(icp.leadocean.personCountry?.length ? { country: icp.leadocean.personCountry } : {}),
    ...extraHints,
  };
}

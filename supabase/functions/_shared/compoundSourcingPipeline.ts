// Company-first compound sourcing pipeline (Phases 3, 6, 7, 8).
//
// Composes the deterministic modules into the correct order for a company_first
// request: JOBS first → job-family filter → location → resolve/qualify/dedupe
// companies → SCOPED people search → role + current-employer verification →
// bind hiring evidence → hard gates → dedupe people → rank → grounded why-now.
//
// Provider access is INJECTED (fetchJobs / fetchPeopleForCompany) so this runs
// offline in unit tests with mocked actor results and NEVER makes a network call.
// The runtime supplies real (bounded) fetchers; nothing here imports a provider.

import type { LeadEntityIntent } from "./leadEntityIntent.ts";
import { classifyJobFamily, type JobFamilyResult } from "./jobFamily.ts";
import { resolveCompanyIdentity, type CompanyIdentity } from "./companyIdentity.ts";
import { qualifyCompanyVertical, inferRequestedVertical, type Vertical, type VerticalQualification } from "./verticalQualification.ts";
import {
  evaluateCompanyBrainEvidence, resolveUnknownEvidence,
  type CompanyBrainHardConstraints, type CompanyBrainEvaluation,
} from "./companyIcpFilter.ts";
import { verifyCurrentEmployer, type EmployerVerifyResult } from "./employerVerification.ts";
import { buildPeopleScope, type PeopleSearchScope } from "./scopedPeopleSearch.ts";
import { normalizeCountry, detectCountryInText } from "./locationMatch.ts";

export interface CompoundJob {
  title: string | null;
  company: string | null;
  companyDomain?: string | null;
  companyWebsite?: string | null;
  companyLinkedinUrl?: string | null;
  companyDescription?: string | null;
  industries?: string[] | null;
  location: string | null;
  url: string | null;
  postedDate?: string | null;
  descriptionExcerpt?: string | null;
  open?: boolean | null;
  // Company evidence for the Company Brain hard gate. Absent means UNKNOWN —
  // never "fine". Populated by enrichment where the provider supplies it.
  companyEmployeeCount?: number | string | null;
  companyStage?: string | null;
  companyBusinessModel?: string | null;
  companyFounderLed?: boolean | null;
}

export interface CompoundPerson {
  name: string | null;
  title: string | null;
  linkedinUrl?: string | null;
  currentCompany?: string | null;
  currentCompanyDomain?: string | null;
  currentCompanyLinkedinUrl?: string | null;
  isCurrent?: boolean | null;
  endDate?: string | null;
  otherCurrent?: Array<string | { name?: string | null; domain?: string | null; linkedin_url?: string | null }>;
}

export interface CompoundLimits {
  rawJobs: number; verifiedCompanies: number; founderLookups: number; foundersPerCompany: number; ranked: number;
  /** Bounded deterministic people-call concurrency. */
  peopleConcurrency?: number;
}
export const DEFAULT_COMPOUND_LIMITS: CompoundLimits = { rawJobs: 25, verifiedCompanies: 10, founderLookups: 8, foundersPerCompany: 2, ranked: 10, peopleConcurrency: 3 };

export interface CompoundDeps {
  fetchJobs: (query: string, max: number) => CompoundJob[] | Promise<CompoundJob[]>;
  fetchPeopleForCompany: (scope: PeopleSearchScope, max: number) => CompoundPerson[] | Promise<CompoundPerson[]>;
}

export type G = "pass" | "fail" | "unknown";
export type CompoundVerdict = "CONTACT" | "WATCH" | "NEEDS_REVIEW" | "REJECT";

export interface EvidenceRef { id: string; kind: "job" | "company" | "employer"; url: string | null }

export interface CompoundCandidate {
  account: CompanyIdentity;
  person: CompoundPerson;
  jobEvidence: CompoundJob;
  jobFamily: JobFamilyResult;
  vertical: VerticalQualification;
  employer: EmployerVerifyResult;
  evidence: EvidenceRef[];
  gates: Record<"company_type" | "company_brain" | "job_family" | "us_relevance" | "person_role" | "employer_match" | "evidence", G>;
  verdict: CompoundVerdict;
  reasons: string[];
  whyNow: string;
  opener: string;
  personKey: string;
  rank: number;
}

export interface CompoundRunResult {
  candidates: CompoundCandidate[];
  diagnostics: {
    rawJobs: number; acceptedJobs: number; verifiedCompanies: number;
    scopedLookups: number; peopleReturned: number;
    droppedJobs: number; droppedCompanies: number; offCompanyPeople: number;
    verdicts: Record<CompoundVerdict, number>;
    /** Company Brain hard-gate funnel. Safe counts + reasons, no payloads. */
    companyBrain: {
      evaluated: number;
      hardPass: number;
      hardFail: number;
      evidencePending: number;
      /** Companies dropped BEFORE any people call, so a reject costs nothing. */
      blockedBeforePeopleSearch: number;
      rejectReasons: Record<string, number>;
      policyHash: string | null;
      enforced: boolean;
    };
  };
}

const OPS_ROLE_INVALID_RE = /\b(former|ex-|advisor|advisory|investor|board member|angel)\b/i;
const FOUNDER_SYNONYM_RE = /\b(co-?founder|founder|founding (?:ceo|partner))\b/i;

function roleMatches(role: string | null, title: string | null): G {
  if (!role) return "pass";
  if (!title) return "unknown";
  const t = title.toLowerCase();
  if (OPS_ROLE_INVALID_RE.test(t)) return "fail";
  if (t.includes(role.toLowerCase())) return "pass";
  if (role.toLowerCase().includes("founder") && FOUNDER_SYNONYM_RE.test(t)) return "pass";
  return "fail";
}

function usRelevance(job: CompoundJob, requireUS: boolean): G {
  if (!requireUS) return "pass";
  const country = normalizeCountry(job.location) ?? detectCountryInText([job.location, job.descriptionExcerpt].filter(Boolean).join(" "));
  if (country === "US") return "pass";
  if (/\bexcluding (?:the )?us|us not eligible|emea only|apac only|eu only\b/i.test(job.descriptionExcerpt ?? "")) return "fail";
  if (country && country !== "US") return "fail";
  return "unknown";
}

function verdictFromGates(g: CompoundCandidate["gates"]): CompoundVerdict {
  const vals = Object.values(g);
  if (vals.includes("fail")) return "REJECT";
  if (vals.every((v) => v === "pass")) return "CONTACT";
  // Missing HARD Company Brain evidence is a research task, not a soft watch.
  if (g.company_brain === "unknown") return "NEEDS_REVIEW";
  if (g.company_type === "unknown") return "NEEDS_REVIEW";
  return "WATCH";
}

export function groundedWhyNow(companyName: string | null, jobTitle: string | null): string {
  const c = companyName ?? "The company"; const t = jobTitle ?? "a role";
  return `${c} is hiring a ${t}.`;
}
export function groundedOpener(companyName: string | null, jobTitle: string | null, vertical: Vertical): string {
  const c = companyName ?? "your company"; const t = jobTitle ?? "this role";
  if (vertical === "automation_integrator") return `Saw that ${c} is hiring a ${t}. Agentory can prepare qualified manufacturers, project-timing evidence, and decision-maker research for your team to review.`;
  if (vertical === "manufacturer") return `Saw that ${c} is hiring a ${t}. Are you establishing the sales function or expanding the existing team?`;
  return `Saw that ${c} is hiring a ${t}. Agentory can help prepare qualified accounts, timing evidence, and contact research for your team to review.`;
}

export async function runCompoundSourcing(
  intent: LeadEntityIntent,
  deps: CompoundDeps,
  opts: {
    limits?: Partial<CompoundLimits>; vertical?: Vertical;
    acceptJob?: (f: JobFamilyResult, j: CompoundJob) => boolean; now?: string;
    /**
     * Company Brain HARD constraints. When present, every company must clear
     * them before it may reach people search. Absent = not enforced, which is
     * the pre-existing behavior for non-qualified-lead callers.
     */
    brainConstraints?: CompanyBrainHardConstraints | null;
    brainPolicyHash?: string | null;
  } = {},
): Promise<CompoundRunResult> {
  if (!intent.company_gate_required) throw new Error("runCompoundSourcing requires a company_gate_required intent");
  const limits = { ...DEFAULT_COMPOUND_LIMITS, ...opts.limits };
  const vertical = opts.vertical ?? inferRequestedVertical(intent.company_categories.join(" ")) ?? "saas";
  const requireUS = intent.geographies.includes("United States");
  const acceptJob = opts.acceptJob ?? ((f: JobFamilyResult) => (intent.hiring_signal_required ? f.qualifiesAsSalesOps : true));
  const diagnostics: CompoundRunResult["diagnostics"] = {
    rawJobs: 0, acceptedJobs: 0, verifiedCompanies: 0, scopedLookups: 0, peopleReturned: 0,
    droppedJobs: 0, droppedCompanies: 0, offCompanyPeople: 0,
    verdicts: { CONTACT: 0, WATCH: 0, NEEDS_REVIEW: 0, REJECT: 0 },
    companyBrain: {
      evaluated: 0, hardPass: 0, hardFail: 0, evidencePending: 0,
      blockedBeforePeopleSearch: 0, rejectReasons: {},
      policyHash: opts.brainPolicyHash ?? null, enforced: !!opts.brainConstraints,
    },
  };

  // 1) JOBS FIRST.
  const jobs = (await deps.fetchJobs(intent.original_user_instruction, limits.rawJobs)).slice(0, limits.rawJobs);
  diagnostics.rawJobs = jobs.length;

  // 2) job-family + location filter; group by canonical company.
  const byCompany = new Map<string, { identity: CompanyIdentity; jobs: Array<{ job: CompoundJob; fam: JobFamilyResult }> }>();
  for (const job of jobs) {
    const fam = classifyJobFamily(job.title, job.descriptionExcerpt ?? null);
    if (!acceptJob(fam, job)) { diagnostics.droppedJobs++; continue; }
    if (usRelevance(job, requireUS) === "fail") { diagnostics.droppedJobs++; continue; }
    const identity = resolveCompanyIdentity({ name: job.company, domain: job.companyDomain, website_url: job.companyWebsite, linkedin_url: job.companyLinkedinUrl, location: job.location });
    const key = identity.dedupeKey ?? `job:${job.url ?? job.company}`;
    if (!byCompany.has(key)) byCompany.set(key, { identity, jobs: [] });
    byCompany.get(key)!.jobs.push({ job, fam });
  }
  diagnostics.acceptedJobs = [...byCompany.values()].reduce((n, c) => n + c.jobs.length, 0);

  // 3) qualify + dedupe companies (already keyed).
  //
  // COMPANY BRAIN IS A HARD GATE HERE, and this is the fix. Before this, the
  // only company check on the company-first path was the VERTICAL check below —
  // "is this SaaS?" — and nothing ever asked "is this the kind of company this
  // workspace actually sells to?". A 7,337-employee company answered yes to the
  // first question and was never asked the second, so it reached the accepted
  // set under a Brain that requires small, early-stage, founder-led teams.
  //
  // A hiring signal cannot buy its way past this. The job is why NOW; the Brain
  // decides whether the company belongs in the pipeline at all.
  const companies = [...byCompany.values()].slice(0, limits.verifiedCompanies).map((c) => {
    const j0 = c.jobs[0].job;
    const vq = qualifyCompanyVertical({ name: c.identity.name, description: j0.companyDescription, industries: j0.industries, job_title: j0.title, job_description: j0.descriptionExcerpt }, vertical);

    // Not enforced (no Brain supplied) => unchanged legacy behavior.
    if (!opts.brainConstraints) return { ...c, vq, brainGate: "pass" as G, brainEval: null as CompanyBrainEvaluation | null };

    diagnostics.companyBrain.evaluated++;
    const brainEval = evaluateCompanyBrainEvidence({
      company: c.identity.name,
      industry: (j0.industries ?? []).join(" ") || null,
      company_category: j0.companyDescription ?? null,
      team_size: j0.companyEmployeeCount ?? null,
      employee_count: j0.companyEmployeeCount ?? null,
      company_stage: j0.companyStage ?? null,
      business_model: j0.companyBusinessModel ?? null,
      founder_led: j0.companyFounderLed ?? null,
      location: j0.location,
    }, opts.brainConstraints);

    const resolved = resolveUnknownEvidence(brainEval.outcome, opts.brainConstraints.unknown_evidence);
    if (resolved === "pass") diagnostics.companyBrain.hardPass++;
    else if (resolved === "fail") diagnostics.companyBrain.hardFail++;
    else diagnostics.companyBrain.evidencePending++;

    for (const r of brainEval.results) {
      if (r.outcome === "pass") continue;
      const key = `${r.constraint}:${r.outcome}`;
      diagnostics.companyBrain.rejectReasons[key] = (diagnostics.companyBrain.rejectReasons[key] ?? 0) + 1;
    }
    return { ...c, vq, brainGate: resolved as G, brainEval };
  })
    .filter((c) => c.vq.outcome !== "fail")
    // A Brain FAILURE is dropped here, before stage 4, so a rejected company
    // never costs a people call and can never appear as an opportunity. Evidence
    // that is merely UNKNOWN is kept and carried into the gates, where it lands
    // as NEEDS_REVIEW rather than being silently accepted or silently discarded.
    .filter((c) => {
      if (c.brainGate !== "fail") return true;
      diagnostics.companyBrain.blockedBeforePeopleSearch++;
      return false;
    });
  diagnostics.droppedCompanies = byCompany.size - companies.length;
  diagnostics.verifiedCompanies = companies.length;

  // 4) SCOPED people search per verified company; verify + gate each person.
  const candidates: CompoundCandidate[] = [];
  const seenPeople = new Set<string>();
  // BOUNDED CONCURRENCY: people calls run in small deterministic batches so a
  // multi-company round fits the wall-clock budget. Results are re-ordered to the
  // original company order, so output stays deterministic regardless of timing.
  const selected = companies.slice(0, limits.founderLookups);
  const scoped = selected
    .map((c) => ({ c, scope: buildPeopleScope(c.identity, { requestedRole: intent.requested_person_role, queryIntent: intent.original_user_instruction, location: c.identity.location, sourceJobId: c.jobs[0].job.url }) }))
    .filter((x): x is { c: typeof selected[number]; scope: NonNullable<ReturnType<typeof buildPeopleScope>> } => x.scope !== null);

  const concurrency = Math.max(1, Math.min(8, limits.peopleConcurrency ?? 3));
  const fetched: Array<{ c: typeof selected[number]; people: CompoundPerson[] }> = [];
  for (let i = 0; i < scoped.length; i += concurrency) {
    const batch = scoped.slice(i, i + concurrency);
    const settled = await Promise.all(batch.map(async ({ c, scope }) => {
      diagnostics.scopedLookups++;
      try {
        const people = (await deps.fetchPeopleForCompany(scope, limits.foundersPerCompany)).slice(0, limits.foundersPerCompany);
        return { c, people };
      } catch {
        return { c, people: [] as CompoundPerson[] };  // one failure never drops the batch
      }
    }));
    fetched.push(...settled);   // batch order preserved => deterministic
  }

  for (const { c, people } of fetched) {
    diagnostics.peopleReturned += people.length;
    const primaryJob = c.jobs[0].job;

    for (const person of people) {
      const employer = verifyCurrentEmployer(person, c.identity, { now: opts.now });
      if (employer.outcome === "verified_mismatch") diagnostics.offCompanyPeople++;

      const companyKeyForEvidence = c.identity.dedupeKey ?? "co";
      const evidence: EvidenceRef[] = [
        { id: `evi_job_${companyKeyForEvidence}`, kind: "job", url: primaryJob.url },
        { id: `evi_company_${companyKeyForEvidence}`, kind: "company", url: c.identity.canonicalDomain ? `https://${c.identity.canonicalDomain}` : c.identity.linkedinUrl },
        { id: `evi_employer_${companyKeyForEvidence}`, kind: "employer", url: person.linkedinUrl ?? null },
      ];

      const gates: CompoundCandidate["gates"] = {
        company_type: c.vq.outcome === "pass" ? "pass" : "unknown",
        company_brain: c.brainGate,
        job_family: c.jobs[0].fam.qualifiesAsSalesOps ? "pass" : (intent.hiring_signal_required ? "fail" : "pass"),
        us_relevance: usRelevance(primaryJob, requireUS),
        person_role: roleMatches(intent.requested_person_role, person.title),
        employer_match: employer.outcome === "verified_match" ? "pass" : (employer.outcome === "verified_mismatch" || employer.outcome === "historical_only") ? "fail" : "unknown",
        evidence: primaryJob.url ? "pass" : "fail",
      };
      const verdict = verdictFromGates(gates);
      const personKey = (person.linkedinUrl?.toLowerCase().replace(/[?#].*$/, "").replace(/\/+$/, "")) ?? `name:${(person.name ?? "").toLowerCase()}|${companyKeyForEvidence}`;
      if (seenPeople.has(personKey)) continue; // person dedupe
      seenPeople.add(personKey);

      candidates.push({
        account: c.identity, person, jobEvidence: primaryJob, jobFamily: c.jobs[0].fam, vertical: c.vq, employer, evidence, gates, verdict,
        reasons: Object.entries(gates).filter(([, g]) => g !== "pass").map(([k, g]) => `${k}:${g}`),
        whyNow: groundedWhyNow(c.identity.name, primaryJob.title),
        opener: groundedOpener(c.identity.name, primaryJob.title, vertical),
        personKey, rank: 0,
      });
    }
  }

  // 5) rank: verdict class → then company key → person key (deterministic; order-free).
  const order: Record<CompoundVerdict, number> = { CONTACT: 0, WATCH: 1, NEEDS_REVIEW: 2, REJECT: 3 };
  candidates.sort((a, b) => order[a.verdict] - order[b.verdict] || (a.account.dedupeKey ?? "").localeCompare(b.account.dedupeKey ?? "") || a.personKey.localeCompare(b.personKey));
  const ranked = candidates.slice(0, Math.max(limits.ranked, candidates.length)).map((c, i) => ({ ...c, rank: i + 1 }));
  for (const c of ranked) diagnostics.verdicts[c.verdict]++;

  return { candidates: ranked, diagnostics };
}

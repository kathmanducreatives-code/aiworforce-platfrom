// People adapter: real harvestapi/linkedin-profile-search rows → CompoundPerson.
//
// Builds a COMPANY-SCOPED people input (harvestapi company filters require FULL
// LinkedIn company URLs — names are dropped), and maps profile rows into the
// employer-verification shape, preserving current + historical employment and
// provider/LinkedIn identifiers. Defensive against the several key spellings the
// actor + the harvest tool emit. Pure; malformed rows recorded, never thrown.

import type { CompoundPerson } from "./compoundSourcingPipeline.ts";
import type { PeopleSearchScope } from "./scopedPeopleSearch.ts";

const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : (typeof v === "number" ? String(v) : null));
function firstStr(o: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) { const v = s(o[k]); if (v) return v; }
  return null;
}

/** Build the bounded, COMPANY-SCOPED people actor input for one verified company.
 *  Uses the strongest supported company identifier (LinkedIn URL required by the
 *  actor's company filter; domain/name carried for tracing). */
export function buildScopedPeopleInput(scope: PeopleSearchScope, max: number): Record<string, unknown> {
  const roleKeywords = scope.requestedRole ? [scope.requestedRole] : ["founder"];
  const input: Record<string, unknown> = {
    max_results: Math.max(1, Math.min(50, max)),
    currentJobTitles: roleKeywords,
    role_keywords: roleKeywords,
    // company scoping — FULL LinkedIn company URL is the only reliable filter.
    ...(scope.companyLinkedinUrl ? { currentCompanies: [`https://www.${scope.companyLinkedinUrl}`] } : {}),
    // carried for provenance/diagnosis (never used to widen the search):
    _scope_company: scope.companyName,
    _scope_domain: scope.companyDomain,
    _scope_key: scope.companyDedupeKey,
    _scope_source_job: scope.sourceJobId,
    _scope_intent: scope.queryIntent,
    ...(scope.location ? { locations: [scope.location] } : {}),
  };
  return input;
}

interface Experience { companyName?: string | null; company?: string | null; companyUrl?: string | null; companyLinkedinUrl?: string | null; companyDomain?: string | null; title?: string | null; current?: boolean | null; isCurrent?: boolean | null; endDate?: string | null; end?: string | null; dateRange?: string | null }

/** Map ONE harvestapi profile row (or a harvested RawCandidate) into CompoundPerson. */
export function peopleRowToCompoundPerson(row: unknown): CompoundPerson | null {
  if (!row || typeof row !== "object") return null;
  const o = row as Record<string, unknown>;

  const name = firstStr(o, ["personName", "fullName", "name", "full_name"]);
  const title = firstStr(o, ["personTitle", "headline", "occupation", "title", "jobTitle"]);
  const linkedinUrl = firstStr(o, ["sourceUrl", "linkedinUrl", "profileUrl", "publicProfileUrl", "url"]);
  if (!name && !linkedinUrl) return null;

  // Preferred: an explicit experience/positions array (current + historical).
  const exps = (Array.isArray(o.experience) ? o.experience : Array.isArray(o.positions) ? o.positions : []) as Experience[];
  const currents = exps.filter((e) => e && (e.current === true || e.isCurrent === true || (!e.endDate && !e.end && !e.dateRange?.match(/\d{4}\s*[-–]\s*\d{4}/))));
  const primaryExp = currents[0] ?? exps[0];

  const currentCompany = primaryExp?.companyName ?? primaryExp?.company ?? firstStr(o, ["currentCompany", "companyName", "company"]);
  const currentCompanyLinkedinUrl = primaryExp?.companyUrl ?? primaryExp?.companyLinkedinUrl ?? firstStr(o, ["companyLinkedinUrl", "currentCompanyLinkedinUrl"]);
  const currentCompanyDomain = primaryExp?.companyDomain ?? firstStr(o, ["companyDomain", "currentCompanyDomain"]);
  const isCurrent = primaryExp ? (primaryExp.current ?? primaryExp.isCurrent ?? (!primaryExp.endDate && !primaryExp.end)) : (o.isCurrent as boolean | undefined ?? null);
  const endDate = primaryExp?.endDate ?? primaryExp?.end ?? null;

  const otherCurrent = currents.slice(1).map((e) => ({ name: e.companyName ?? e.company ?? null, domain: e.companyDomain ?? null, linkedin_url: e.companyUrl ?? e.companyLinkedinUrl ?? null }));

  return {
    name, title, linkedinUrl,
    currentCompany: s(currentCompany), currentCompanyDomain: s(currentCompanyDomain), currentCompanyLinkedinUrl: s(currentCompanyLinkedinUrl),
    isCurrent: typeof isCurrent === "boolean" ? isCurrent : null,
    endDate: s(endDate),
    otherCurrent: otherCurrent.length ? otherCurrent : undefined,
  };
}

export function compoundPeopleFromRows(rows: unknown[], max: number): { people: CompoundPerson[]; dropped: number } {
  const people: CompoundPerson[] = [];
  let dropped = 0;
  for (const r of rows) {
    if (people.length >= max) break;
    const p = peopleRowToCompoundPerson(r);
    if (p) people.push(p); else dropped++;
  }
  return { people, dropped };
}

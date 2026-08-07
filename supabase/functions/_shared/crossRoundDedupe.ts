// ONE COMPANY IS ONE OPPORTUNITY, HOWEVER MANY WAYS IT WAS FOUND.
//
// Across three rounds and several search concepts the same company arrives
// repeatedly: once from a startup cohort, once from a company search, once from
// a broadened concept. Counting it three times inflates "delivered" with work
// nobody did, and evaluating it three times pays a model three times for one
// verdict.
//
// SO THE LATER COPY IS MERGED, NOT DISCARDED. Discarding it throws away the
// evidence that copy carried — a description the first source lacked, a job
// posting that proves the hiring signal, the round it reappeared in. The
// merged record is strictly better informed than either copy alone, and it
// remembers where each part came from.
//
// AND A DISAGREEMENT IS KEPT, NOT RESOLVED. Two sources reporting different
// domains for the same LinkedIn company is a fact about the evidence. Silently
// picking one is how a wrong domain becomes an unqualified certainty three
// stages downstream, so both are recorded and the conflict travels with the
// company.
//
// PURE. No network, provider, model or database access.

import { normalizeDomain } from "./leadCommercialPrequalification.ts";

export const CROSS_ROUND_DEDUPE_VERSION = "cross-round-dedupe-v1" as const;

/** Strongest identity first. A weaker kind never overrides a stronger one. */
export type IdentityKind = "linkedin" | "domain" | "company_key" | "name";

const IDENTITY_RANK: Record<IdentityKind, number> = {
  linkedin: 0, domain: 1, company_key: 2, name: 3,
};

export interface RoundCandidate {
  company_key: string;
  company_name?: string | null;
  linkedin_company_url?: string | null;
  website?: string | null;
  description?: string | null;
  source_urls?: string[];
  job_evidence?: unknown[];
  employee_count?: number | null;
  location?: string | null;
  signal_evidence?: string[];
  /** Which round and concept produced this sighting. */
  discovered_round: number;
  search_concept?: string | null;
  provider_operation?: string | null;
}

export interface EvidenceConflict {
  field: string;
  existing: string;
  incoming: string;
  round: number;
}

export interface PooledCompany {
  identity_key: string;
  identity_kind: IdentityKind;
  company_key: string;
  company_name: string | null;
  linkedin_company_url: string | null;
  domain: string | null;
  employee_count: number | null;
  location: string | null;
  descriptions: string[];
  source_urls: string[];
  job_evidence: unknown[];
  signal_evidence: string[];
  first_discovered_round: number;
  all_discovered_rounds: number[];
  search_concepts: string[];
  provider_operations: string[];
  conflicts: EvidenceConflict[];
  /**
   * Bumped ONLY when merging added evidence that could change a verdict.
   *
   * This is what makes incremental evaluation safe: a company whose revision is
   * unchanged since it was evaluated keeps its grounded result, and one whose
   * revision moved is re-evaluated because the thing it was judged on is no
   * longer what it was judged on.
   */
  evidence_revision: number;
  last_changed_round: number;
}

/** `linkedin.com/company/<slug>` → `<slug>`, or null. */
export function linkedInCompanySlug(v: unknown): string | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return null;
  const m = s.match(/linkedin\.com\/company\/([^/?#]+)/);
  if (!m) return null;
  const slug = m[1].replace(/\/+$/, "").trim();
  return slug || null;
}

/** A name is the weakest identity, so it is normalised hardest before use. */
export function normalizedCompanyName(v: unknown): string | null {
  const s = String(v ?? "").toLowerCase()
    // Legal suffixes are noise for identity and have caused false REJECTs
    // before; they are stripped for matching only, never from the stored name.
    .replace(/[.,]/g, " ")
    .replace(/\b(inc|llc|ltd|limited|corp|corporation|gmbh|bv|pty|plc|co|sa|ag|srl|oy|ab)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return s || null;
}

export interface ResolvedIdentity {
  key: string;
  kind: IdentityKind;
}

/**
 * The identity a candidate is pooled under.
 *
 * Ordered by how forgeable and how stable each signal is. A verified LinkedIn
 * company is one company; a domain is nearly as good; a name is a guess and is
 * used only when nothing else exists.
 */
export function resolveIdentity(c: RoundCandidate): ResolvedIdentity {
  const slug = linkedInCompanySlug(c.linkedin_company_url);
  if (slug) return { key: `li:${slug}`, kind: "linkedin" };
  const domain = normalizeDomain(c.website);
  if (domain) return { key: `dom:${domain}`, kind: "domain" };
  const key = String(c.company_key ?? "").trim().toLowerCase();
  if (key) return { key: `key:${key}`, kind: "company_key" };
  const name = normalizedCompanyName(c.company_name);
  return { key: name ? `name:${name}` : `unknown:${Math.random()}`, kind: "name" };
}

const uniq = (a: readonly string[]) => [...new Set(a.filter(Boolean))];

function toPooled(c: RoundCandidate, id: ResolvedIdentity): PooledCompany {
  return {
    identity_key: id.key,
    identity_kind: id.kind,
    company_key: c.company_key,
    company_name: c.company_name ?? null,
    linkedin_company_url: c.linkedin_company_url ?? null,
    domain: normalizeDomain(c.website),
    employee_count: c.employee_count ?? null,
    location: c.location ?? null,
    descriptions: c.description ? [c.description] : [],
    source_urls: uniq(c.source_urls ?? []),
    job_evidence: [...(c.job_evidence ?? [])],
    signal_evidence: uniq(c.signal_evidence ?? []),
    first_discovered_round: c.discovered_round,
    all_discovered_rounds: [c.discovered_round],
    search_concepts: uniq(c.search_concept ? [c.search_concept] : []),
    provider_operations: uniq(c.provider_operation ? [c.provider_operation] : []),
    conflicts: [],
    evidence_revision: 1,
    last_changed_round: c.discovered_round,
  };
}

/**
 * Fold a re-sighting into the company already pooled.
 *
 * FILL, NEVER OVERWRITE. A field the pool already knows is kept and any
 * disagreement is recorded; a field it lacks is filled from the newcomer. This
 * is the same precedence rule the mission compiler uses for provenance, and it
 * means a later, weaker source can improve a record but never rewrite it.
 */
export function mergeCandidate(
  existing: PooledCompany, incoming: RoundCandidate,
): PooledCompany {
  const merged: PooledCompany = { ...existing };
  const conflicts = [...existing.conflicts];
  let material = false;

  const fill = (
    field: keyof PooledCompany, value: string | number | null, isMaterial: boolean,
  ) => {
    if (value === null || value === undefined || value === "") return;
    const current = merged[field] as string | number | null;
    if (current === null || current === undefined || current === "") {
      (merged[field] as unknown) = value;
      if (isMaterial) material = true;
      return;
    }
    if (String(current) !== String(value)) {
      conflicts.push({
        field: String(field), existing: String(current),
        incoming: String(value), round: incoming.discovered_round,
      });
    }
  };

  fill("company_name", incoming.company_name ?? null, false);
  fill("linkedin_company_url", incoming.linkedin_company_url ?? null, true);
  fill("domain", normalizeDomain(incoming.website), true);
  fill("employee_count", incoming.employee_count ?? null, true);
  fill("location", incoming.location ?? null, true);

  // A NEW DESCRIPTION IS NEW EVIDENCE. The semantic classifier reads these, so
  // adding one can legitimately change a verdict.
  if (incoming.description && !merged.descriptions.includes(incoming.description)) {
    merged.descriptions = [...merged.descriptions, incoming.description];
    material = true;
  }
  const beforeJobs = merged.job_evidence.length;
  if (incoming.job_evidence?.length) {
    merged.job_evidence = [...merged.job_evidence, ...incoming.job_evidence];
    if (merged.job_evidence.length !== beforeJobs) material = true;
  }
  const beforeSignals = merged.signal_evidence.length;
  merged.signal_evidence = uniq([...merged.signal_evidence, ...(incoming.signal_evidence ?? [])]);
  if (merged.signal_evidence.length !== beforeSignals) material = true;

  // LINEAGE. Never material on its own — knowing a company was found twice does
  // not change what it is, and bumping the revision for it would repurchase
  // every duplicate's evaluation.
  merged.source_urls = uniq([...merged.source_urls, ...(incoming.source_urls ?? [])]);
  merged.all_discovered_rounds = uniq([
    ...merged.all_discovered_rounds.map(String), String(incoming.discovered_round),
  ]).map(Number).sort((a, b) => a - b);
  merged.search_concepts = uniq([
    ...merged.search_concepts, ...(incoming.search_concept ? [incoming.search_concept] : []),
  ]);
  merged.provider_operations = uniq([
    ...merged.provider_operations,
    ...(incoming.provider_operation ? [incoming.provider_operation] : []),
  ]);

  merged.conflicts = conflicts;
  if (material) {
    merged.evidence_revision = existing.evidence_revision + 1;
    merged.last_changed_round = incoming.discovered_round;
  }

  // A STRONGER IDENTITY UPGRADES THE RECORD. A company first pooled by name and
  // later seen with a LinkedIn URL becomes a LinkedIn-identified company, so a
  // third sighting matches on the strong key rather than starting a new row.
  const incomingId = resolveIdentity(incoming);
  if (IDENTITY_RANK[incomingId.kind] < IDENTITY_RANK[merged.identity_kind]) {
    merged.identity_key = incomingId.key;
    merged.identity_kind = incomingId.kind;
  }
  return merged;
}

/**
 * Do these two hold any STRONG identity in common that disagrees?
 *
 * Only a shared kind can contradict. A pooled company with no LinkedIn cannot
 * disagree with a candidate that has one — it simply does not know, and the
 * merge is what teaches it.
 */
function identitiesAgree(pooled: PooledCompany, cand: RoundCandidate): boolean {
  const pSlug = linkedInCompanySlug(pooled.linkedin_company_url);
  const cSlug = linkedInCompanySlug(cand.linkedin_company_url);
  if (pSlug && cSlug && pSlug !== cSlug) return false;
  const pDom = pooled.domain;
  const cDom = normalizeDomain(cand.website);
  if (pDom && cDom && pDom !== cDom) return false;
  return true;
}

export interface AddResult {
  pool: Map<string, PooledCompany>;
  /** Companies never seen in any previous round. */
  newCompanies: string[];
  /** Already present, and merged into. */
  duplicates: string[];
  /** Present, and the merge changed evidence that could change a verdict. */
  materiallyChanged: string[];
}

/**
 * Add one round's discoveries to the running pool.
 *
 * Aliases are followed so that a company pooled under a weak identity is found
 * again when a stronger one arrives — without this, the same company appears
 * once as `name:acme` and once as `li:acme-inc`, which is precisely the double
 * count this module exists to prevent.
 */
export function addRoundCandidates(
  pool: Map<string, PooledCompany>,
  candidates: readonly RoundCandidate[],
): AddResult {
  const next = new Map(pool);
  // Every key a pooled company can be reached by, including upgraded ones.
  const alias = new Map<string, string>();
  for (const [k, c] of next) {
    alias.set(k, k);
    alias.set(c.identity_key, k);
    const slug = linkedInCompanySlug(c.linkedin_company_url);
    if (slug) alias.set(`li:${slug}`, k);
    if (c.domain) alias.set(`dom:${c.domain}`, k);
    if (c.company_key) alias.set(`key:${c.company_key.toLowerCase()}`, k);
    const n = normalizedCompanyName(c.company_name);
    if (n) alias.set(`name:${n}`, k);
  }

  const newCompanies: string[] = [];
  const duplicates: string[] = [];
  const materiallyChanged: string[] = [];

  for (const cand of candidates) {
    const id = resolveIdentity(cand);
    // Try the resolved identity, then every weaker form it could already be
    // pooled under.
    const probes = [id.key];
    const slug = linkedInCompanySlug(cand.linkedin_company_url);
    if (slug) probes.push(`li:${slug}`);
    const dom = normalizeDomain(cand.website);
    if (dom) probes.push(`dom:${dom}`);
    if (cand.company_key) probes.push(`key:${cand.company_key.toLowerCase()}`);
    const nm = normalizedCompanyName(cand.company_name);
    if (nm) probes.push(`name:${nm}`);

    // A WEAK MATCH IS REFUSED WHEN A STRONG ONE CONTRADICTS IT.
    //
    // Two companies that share a name but hold DIFFERENT LinkedIn identities
    // are two companies. Without this, "Acme Inc" the vertical SaaS and "Acme
    // Inc" the agency merge into one row and one of the two opportunities
    // silently disappears from the count. A pooled company that has no strong
    // identity is still matched and upgraded — the block needs both sides to
    // hold the same KIND of identity and disagree about it.
    const hit = probes
      .map((p) => alias.get(p))
      .find((x): x is string => !!x && next.has(x) &&
        identitiesAgree(next.get(x)!, cand));

    if (hit && next.has(hit)) {
      const before = next.get(hit)!;
      const merged = mergeCandidate(before, cand);
      next.set(hit, merged);
      duplicates.push(hit);
      if (merged.evidence_revision !== before.evidence_revision) {
        materiallyChanged.push(hit);
      }
      for (const p of probes) alias.set(p, hit);
      continue;
    }

    const pooled = toPooled(cand, id);
    next.set(id.key, pooled);
    for (const p of probes) alias.set(p, id.key);
    newCompanies.push(id.key);
  }

  return {
    pool: next,
    newCompanies: [...new Set(newCompanies)],
    duplicates: [...new Set(duplicates)],
    materiallyChanged: [...new Set(materiallyChanged)],
  };
}

/**
 * Which companies must be evaluated this round?
 *
 * Three cases, and only three: never evaluated, evidence materially changed
 * since it was, or previously unresolved and now carrying the evidence it
 * lacked. Everything else keeps the verdict already paid for.
 */
export function selectForEvaluation(i: {
  pool: Map<string, PooledCompany>;
  /** identity_key → the evidence_revision the stored verdict was computed at. */
  evaluatedAtRevision: Map<string, number>;
  /** Keys whose stored verdict left them unresolved (REVIEW / not grounded). */
  unresolvedKeys?: readonly string[];
}): { evaluate: string[]; restore: string[] } {
  const unresolved = new Set(i.unresolvedKeys ?? []);
  const evaluate: string[] = [];
  const restore: string[] = [];
  for (const [key, c] of i.pool) {
    const at = i.evaluatedAtRevision.get(key);
    if (at === undefined) { evaluate.push(key); continue; }
    if (c.evidence_revision !== at) { evaluate.push(key); continue; }
    // An unresolved company is only worth re-asking about if something changed;
    // re-asking on identical evidence buys the same answer twice.
    if (unresolved.has(key) && c.evidence_revision > at) { evaluate.push(key); continue; }
    restore.push(key);
  }
  return { evaluate, restore };
}

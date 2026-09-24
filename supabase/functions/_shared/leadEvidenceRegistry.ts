// THE EVIDENCE REGISTRY — every fact this company has, with a name you can cite.
//
// WHY.
//
// The classifier returned free-form strings: `supporting_evidence: ["sells B2B
// API subscriptions"]`. The only check was that the array was non-empty. So a
// model that had read a one-line LinkedIn description could assert an API
// subscription business, and nothing in the system could tell the difference
// between that and a claim quoted from the company's own words.
//
// The fix is not a better prompt. It is that a claim must POINT at something.
// This module gives every collected fact a stable identifier, so a claim can
// cite one and `verifyGroundedResult` can go and look.
//
// TWO CATEGORIES, KEPT APART ON PURPOSE.
//
//   HARD FACTS  — identity, LinkedIn URL, domain, declared size band, geography,
//                 job titles, job URLs, posting dates, provider outcome,
//                 freshness. Code establishes these. The model may cite them
//                 and may NOT restate them: turning "11-50" into "23 employees"
//                 — or a LinkedIn associated-member count into a headcount —
//                 is the failure this separation exists to make impossible.
//
//   INFERENCES  — business model, B2B relevance, customer type, use-case
//                 strength, what a signal MEANS. The model owns these, and each
//                 one must still cite the hard evidence it was drawn from.
//
// PROVIDER FAILURE IS NOT A NEGATIVE FACT. A job search that errored is
// recorded as `provider_failure`, never as "no openings found". The difference
// is the difference between "we do not know" and "we checked and there is
// nothing", and only one of those may reject a company.
//
// PURE. No network, provider, model or database access.

import { sizeBandLabel, type CompanySizeBand } from "./companySize.ts";
import type { CompanyEvidenceRecord } from "./leadCompanyEvidence.ts";
import type { NormalizedHiringJob } from "./hiringActorNormalizers.ts";

/** The dated, sourced shape both news articles and company posts reduce to. */
export interface NewsEvidence {
  title: string | null;
  url: string | null;
  source: string | null;
  published_at: string | null;
  description?: string | null;
}

export const EVIDENCE_REGISTRY_VERSION = "lead-evidence-registry-v1" as const;

export type EvidenceType =
  | "company_description"
  | "company_industry"
  | "company_website"
  /**
   * LEGACY. Stored registries from before 2026-09-24 carry LinkedIn's
   * `employeeCount` under this name; it is associated members, not staff, and
   * is read as such (evidenceGraph). Nothing writes it any more.
   */
  | "employee_count"
  /** The company's DECLARED size band (companySize.ts). */
  | "company_size_band"
  /** LinkedIn associated members. Informational — NOT staff headcount. */
  | "linkedin_associated_members"
  | "company_location"
  | "job_posting"
  | "yc_company_record"
  | "yc_job"
  | "funding_signal"
  // ── DATED PUBLIC EVIDENCE FOR A NON-HIRING SIGNAL ────────────────────────
  //
  // A news article or a company's own post that states an expansion or a
  // launch. Kept as distinct types rather than one `news` bucket because the
  // signal a verdict cites must be the signal it claims: an article proving a
  // launch may not be cited for an expansion.
  | "expansion_signal"
  | "launch_signal"
  | "identity_match"
  | "provider_failure"
  // ── A PAGE WE FETCHED, WITH ITS OWN WORDS ─────────────────────
  //
  // A HARD FACT, on the same footing as a job posting: the text is the
  // company's own, quoted and never rewritten. What the page MEANS — that
  // this is a B2B SaaS business, that it sells to banks — stays an
  // INFERENCE the model must draw and cite back to one of these items.
  //
  // Added because the registry had no way to represent a fetched page, so
  // a claim about a company's business model had nothing legal to cite and
  // `missionEvaluation` correctly dropped it. Run a5c1616e: seven
  // candidates refused on exactly that.
  | "web_page"
  | "other";

export type Freshness = "current" | "stale" | "unknown";

export type VerificationState = "verified" | "reported" | "conflicting" | "invalid";

export interface EvidenceItem {
  evidence_id: string;
  company_key: string;
  evidence_type: EvidenceType;
  source: string;
  source_url: string | null;
  /** The typed fact, when there is one. Numbers stay numbers. */
  structured_value: unknown;
  /** The provider's own words. NEVER rewritten, never model-authored. */
  source_text: string | null;
  observed_at: string | null;
  freshness: Freshness;
  verification_state: VerificationState;
  metadata: Record<string, unknown>;
}

export interface EvidenceRegistry {
  version: typeof EVIDENCE_REGISTRY_VERSION;
  company_key: string;
  items: EvidenceItem[];
  /** Facts code established. The model cites them; it never restates them. */
  hard_facts: HardFacts;
}

/**
 * What CODE knows, independent of anything a model says.
 *
 * `null` means "not established", which is different from a value of zero or
 * an empty string. Every consumer must treat the two differently — that is why
 * they are nullable rather than defaulted.
 */
export interface HardFacts {
  company_key: string;
  company_name: string | null;
  domain: string | null;
  linkedin_company_url: string | null;
  identity_state: CompanyEvidenceRecord["identity_state"];
  /** The company's DECLARED size band — what a size requirement is judged on. */
  company_size_band: CompanySizeBand | null;
  /** LinkedIn associated members. NOT staff; never a size fact. */
  linkedin_associated_member_count: number | null;
  /** A non-LinkedIn provider's size wording. Never converted into a count. */
  employee_range_advisory: string | null;
  geography: string | null;
  job_titles: string[];
  job_urls: string[];
  posting_dates: string[];
  /** True only when a provider actually failed — not when it returned nothing. */
  provider_failed: boolean;
  provider_failures: string[];
}

// ─────────────────────────────────────────────────────────── stable ids ──

/** Deterministic, order-independent, and short enough to read in a log. */
export function fingerprint(parts: readonly (string | null | undefined)[]): string {
  // "\u0000" as an ESCAPE, never a raw byte: a raw NUL made this file binary
  // to git and grep. The separator itself must stay — without one ["ab","c"]
  // and ["a","bc"] collide — and must stay NUL, or every stored item id moves.
  const s = parts.map((p) => String(p ?? "")).join("\u0000");
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

/**
 * `type:source:hash` — stable across runs for the same fact.
 *
 * The hash covers the COMPANY as well as the content, so the same description
 * text under two companies yields two different ids. That is what makes
 * "cited another company's evidence" a detectable error rather than a
 * coincidence.
 */
export function evidenceId(
  companyKey: string, type: EvidenceType, source: string, content: unknown,
): string {
  const body = typeof content === "string" ? content : JSON.stringify(content ?? null);
  // THE LABEL, NOT THE VENDOR. The id is shown to the model so it can cite one,
  // which means a raw `harvestapi/linkedin-job-search` here would reintroduce
  // the provider vocabulary the compiler stage exists to keep out — and would
  // let a claim cite a vendor name as though it were proof. The hash still
  // covers the real source, so two providers never collide.
  return `${type}:${abstractSourceLabel(source)}:${
    fingerprint([companyKey, type, source, body])}`;
}

/**
 * What KIND of source this is.
 *
 * The model needs to know a description came from LinkedIn rather than a job
 * board — that changes how much weight it carries. It does not need to know
 * which vendor scraped it.
 */
export function abstractSourceLabel(source: string): string {
  const s = String(source ?? "").toLowerCase();
  if (s === "provider_label") return "provider_label";
  if (s === "conflict") return "conflict_note";
  if (s.includes("job")) return "job_source";
  if (s.includes("linkedin")) return "linkedin";
  if (s.includes("yc") || s.includes("memo23") || s.includes("solidcode")) {
    return "startup_directory";
  }
  if (s.includes("domain") || s.includes("website")) return "company_website";
  return "other_source";
}

function clean(s: unknown): string | null {
  const v = typeof s === "string" ? s.trim() : "";
  return v.length > 0 ? v : null;
}

/** Days after which a posting is no longer "current". */
export const JOB_CURRENT_WINDOW_DAYS = 60;

export function freshnessOf(observedAt: string | null, now: number = Date.now()): Freshness {
  if (!observedAt) return "unknown";
  const t = Date.parse(observedAt);
  if (!Number.isFinite(t)) return "unknown";
  const days = (now - t) / 86_400_000;
  // A FUTURE DATE IS NOT FRESH, it is wrong — and calling it current would let
  // a mis-parsed field satisfy a "current signal" requirement.
  if (days < -1) return "unknown";
  return days <= JOB_CURRENT_WINDOW_DAYS ? "current" : "stale";
}

// ──────────────────────────────────────────────────────── construction ──

export interface RegistryInput {
  evidence: CompanyEvidenceRecord;
  /** Normalized job rows attributed to this company. */
  jobs?: readonly NormalizedHiringJob[];
  /**
   * The funding round this company was discovered by, when it was.
   *
   * The round IS the evidence — stage, amount, announced date, investors and
   * the articles that reported it. It was collected by
   * `funding_signal_discovery` and then dropped: `fundingRounds` was pushed to
   * and never read, so a funding mission proved nothing it had paid to find.
   */
  funding_round?: {
    round_stage: string | null;
    amount_usd: number | null;
    currency: string | null;
    announced_date: string | null;
    investors: readonly string[];
    source_articles: readonly string[];
  } | null;
  /**
   * Dated public statements that a company EXPANDED, and that it LAUNCHED.
   *
   * Kept apart because a verdict must cite the signal it claims. An article
   * proving a launch is not evidence of an expansion, and one registry bucket
   * would have let a verdict cite the wrong one.
   */
  expansion_evidence?: readonly NewsEvidence[];
  launch_evidence?: readonly NewsEvidence[];
  /** YC / cohort description, when discovery supplied one. */
  yc_description?: string | null;
  /** Provider operations that FAILED. Not operations that returned nothing. */
  provider_failures?: readonly { provider: string; capability: string; reason: string }[];
  /**
   * Second opinions on the DECLARED BAND (a discovery row's band, when the
   * company record declares another), for explicit conflict recording.
   */
  employee_count_alternatives?: readonly { source: string; value: string }[];
  /**
   * Pages fetched from the company's own site, with their own words.
   *
   * ── WHY THESE ARE HARD FACTS ───────────────────────────────────────────
   *
   * A page's text is the company's own statement, quoted and never rewritten —
   * the same standing as a job posting or a LinkedIn description. What the page
   * MEANS ("this is a B2B SaaS business", "they sell to banks") stays an
   * INFERENCE the model must draw and cite back to one of these items.
   *
   * They exist because run a5c1616e refused seven candidates that passed every
   * checkable requirement: the registry held nothing citable about a business
   * model, so `insufficient_evidence` was the honest answer. This is the
   * missing citable thing.
   *
   * Supplied from `company_web_evidence`, so a page bought once is read by
   * every later mission without being bought again.
   */
  web_pages?: readonly {
    source_url: string;
    page_intent: string;
    source_text: string;
    fetched_at: string | null;
  }[];
  now?: number;
}

/**
 * Build the registry for one company.
 *
 * Every item is attributed to `evidence.company_key` and nothing else. There is
 * no path here that files a fact under a company it did not come from, which is
 * what makes the verifier's ownership check meaningful rather than decorative.
 */
export function buildEvidenceRegistry(i: RegistryInput): EvidenceRegistry {
  const e = i.evidence;
  const key = e.company_key;
  const now = i.now ?? Date.now();
  const items: EvidenceItem[] = [];

  const push = (
    type: EvidenceType, source: string, content: unknown,
    over: Partial<EvidenceItem> = {},
  ) => {
    items.push({
      evidence_id: evidenceId(key, type, source, content),
      company_key: key,
      evidence_type: type,
      source,
      source_url: null,
      structured_value: null,
      source_text: null,
      observed_at: null,
      freshness: "unknown",
      verification_state: "reported",
      metadata: {},
      ...over,
    });
  };

  // ── PAGES THE COMPANY WROTE ABOUT ITSELF ────────────────────────────────
  //
  // Placed FIRST so a model reading the registry top-down meets the company's
  // own words before a provider's one-line summary of them. Nothing here is
  // interpreted: `source_text` is the fetched markdown, and the intent travels
  // in metadata so a verdict can say which KIND of page it read.
  for (const w of i.web_pages ?? []) {
    if (!w.source_text || !w.source_text.trim()) continue;
    push("web_page", "company_website", w.source_url, {
      source_url: w.source_url,
      source_text: w.source_text,
      observed_at: w.fetched_at,
      // The page was fetched from the company's own registrable domain and its
      // text is quoted verbatim, so it is verified in the only sense this
      // registry uses: we know where it came from and we did not rewrite it.
      verification_state: "verified",
      freshness: w.fetched_at ? "current" : "unknown",
      metadata: { page_intent: w.page_intent },
    });
  }

  // ── DESCRIPTIONS. The only place a business-model inference may come from.
  if (e.description) {
    push("company_description", "linkedin", e.description, {
      source_text: e.description,
      source_url: e.linkedin_company_url,
      verification_state: e.identity_state === "resolved" ? "verified" : "reported",
    });
  }
  const yc = clean(i.yc_description);
  if (yc) {
    push("yc_company_record", "yc", yc, { source_text: yc, verification_state: "reported" });
  }

  // ── INDUSTRY. Supporting context ONLY; the verifier refuses it as sole proof.
  for (const ind of e.industry_evidence) {
    const isProviderLabel = ind.startsWith("provider_label:");
    push("company_industry", isProviderLabel ? "provider_label" : "linkedin", ind, {
      structured_value: ind.replace(/^provider_label:/, ""),
      source_text: ind.replace(/^provider_label:/, ""),
      metadata: { sole_proof_permitted: false, provider_label: isProviderLabel },
    });
  }

  if (e.domain) {
    push("company_website", "domain", e.domain, {
      structured_value: e.domain, source_url: `https://${e.domain}`,
    });
  }

  // ── SIZE: TWO TYPED FACTS, NEVER ONE (companySize.ts) ───────────────────
  //
  // The DECLARED BAND is what a size requirement is judged on. It is verified
  // only when read from the company record; a discovery row's band is reported.
  // A citation quotes the sentence, never a bare number: `containsExcerpt`
  // needs at least four characters, so "45" was structurally uncitable.
  if (e.size_band_evidence) {
    const label = sizeBandLabel(e.size_band_evidence);
    const alts = i.employee_count_alternatives ?? [];
    const conflicting = alts.some((a) => a.value !== label);
    push("company_size_band", "linkedin", label, {
      structured_value: e.size_band_evidence,
      source_text: `declared company size ${label} employees`,
      verification_state: conflicting ? "conflicting"
        : e.size_band_from_company_record ? "verified" : "reported",
      metadata: conflicting ? { alternatives: alts } : {},
    });
    for (const a of alts) {
      push("company_size_band", a.source, a.value, {
        structured_value: a.value, source_text: `declared company size ${a.value} employees`,
        verification_state: conflicting ? "conflicting" : "reported",
      });
    }
  }
  // The LinkedIn ASSOCIATED-MEMBER count, named for what it is so no citation
  // can quote it as a staff figure. Reported, never verified as a size.
  if (e.linkedin_member_count_evidence != null) {
    push("linkedin_associated_members", "linkedin", e.linkedin_member_count_evidence, {
      structured_value: e.linkedin_member_count_evidence,
      source_text: `${e.linkedin_member_count_evidence} LinkedIn associated members (not a staff count)`,
      verification_state: "reported",
    });
  }

  if (e.geography_evidence) {
    push("company_location", "linkedin", e.geography_evidence, {
      structured_value: e.geography_evidence, source_text: e.geography_evidence,
      verification_state: e.identity_state === "resolved" ? "verified" : "reported",
    });
  }

  if (e.linkedin_company_url) {
    push("identity_match", "linkedin", e.linkedin_company_url, {
      structured_value: e.linkedin_company_url,
      source_url: e.linkedin_company_url,
      verification_state: e.identity_state === "resolved" ? "verified"
        : e.identity_state === "mismatch" ? "invalid" : "reported",
      metadata: { identity_state: e.identity_state },
    });
  }

  // ── DATED PUBLIC STATEMENTS. What proves an expansion or a launch.
  //
  // `published_at` is what makes an article evidence rather than a headline,
  // and it is also the observation date — an expansion announced in June was
  // announced in June however recently we read about it. An undated item never
  // reaches here: `normalizeNewsArticle` marks it `is_evidence: false` and the
  // capability drops it.
  for (const [kind, articles] of [
    ["expansion_signal", i.expansion_evidence ?? []] as const,
    ["launch_signal", i.launch_evidence ?? []] as const,
  ]) {
    for (const a of articles) {
      if (!a.url || !a.published_at) continue;
      push(kind as EvidenceType, a.source ?? "news", `${a.title ?? ""}|${a.url}`, {
        structured_value: {
          title: a.title, url: a.url, source: a.source, published_at: a.published_at,
        },
        source_text: a.title ?? a.description ?? null,
        source_url: a.url,
        observed_at: a.published_at,
        freshness: freshnessOf(a.published_at, now),
        // A PUBLISHER SAID IT, which is a source-backed report and not a
        // verification we performed. `reported` is the honest state.
        verification_state: "reported",
        metadata: { description: a.description ?? null },
      });
    }
  }

  // ── THE FUNDING ROUND. The ONLY thing that may prove a funding signal.
  //
  // `announced_date` is what makes it evidence rather than a claim, and it is
  // also the observation date — a round announced in March was announced in
  // March however recently we read about it. The source articles are the
  // citation; a round with none is still recorded, because the provider
  // asserting a dated round is itself weaker evidence, not no evidence, and
  // `freshnessOf` will say how old it is.
  const round = i.funding_round;
  if (round && round.announced_date) {
    push("funding_signal", "datahyena",
      `${round.round_stage ?? "round"}|${round.announced_date}`, {
      structured_value: {
        round_stage: round.round_stage,
        amount_usd: round.amount_usd,
        currency: round.currency,
        announced_date: round.announced_date,
        investors: [...round.investors],
      },
      source_text: [
        round.round_stage, round.amount_usd != null ? `${round.amount_usd} ${round.currency ?? "USD"}` : null,
        `announced ${round.announced_date}`,
        round.investors.length ? `investors: ${round.investors.join(", ")}` : null,
      ].filter(Boolean).join(" · "),
      source_url: round.source_articles[0] ?? null,
      observed_at: round.announced_date,
      freshness: freshnessOf(round.announced_date, now),
      verification_state: "verified",
      metadata: { source_articles: [...round.source_articles] },
    });
  }

  // ── JOBS. The ONLY thing that may prove a current commercial signal.
  const jobs = i.jobs ?? [];
  for (const j of jobs) {
    const title = clean(j.title);
    if (!title) continue;
    const isYc = j.source?.includes("yc") || j.source?.includes("memo23");
    push(isYc ? "yc_job" : "job_posting", j.source ?? "job", `${title}|${j.job_url ?? ""}`, {
      structured_value: {
        title, url: j.job_url, location: j.location, posted_date: j.posted_date,
      },
      source_text: title,
      source_url: j.job_url,
      observed_at: j.posted_date,
      // A POSTING WITH NO DATE IS `unknown`, NEVER `current`. "We think they are
      // hiring now" and "they were hiring at some point" are different claims,
      // and only one of them justifies contacting someone today.
      freshness: freshnessOf(j.posted_date, now),
      verification_state: "verified",
      metadata: { company_linkedin_url: j.company_linkedin_url },
    });
  }

  // ── FAILURES. Recorded as failures. Never as an absence of the thing sought.
  for (const f of i.provider_failures ?? []) {
    push("provider_failure", f.provider, `${f.capability}|${f.reason}`, {
      structured_value: { capability: f.capability, reason: f.reason },
      source_text: f.reason,
      verification_state: "invalid",
      metadata: {
        capability: f.capability,
        // Read by the verifier. A failure can never support a claim about the
        // world; it can only support "this is unresolved".
        supports_negative_claim: false,
      },
    });
  }

  for (const c of e.conflicting_evidence) {
    push("other", "conflict", c, {
      source_text: c, verification_state: "conflicting",
      metadata: { kind: "conflict_note" },
    });
  }

  return {
    version: EVIDENCE_REGISTRY_VERSION,
    company_key: key,
    items,
    hard_facts: {
      company_key: key,
      company_name: e.company_name,
      domain: e.domain,
      linkedin_company_url: e.linkedin_company_url,
      identity_state: e.identity_state,
      company_size_band: e.size_band_evidence,
      linkedin_associated_member_count: e.linkedin_member_count_evidence,
      employee_range_advisory: null,
      geography: e.geography_evidence,
      job_titles: jobs.map((j) => clean(j.title)).filter((t): t is string => !!t),
      job_urls: jobs.map((j) => j.job_url).filter((u): u is string => !!u),
      posting_dates: jobs.map((j) => j.posted_date).filter((d): d is string => !!d),
      provider_failed: (i.provider_failures ?? []).length > 0,
      provider_failures: (i.provider_failures ?? []).map((f) => `${f.capability}:${f.provider}`),
    },
  };
}

/**
 * Hard facts as the model receives them.
 *
 * `provider_failures` is stored internally as `capability:actor_key`, because
 * an operator debugging an outage needs to know which Actor failed. The model
 * needs to know only THAT something failed — naming the vendor gives it a
 * provider word to put in a claim and tells it nothing it can use.
 */
export function hardFactsForPrompt(f: HardFacts): Record<string, unknown> {
  return {
    ...f,
    provider_failures: f.provider_failures.map((s) => {
      const [capability] = String(s).split(":");
      return `${capability}:unavailable`;
    }),
  };
}

/** Look one up. Returns null rather than throwing — a miss is a finding. */
export function findEvidence(
  registry: EvidenceRegistry, id: string,
): EvidenceItem | null {
  return registry.items.find((x) => x.evidence_id === id) ?? null;
}

/**
 * The registry as the classifier receives it.
 *
 * Source text is included — the model must be able to quote it — but nothing
 * here is a place to put a provider credential, an Actor id or an instruction.
 * It is a list of facts with names.
 */
/**
 * A registry with no evidence in it.
 *
 * For callers that need the MISSION-shaped half of an evaluator input and have
 * no company in hand — the re-evaluation context is built once per run, before
 * any company is chosen, and only the `company` half of that input depends on a
 * registry. That half is replaced from the real registry when the second look
 * actually happens.
 *
 * Not a stand-in for a real registry anywhere a verdict is decided: it cites
 * nothing, so any claim checked against it is dropped.
 */
export function emptyEvidenceRegistry(companyKey: string): EvidenceRegistry {
  return {
    version: EVIDENCE_REGISTRY_VERSION,
    company_key: companyKey,
    items: [],
    hard_facts: {
      company_key: companyKey,
      company_name: null,
      domain: null,
      linkedin_company_url: null,
      identity_state: "unresolved",
      company_size_band: null,
      linkedin_associated_member_count: null,
      employee_range_advisory: null,
      geography: null,
      job_titles: [],
      job_urls: [],
      posting_dates: [],
      provider_failed: false,
      provider_failures: [],
    },
  };
}

export function registryForPrompt(r: EvidenceRegistry): Array<Record<string, unknown>> {
  return r.items.map((x) => ({
    evidence_id: x.evidence_id,
    evidence_type: x.evidence_type,
    // ABSTRACTED HERE, not at each call site. The single-company payload
    // abstracted it and this one did not, so the batch path shipped
    // `harvestapi/linkedin-job-search` to the model inside every job item —
    // reintroducing the provider vocabulary the compiler stage removes, and
    // offering a vendor name as something a claim could cite as proof.
    source: abstractSourceLabel(x.source),
    source_text: x.source_text,
    structured_value: x.structured_value,
    observed_at: x.observed_at,
    freshness: x.freshness,
    verification_state: x.verification_state,
    // ── WHICH PAGE THIS IS ──────────────────────────────────────────────
    //
    // Five `web_page` items were indistinguishable here: same type, same
    // abstracted source, differing only in `source_text`. A model that wanted
    // to cite a quote had to guess which id it came from, and the Metaview
    // canary caught it doing exactly that — it quoted the homepage tagline
    // and cited the PRICING page's id. The verifier dropped it, correctly,
    // and the requirement stayed unresolved on a claim that was true.
    //
    // Conditional, so nothing else in the projection changes: only `web_page`
    // items carry `page_intent`, so only they gain these two fields. The URL
    // travels with it because "which page" and "where it lives" are the same
    // question for a web page, and a citation a reviewer cannot locate is not
    // much of a receipt.
    ...(x.metadata && typeof x.metadata.page_intent === "string"
      ? { page_intent: x.metadata.page_intent, source_url: x.source_url }
      : {}),
  }));
}

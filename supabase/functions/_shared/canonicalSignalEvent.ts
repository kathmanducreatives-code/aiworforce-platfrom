// PHASE 8 — ONE FACT, ONE EVENT, WHOEVER FOUND IT.
//
// ── THE THING THAT MADE CROSS-SURFACE DEDUPE IMPOSSIBLE ─────────────────────
//
// Every dedupe key in the store was namespaced by the surface that wrote it:
// `radar|competitor:outreach|…` and `monitor|company|eulerhq-com|recent_funding`.
// So "Vercel is hiring" found by a Lead mission and the same fact found by a
// monitor produced two keys, and therefore two events, about one fact.
//
// That prefix is ROUTING LOGIC INSIDE AN IDENTITY. Origin is provenance — it
// says who found something — and it has no business deciding whether two
// findings are the same finding. The canonical key is the QUESTION:
//
//     subject_type · subject_key · signal_type
//
// A Lead mission and a monitor asking that question about the same company get
// the same key, so the second write deduplicates instead of duplicating. Which
// origin the surviving row carries is simply whoever asked first, and the
// evidence trail records the rest.
//
// ── WHY MARKET AND COMPETITOR CONTENT KEEP A NARROWER KEY ───────────────────
//
// A company-level signal is ONE FACT: a company is hiring, or it is not. A
// market conversation is an ITEM: two articles about the same competitor are
// two things that were said, and collapsing them would delete one. So those
// carry their source URL as well, and `radarSignalToV2` still builds them —
// this module owns the per-fact keys only, and says so rather than pretending
// one shape fits both.
//
// PURE. No network, provider, model or database access.

export const CANONICAL_SIGNAL_EVENT_VERSION = "canonical-signal-event-v1" as const;

/**
 * The identity of a company-level signal, independent of who found it.
 *
 * NO ORIGIN, DELIBERATELY. Adding one would restore the exact defect this
 * replaces, and `canonicalDedupeKeyIsOriginFree` in the tests is what stops it
 * coming back.
 */
export function canonicalDedupeKey(
  subject_type: string, subject_key: string, signal_type: string,
): string {
  return `${subject_type}|${subject_key}|${signal_type}`;
}

/** Which canonical type a mission signal produces, and its category. */
export const CANONICAL_TYPE_FOR: Readonly<
  Record<string, { type: string; category: string }>
> = Object.freeze({
  hiring: { type: "sales_hiring", category: "gtm" },
  funding: { type: "recent_funding", category: "growth" },
  expansion: { type: "market_expansion", category: "growth" },
  product_launch: { type: "product_launch", category: "product" },
  headcount_change: { type: "employee_growth", category: "growth" },
});

/** A signal assessment, as both the Lead engine and monitoring produce one. */
export interface AssessedSignal {
  signal: string;
  verdict: string;
  evidence_ids?: readonly string[];
  /** When the SOURCE says it happened, when any cited item carries a date. */
  occurred_at?: string | null;
}

export interface CanonicalSubject {
  subject_type: "company" | "competitor" | "market";
  subject_key: string;
  /**
   * The identifier this subject was named by, before canonicalisation.
   *
   * ── WHY THE SLUG IS NOT ENOUGH ────────────────────────────────────────────
   *
   * `subject_key` is a slug: `acme-com`, `linkedin-com-company-vercel`. It is
   * an identity for COMPARING two events and is lossy for ACTING on one —
   * turning `acme-com` back into `acme.com` is a guess, and a wrong guess opens
   * a Lead investigation into the wrong company.
   *
   * So the real identifier travels with the event: the domain or the LinkedIn
   * URL the subject was actually named by. "Open in Leads" uses this or it
   * refuses, and never reverses a slug.
   */
  subject_identifier?: string | null;
  /** Set only when the surface has a real account. Never invented. */
  account_id?: string | null;
  /** Set only when this signal is about a company already in the Workbench. */
  lead_candidate_id?: string | null;
}

export interface ProjectionInput {
  workspace_id: string;
  /** Who found it. Provenance only — it never reaches the dedupe key. */
  origin: string;
  subject: CanonicalSubject;
  company_name?: string | null;
  assessments: readonly AssessedSignal[];
}

/** A canonical event input, ready for `writeSignalEventV2`. */
export interface CanonicalEventInput extends Record<string, unknown> {
  workspace_id: string;
  origin: string;
  signal_type: string;
  signal_category: string;
  occurred_at: string | null;
  occurred_at_basis: "source_reported" | "unknown";
  subject_type: string;
  subject_key: string;
  account_id: string | null;
  lead_candidate_id: string | null;
  dedupe_key: string;
  verification_status: string;
  lifecycle_status: string;
  normalized_value: Record<string, unknown>;
}

/**
 * A source date we are willing to write as an occurrence.
 *
 * Parseable, and not in the future. A provider reporting tomorrow is reporting
 * a mistake, and writing it would make an event look fresher than anything that
 * has happened.
 */
export function validSourceDate(v: unknown, now: number = Date.now()): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return null;
  if (t > now + 86_400_000) return null;
  return new Date(t).toISOString();
}

/**
 * Turn one company's evidenced signals into canonical events.
 *
 * ── WHAT IT REFUSES ─────────────────────────────────────────────────────────
 *
 * A verdict that is not `verified` or `plausible` produces nothing: the
 * assessment layer already decided what the evidence supports, and this is not
 * a second opinion on it.
 *
 * A signal with no canonical type produces nothing either, and is not mapped to
 * an approximation — a signal filed under the wrong type is worse than a signal
 * nobody wrote.
 *
 * ── WHAT IT DOES NOT DECIDE ─────────────────────────────────────────────────
 *
 * WHO is eligible. Monitoring admits a named subject on evidence alone and a
 * discovered one only if it qualifies; the Lead path admits a qualified lead.
 * Those gates belong to the surfaces, which know what they asked for. This owns
 * the projection, so both surfaces produce the same row for the same fact.
 */
export function projectCanonicalEvents(
  input: ProjectionInput, now: number = Date.now(),
): CanonicalEventInput[] {
  const out: CanonicalEventInput[] = [];
  const { subject } = input;
  if (!subject.subject_key) return out;

  for (const a of input.assessments ?? []) {
    if (a.verdict !== "verified" && a.verdict !== "plausible") continue;
    const event = a.signal.split("/")[0];
    const canon = CANONICAL_TYPE_FOR[event];
    if (!canon) continue;

    const sourceDate = validSourceDate(a.occurred_at, now);
    out.push({
      workspace_id: input.workspace_id,
      origin: input.origin,
      signal_type: canon.type,
      signal_category: canon.category,
      // The source's own date when the evidence carries one; null otherwise,
      // and the basis follows it. Nothing acquires a time from the moment we
      // happened to look.
      ...(sourceDate
        ? { occurred_at: sourceDate, occurred_at_basis: "source_reported" as const }
        : { occurred_at: null, occurred_at_basis: "unknown" as const }),
      subject_type: subject.subject_type,
      subject_key: subject.subject_key,
      account_id: subject.account_id ?? null,
      lead_candidate_id: subject.lead_candidate_id ?? null,
      dedupe_key: canonicalDedupeKey(
        subject.subject_type, subject.subject_key, canon.type),
      verification_status: "unverified",
      lifecycle_status: "active",
      normalized_value: {
        company_name: input.company_name ?? null,
        signal: a.signal,
        verdict: a.verdict,
        // PROVENANCE TRAVELS IN THE PAYLOAD, not in the identity. A reader can
        // still see which surface found this; the dedupe key cannot.
        found_by: input.origin,
        // THE HANDLE FOR ACTING ON THIS LATER. See `subject_identifier`.
        subject_identifier: subject.subject_identifier ?? null,
        evidence_ids: [...(a.evidence_ids ?? [])],
      },
    });
  }
  return out;
}

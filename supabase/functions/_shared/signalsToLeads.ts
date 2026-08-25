// PHASE 8 — SIGNALS → LEADS, WITHOUT A SECOND SOURCING SYSTEM.
//
// ── WHAT AN ACTION FROM A SITUATION IS ──────────────────────────────────────
//
// A Lead mission that NAMES the company. Nothing more. Phase 3 built the
// supplied-company path — `known_companies` → `known_company_resolution` →
// the same identity, enrichment and qualification every other mission uses —
// and a situation is exactly a company worth naming.
//
// So this module compiles no mission, runs no engine and buys nothing. It
// answers one question: CAN this situation safely become a Lead investigation,
// and with which identifier. The Lead path does the rest, unchanged.
//
// ── IDENTITY IS THE WHOLE RISK ──────────────────────────────────────────────
//
// `subject_key` is a slug — `acme-com`, `linkedin-com-company-vercel`. It is an
// identity for COMPARING two events and is lossy for ACTING on one: turning
// `acme-com` back into `acme.com` is a guess, and a wrong guess opens an
// investigation into a different company and attaches its people to this one.
//
// So a slug is never reversed. The identifier comes from the event's own
// payload, where the writer put what the subject was actually named by — or the
// action is refused, with the reason said out loud.
//
// ── WHAT IT NEVER DOES ──────────────────────────────────────────────────────
//
// It does not create a lead candidate, an account or a contact; a situation is
// not a lead until an investigation concludes one. It does not ask for people:
// decision-maker work is a separate, explicitly-priced action, and a strong
// signal is not consent to buy contacts.
//
// PURE. No network, provider, model or database access.

import type { SignalCluster } from "./signalCluster.ts";
import {
  preflight, type ExistingEvidence, type PreflightDecision,
} from "./monitoringPreflight.ts";

export const SIGNALS_TO_LEADS_VERSION = "signals-to-leads-v1" as const;

/** What a user may do with a situation. */
export const SITUATION_ACTIONS = [
  /** Compile a Lead mission naming this company. Costs provider work. */
  "investigate_company",
  /** Add it to the monitoring subject store. Costs nothing now. */
  "track_company",
  /**
   * Find decision-makers. SEPARATE and EXPLICIT.
   *
   * Never bundled into `investigate_company`: a signal being strong is not a
   * decision to buy contacts, and the person path is unlock-gated for that
   * exact reason.
   */
  "find_decision_makers",
] as const;
export type SituationAction = typeof SITUATION_ACTIONS[number];

export type RefusalReason =
  /** The subject names no company — a market theme is not investigable. */
  | "not_a_company_subject"
  /** No event carries an identifier, and a slug is not one. */
  | "no_safe_identifier";

export interface OpenInLeadsDecision {
  version: typeof SIGNALS_TO_LEADS_VERSION;
  ok: boolean;
  /** The identifier a Lead mission would name. Null when refused. */
  known_company: string | null;
  /** Where it came from, so a reader can judge it. */
  identifier_source: "account" | "event_payload" | null;
  /** The account this situation is already about, when it has one. */
  account_id: string | null;
  reason: string;
  refusal: RefusalReason | null;
}

const refuse = (
  refusal: RefusalReason, reason: string,
): OpenInLeadsDecision => ({
  version: SIGNALS_TO_LEADS_VERSION,
  ok: false, known_company: null, identifier_source: null, account_id: null,
  reason, refusal,
});

/** A usable identifier is a domain or a LinkedIn company URL. Never a name. */
export function isSafeIdentifier(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const s = v.trim().toLowerCase();
  if (!s) return false;
  if (/^https?:\/\/(www\.)?linkedin\.com\/company\//.test(s)) return true;
  // A bare domain: at least one dot, no spaces, and a plausible TLD.
  return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(s) && !s.includes(" ");
}

/**
 * Can this situation be opened as a Lead investigation?
 *
 * Reads the cluster's own events for the identifier the writer recorded. A
 * situation the store cannot safely identify is REFUSED and says so — which is
 * more useful than an investigation into a company nobody meant.
 */
export function openInLeads(cluster: SignalCluster): OpenInLeadsDecision {
  // A MARKET THEME IS NOT A COMPANY. "buyer-intent" names a conversation, and
  // there is nothing to investigate.
  if (cluster.subject_type === "market") {
    return refuse(
      "not_a_company_subject",
      "this situation is about a market conversation, not a company, so there " +
      "is no company to investigate",
    );
  }

  // AN ACCOUNT IS THE STRONGEST IDENTITY the system has, and needs no
  // identifier at all — the Lead path already knows this company.
  if (cluster.account_id) {
    return {
      version: SIGNALS_TO_LEADS_VERSION,
      ok: true, known_company: null, identifier_source: "account",
      account_id: cluster.account_id,
      reason: "this situation is already about a known account",
      refusal: null,
    };
  }

  // THE IDENTIFIER THE WRITER RECORDED. Never the slug, and never the name.
  for (const e of cluster.events) {
    const nv = (e as { normalized_value?: Record<string, unknown> }).normalized_value;
    const id = nv?.subject_identifier;
    if (isSafeIdentifier(id)) {
      return {
        version: SIGNALS_TO_LEADS_VERSION,
        ok: true, known_company: String(id).trim(), identifier_source: "event_payload",
        account_id: null,
        reason: `this company can be named by ${String(id).trim()}`,
        refusal: null,
      };
    }
  }

  return refuse(
    "no_safe_identifier",
    `no event in this situation records a domain or LinkedIn URL for ` +
    `"${cluster.subject_key}". The subject key is a slug and reversing one is a ` +
    `guess, so a Lead investigation could open on the wrong company`,
  );
}

/**
 * The mission fields an "investigate this company" action produces.
 *
 * DELIBERATELY TINY. It supplies `known_companies` and the signals the
 * situation showed, and nothing else — the compiler, the graph and the engine
 * are the same ones every Lead mission uses, which is what stops this becoming
 * a second sourcing system.
 *
 * ── AND IT ASKS ONLY FOR WHAT IS NOT ALREADY KNOWN ──────────────────────────
 *
 * The whole point of one canonical store is that a fact proved once is not
 * bought twice. Before this mission is compiled, every signal it would ask for
 * goes through the SAME pre-flight monitoring uses — the one that reuses fresh
 * dated evidence whatever origin produced it, and refuses to let an undated or
 * stale fact suppress an investigation.
 *
 * A signal already answered is dropped from the mission, so the engine never
 * schedules a capability to re-prove it. A mission left with nothing to ask is
 * refused: there is no research to do, and running one would pay for identity
 * and enrichment to confirm what is already held.
 */
export interface InvestigateFields {
  known_companies: string[];
  required_signals: string[];
  /** Signals dropped because held evidence already answers them, with why. */
  reused: Array<{ signal: string; reason: string; origin: string | null }>;
  /** Null when there is still something to investigate. */
  refusal: "everything_already_known" | null;
}

/** The mission signal event a canonical type came from. Reverse of the map. */
const EVENT_FOR_CANONICAL: Readonly<Record<string, string>> = Object.freeze({
  sales_hiring: "hiring", revops_hiring: "hiring", growth_hiring: "hiring",
  recent_funding: "funding",
  market_expansion: "expansion", geographic_expansion: "expansion",
  product_launch: "product_launch", major_release: "product_launch",
  new_integration: "product_launch", category_expansion: "product_launch",
  employee_growth: "headcount_change",
});

export function investigateMissionFields(
  cluster: SignalCluster,
  decision: OpenInLeadsDecision,
  held: readonly ExistingEvidence[] = [],
  now: number = Date.now(),
  timeframe_days: number | null = 30,
): InvestigateFields | null {
  if (!decision.ok || !decision.known_company) return null;

  const asked = [...new Set(
    cluster.signal_types.map((t) => EVENT_FOR_CANONICAL[t]).filter(Boolean),
  )];

  const required: string[] = [];
  const reused: InvestigateFields["reused"] = [];
  for (const event of asked) {
    // THE SAME PRE-FLIGHT, ASKED THE SAME WAY. Nothing here knows or cares
    // which surface proved the evidence it is reading.
    const d: PreflightDecision = preflight({
      subject_type: cluster.subject_type === "competitor" ? "competitor" : "company",
      subject_key: cluster.subject_key,
      event,
      subject: "company",
      timeframe_days,
    }, held, now);
    if (d.verdict === "reuse") {
      reused.push({ signal: event, reason: d.reason, origin: d.reused_from_origin });
    } else {
      required.push(event);
    }
  }

  return {
    known_companies: [decision.known_company],
    required_signals: required,
    reused,
    // NOTHING LEFT TO ASK IS NOT A MISSION. Running one would pay for identity
    // and enrichment to confirm what is already held.
    refusal: required.length === 0 && reused.length > 0
      ? "everything_already_known"
      : null,
  };
}

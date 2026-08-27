// WHAT THE USER WAS SHOWN, RECORDED SO A FOLLOW-UP CAN POINT AT IT.
//
// ── WHY THE TRANSCRIPT IS NOT THE SOURCE OF TRUTH ──────────────────────────
//
// "The second company" means the second thing the user SAW. Recovering that
// from the assistant's prose means parsing the very text a model wrote, which
// makes the identity of an investigated company depend on how a sentence was
// phrased — and a re-render, a truncation or a reworded template silently moves
// which company "the second" is. So the entities are persisted STRUCTURALLY, on
// the same message that displayed them, in the order they were displayed.
//
// ── WHY ORDER IS PART OF THE RECORD ────────────────────────────────────────
//
// The database order is not the display order and never was: results are
// filtered, sliced and sorted for presentation. "The second company" is a
// position in what was rendered, not the second row of a later query, and those
// two diverge the moment anything is added to the table. `position` is
// therefore stored, and the array is stored in that order — one ordering, not
// two that can disagree.
//
// ── WHY A BROKEN ENTRY IS KEPT, NOT DROPPED ────────────────────────────────
//
// An entity carrying nothing identifiable stays in the list, holding its
// position. Dropping it would renumber everything after it, so "the second
// company" would resolve to what the user saw as the third — acting on a
// company they did not point at, which is the exact failure the binding model
// exists to prevent. It is kept, it fails to bind at resolution time, and the
// user is asked. A gap is honest; a silent shift is not.
//
// ── AND WHY NO IDENTITY IS TRUSTED FROM STORAGE ────────────────────────────
//
// `entity_key` is written for audit and never read back as an authority.
// `resolveReferents` recomputes identity from the raw fields with
// `resolveCompanyIdentity`, the same deterministic function the rest of the
// pipeline uses, so there is ONE answer to "is this the same company" rather
// than a stored one that can drift from the live one.
//
// Pure. No network, no database, no model.

import { resolveCompanyIdentity, type CompanyIdentity } from "./companyIdentity.ts";
import type { PriorResultEntity, ReferentSource } from "./referentBinding.ts";
import type { RequestV1 } from "./requestV1.ts";

export const PRESENTED_REFERENTS_VERSION = "presented-referents-v1" as const;

/** The metadata key on `messages.metadata`. One column, already there. */
export const PRESENTED_REFERENTS_KEY = "presented_referents" as const;

/**
 * Which surface displayed the set.
 *
 * Recorded so a resolution can be audited back to the surface that produced it,
 * and so a future surface is a new value here rather than a new shape.
 */
export type PresentedKind =
  /** A lead run's results, as opened in Workbench. */
  | "lead_results"
  /** The companies a workspace is watching, listed by the read surface. */
  | "watched_companies";

/** One entity, exactly as the user saw it. */
export interface PresentedReferent {
  /** 1-based, in display order. THE position "the second company" indexes. */
  position: number;
  /**
   * Only `company` today. `resolveReferents` binds companies and nothing else,
   * so persisting a person would record a referent nothing can resolve — a
   * promise the resolver does not keep.
   */
  entity_type: "company";
  /** What was displayed. Never used as an identifier. */
  label: string;
  name: string | null;
  domain: string | null;
  website_url: string | null;
  linkedin_url: string | null;
  location: string | null;
  /**
   * AUDIT ONLY, NEVER AN AUTHORITY. Written so a stored set can be compared
   * against what the resolver later derives; `toReferentSource` does not carry
   * it, and no binding is ever built from it.
   */
  entity_key: string | null;
  entity_key_kind: CompanyIdentity["dedupeKeyKind"];
}

export interface PresentedReferentSet {
  version: typeof PRESENTED_REFERENTS_VERSION;
  kind: PresentedKind;
  presented_at: string;
  /** In display order. Index 0 is what the user saw first. */
  entities: PresentedReferent[];
}

/** What a surface hands in — whatever it displayed, in the order it displayed it. */
export interface PresentedEntityInput {
  label?: string | null;
  name?: string | null;
  domain?: string | null;
  website_url?: string | null;
  linkedin_url?: string | null;
  location?: string | null;
}

const str = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : null;
};

/**
 * Build the record for one presented set.
 *
 * TOTAL AND ORDER-PRESERVING. Every input produces exactly one entry at its own
 * position, including one carrying nothing identifiable — see the header.
 */
export function buildPresentedReferents(
  entities: readonly PresentedEntityInput[],
  kind: PresentedKind,
  now: () => Date = () => new Date(),
): PresentedReferentSet {
  return {
    version: PRESENTED_REFERENTS_VERSION,
    kind,
    presented_at: now().toISOString(),
    entities: entities.map((e, i) => {
      const name = str(e.name) ?? str(e.label);
      const identity = resolveCompanyIdentity({
        name,
        domain: str(e.domain),
        website_url: str(e.website_url),
        linkedin_url: str(e.linkedin_url),
        location: str(e.location),
      });
      return {
        position: i + 1,
        entity_type: "company" as const,
        // An unlabelled row is still a row the user counted past. It keeps its
        // position and fails to bind, rather than renumbering the list.
        label: str(e.label) ?? name ?? "",
        name,
        domain: str(e.domain),
        website_url: str(e.website_url),
        linkedin_url: str(e.linkedin_url),
        location: str(e.location),
        entity_key: identity.dedupeKey,
        entity_key_kind: identity.dedupeKeyKind,
      };
    }),
  };
}

/**
 * Read a stored set back, or null.
 *
 * STRICT ABOUT SHAPE, FORGIVING ABOUT CONTENT. A metadata blob written by
 * another surface, an older version, or nothing at all yields null and the
 * caller behaves as if no results were ever shown — which is a clarification,
 * not a guess. Individual entries are normalised rather than rejected, so one
 * malformed row costs its own binding and not the whole set's positions.
 */
export function readPresentedReferents(
  metadata: unknown,
): PresentedReferentSet | null {
  if (!metadata || typeof metadata !== "object") return null;
  const raw = (metadata as Record<string, unknown>)[PRESENTED_REFERENTS_KEY];
  if (!raw || typeof raw !== "object") return null;
  const set = raw as Record<string, unknown>;
  if (set.version !== PRESENTED_REFERENTS_VERSION) return null;
  if (!Array.isArray(set.entities)) return null;

  const entities: PresentedReferent[] = set.entities.map((e, i) => {
    const o = (e && typeof e === "object" ? e : {}) as Record<string, unknown>;
    return {
      // THE STORED POSITION WINS. Re-deriving it from the array index would
      // silently repair a set that lost an entry, and a repaired list is one
      // where "the second" points somewhere the user never looked.
      position: typeof o.position === "number" && o.position > 0 ? o.position : i + 1,
      entity_type: "company",
      label: str(o.label) ?? "",
      name: str(o.name),
      domain: str(o.domain),
      website_url: str(o.website_url),
      linkedin_url: str(o.linkedin_url),
      location: str(o.location),
      entity_key: str(o.entity_key),
      entity_key_kind:
        (typeof o.entity_key_kind === "string"
          ? o.entity_key_kind
          : "none") as CompanyIdentity["dedupeKeyKind"],
    };
  });

  return {
    version: PRESENTED_REFERENTS_VERSION,
    kind: (set.kind === "watched_companies" ? "watched_companies" : "lead_results"),
    presented_at: str(set.presented_at) ?? "",
    entities,
  };
}

/**
 * Turn a stored set into the resolver's input.
 *
 * ORDER IS CARRIED, IDENTITY IS NOT. The array is sorted by the position the
 * user saw so `resolveReferents`' ordinal lookup indexes the display; the
 * stored `entity_key` is deliberately left behind so identity is recomputed
 * rather than trusted.
 */
export function toReferentSource(
  set: PresentedReferentSet | null, messageId: string | null,
): ReferentSource | null {
  if (!set || set.entities.length === 0) return null;
  const ordered = [...set.entities].sort((a, b) => a.position - b.position);
  const entities: PriorResultEntity[] = ordered.map((e) => ({
    label: e.label,
    name: e.name,
    domain: e.domain,
    website_url: e.website_url,
    linkedin_url: e.linkedin_url,
    location: e.location,
  }));
  return { message_id: messageId, entities };
}

/**
 * Does this request point BACKWARD at all?
 *
 * The cheap guard that keeps the resolver — and the query that feeds it — off
 * every message that names its own subject. A request with no backward
 * reference has nothing to resolve, and loading prior results for it would be
 * a read per turn for an answer nobody uses.
 */
export function requestHasBackReference(request: RequestV1): boolean {
  return request.parts.some((p) =>
    (p.subject.references ?? []).some(
      (r) => r.kind === "prior_result" || r.kind === "saved_set"));
}

/**
 * One entity from a bare identifier string — a domain, or a LinkedIn company URL.
 *
 * WHAT `monitoring_subjects.identifier` HOLDS. The column's own comment says
 * "Domain or LinkedIn company URL", and the display carries only that plus a
 * label, so the classification has to happen somewhere.
 *
 * IT HAPPENS IN `resolveCompanyIdentity`, NOT HERE. The identifier is offered to
 * both slots and the resolver's own precedence decides which one it is —
 * `parseDomain` claims a hostname, and `canonicalLinkedinCompany` claims only a
 * real `/company/` URL while `canonicalDomain` explicitly rejects a linkedin.com
 * host. Writing a second classifier beside it would give two answers to "is this
 * a domain", and the fields below are then filled from what the ONE resolver
 * concluded rather than from a guess made before calling it.
 */
export function presentedFromIdentifier(
  label: string | null | undefined, identifier: string | null | undefined,
): PresentedEntityInput {
  const id = str(identifier);
  const name = str(label);
  if (!id) return { label: name, name };
  const identity = resolveCompanyIdentity({
    name, domain: null, website_url: id, linkedin_url: id, location: null,
  });
  return {
    // ── A LABEL IS A NAME, AND A URL IS NOT ONE ──────────────────────────
    //
    // With no label the raw identifier was used, so an unlabelled LinkedIn
    // subject carried `https://www.linkedin.com/company/vercel` as its display
    // name — and the projection then had to refuse it, leaving the mission to
    // fall back to the pronoun the user actually typed. The domain, or the
    // LinkedIn slug, is a name a person recognises and a name the pipeline can
    // carry.
    label: name ?? identity.canonicalDomain ?? identity.linkedinCompanyId ?? id,
    name,
    domain: identity.canonicalDomain,
    website_url: identity.canonicalDomain ? id : null,
    linkedin_url: identity.linkedinUrl,
  };
}

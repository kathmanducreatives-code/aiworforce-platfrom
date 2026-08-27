// WHICH REAL ENTITY "THEM" MEANT — RESOLVED BY CODE, CARRIED BESIDE THE MISSION.
//
// ── WHY A SIDECAR AND NOT A MISSION FIELD ──────────────────────────────────
//
// The obvious move is to put the resolved LinkedIn URL into the mission's
// `known_companies` and let the pipeline use it. That is fatal, and measurably
// so: `scanProposalForViolations` refuses ANY url anywhere in a proposal — the
// same scan that blocks actor references and vendor names — and compiling one
// raises `url:known_companies[0]`. Weakening that gate to admit "our own" URLs
// would remove the property that stops a model naming a provider.
//
// Mutating `LeadMissionV1` after compilation is equally wrong: the mission is
// the compiler's output and `missionHash` is computed from it, so a
// post-compile edit either silently changes checkpoint identity or, worse,
// does not — leaving a mission whose hash describes a different question than
// its contents.
//
// So identity travels ALONGSIDE. The mission carries the safe semantic label
// ("Vercel"), which is what `known_company_resolution` already expects and what
// keeps its entry semantics intact. The exact identity travels here, where no
// safety gate has to be relaxed and no compiled object has to be rewritten.
//
// ── AND WHY GPT CANNOT TOUCH IT ────────────────────────────────────────────
//
// A binding decides which real company gets investigated, monitored or
// contacted. Every field below is produced by `resolveReferents` from records
// the system itself wrote — prior results, message metadata — using
// `resolveCompanyIdentity`, the same deterministic function the rest of the
// pipeline uses. Chat Brain says a reference EXISTS ("them"); it never says
// what it resolves to.
//
// Pure. No network, no database, no model.

import {
  resolveCompanyIdentity, type CompanyIdentity,
} from "./companyIdentity.ts";
import type { IdentityStatus } from "./companyIdentityResolution.ts";
// The SAME hash helpers `missionHash` uses, so the two fingerprints are
// computed the same way and can be compared and reasoned about together.
import { sha256Hex, canonicalJson } from "./planHash.ts";
import type { RequestV1, RequestPart } from "./requestV1.ts";

export const REFERENT_BINDING_VERSION = "referent-binding-v1" as const;

/**
 * One resolved referent.
 *
 * `identity` is the EXISTING `CompanyIdentity` — name, normalized name,
 * canonical domain, LinkedIn URL and slug, plus the `dedupeKey`/`dedupeKeyKind`
 * pair that already ranks those identifiers (domain > linkedin id > linkedin
 * url > name+location). Re-modelling company identity here would create a
 * second answer to "is this the same company" that drifts from the first.
 */
export interface ResolvedReferentBinding {
  version: typeof REFERENT_BINDING_VERSION;
  /** Which part of the request this binds. */
  part_id: string;
  entity_type: "company";
  /** The canonical internal key — `CompanyIdentity.dedupeKey`. */
  entity_key: string;
  /** What to call it in a preview or a reply. Never used as an identifier. */
  label: string;
  identity: CompanyIdentity;
  /** Where the referent came from, so a resolution can be audited. */
  source: {
    message_id: string | null;
    result_index: number | null;
    kind: "prior_result" | "saved_set" | "named";
  };
  /** The existing vocabulary — `verified_match | ambiguous | mismatch | unresolved`. */
  status: IdentityStatus;
}

/** A prior result a follow-up can point at, as `pilot-chat` persists it. */
export interface PriorResultEntity {
  label: string;
  name?: string | null;
  domain?: string | null;
  website_url?: string | null;
  linkedin_url?: string | null;
  location?: string | null;
}

export interface ReferentSource {
  message_id: string | null;
  /** Oldest first within a message, as shown to the user. */
  entities: PriorResultEntity[];
}

export type ResolutionFailure =
  /** Nothing prior to point at. */
  | "no_prior_results"
  /** More than one candidate and nothing selects between them. */
  | "ambiguous_referent"
  /** An ordinal like "the second" that the prior results cannot satisfy. */
  | "ordinal_out_of_range"
  /** The referent named something no prior result matches. */
  | "unknown_referent"
  /** A prior entity carries nothing strong enough to act on. */
  | "unidentifiable_entity";

export interface ResolvedRequest {
  request: RequestV1;
  bindings: ResolvedReferentBinding[];
  /** Why a referent could not be bound. Empty when every one resolved. */
  failures: Array<{ part_id: string; reason: ResolutionFailure; question: string }>;
}

const ORDINALS: Readonly<Record<string, number>> = Object.freeze({
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
  "1st": 1, "2nd": 2, "3rd": 3, "4th": 4, "5th": 5,
});

/**
 * Does this reference point at something displayed EARLIER IN THIS CONVERSATION?
 *
 * ── WHY `saved_set` IS NOT ONE ─────────────────────────────────────────────
 *
 * This admitted `saved_set` too, and that single word broke ordinary use of the
 * product. `saved_set` means a DURABLE WORKSPACE COLLECTION — "my leads", "my
 * ICP", "the companies I'm targeting". Those live in the database and are
 * resolved by a surface against workspace rows. They are not chat referents,
 * and this resolver's only corpus is chat referents.
 *
 * So every "what leads do I have?" in a fresh conversation resolved against an
 * empty corpus, failed `no_prior_results`, and returned "I don't have an
 * earlier result to point back to — which company do you mean?" — a question
 * about a company, asked because the user said the word "my". Worse, the
 * failure returns BEFORE the router, so the read surface that could have
 * answered it was never reached.
 *
 * `kind` is Chat Brain's own classification and is trusted for THAT — it is a
 * judgement about language, which is the model's job. What the model never
 * decides is which record a reference resolves to, or which corpus is searched.
 */
const pointsBack = (kind: string) => kind === "prior_result";

/** Pick the entity an ordinal or a name selects, or say why none could be. */
function selectEntity(
  value: string, entities: readonly PriorResultEntity[],
): { entity: PriorResultEntity | null; reason: ResolutionFailure | null } {
  if (entities.length === 0) return { entity: null, reason: "no_prior_results" };

  // AN ORDINAL IS EXACT. "the second company" is a position in what the user
  // was shown, and getting it wrong acts on a company they did not point at.
  const words = value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  for (const w of words) {
    const n = ORDINALS[w];
    if (n) {
      return n <= entities.length
        ? { entity: entities[n - 1], reason: null }
        : { entity: null, reason: "ordinal_out_of_range" };
    }
  }

  // A NAME MATCHES EXACTLY OR NOT AT ALL. Nearest-name is how a follow-up ends
  // up investigating a company the user never mentioned; a miss must clarify.
  const norm = (s: string) => s.trim().toLowerCase();
  const named = entities.filter((e) =>
    norm(e.label) === norm(value) || norm(e.name ?? "") === norm(value));
  if (named.length === 1) return { entity: named[0], reason: null };
  if (named.length > 1) return { entity: null, reason: "ambiguous_referent" };

  // A BARE PRONOUN. One prior result is unambiguous; more than one is not, and
  // guessing which would spend against the wrong company.
  if (entities.length === 1) return { entity: entities[0], reason: null };
  return { entity: null, reason: "ambiguous_referent" };
}

/**
 * Bind every backward-pointing reference in a request.
 *
 * DETERMINISTIC AND TOTAL. Every reference either produces a binding or a
 * named failure; nothing is guessed and nothing is dropped.
 */
export function resolveReferents(
  request: RequestV1, source: ReferentSource | null,
): ResolvedRequest {
  const bindings: ResolvedReferentBinding[] = [];
  const failures: ResolvedRequest["failures"] = [];
  const entities = source?.entities ?? [];

  for (const part of request.parts as RequestPart[]) {
    for (const ref of part.subject.references ?? []) {
      if (!pointsBack(ref.kind)) continue;

      const { entity, reason } = selectEntity(ref.value, entities);
      if (!entity) {
        failures.push({
          part_id: part.id,
          reason: reason ?? "unknown_referent",
          question: reason === "no_prior_results"
            ? "I don't have an earlier result to point back to — which company do you mean?"
            : reason === "ordinal_out_of_range"
            ? `There aren't that many companies in the last result — which one did you mean?`
            : `I'm not sure which company "${ref.value}" refers to. Which one?`,
        });
        continue;
      }

      const identity = resolveCompanyIdentity({
        name: entity.name ?? entity.label,
        domain: entity.domain ?? null,
        website_url: entity.website_url ?? null,
        linkedin_url: entity.linkedin_url ?? null,
        location: entity.location ?? null,
      });

      // AN ENTITY WITH NO STRONG IDENTIFIER IS NOT ACTIONABLE. `name_location`
      // and `none` are the weak kinds: acting on them is acting on a name, and
      // a name is what `known_company_resolution` would have had to resolve
      // anyway. Binding one would claim a certainty we do not have.
      const WEAK: ReadonlySet<CompanyIdentity["dedupeKeyKind"]> =
        new Set(["none", "name_location"]);
      if (!identity.dedupeKey || WEAK.has(identity.dedupeKeyKind)) {
        failures.push({
          part_id: part.id, reason: "unidentifiable_entity",
          question: `I don't have enough to identify ${entity.label} exactly — can you give me its website or LinkedIn?`,
        });
        continue;
      }

      bindings.push({
        version: REFERENT_BINDING_VERSION,
        part_id: part.id,
        entity_type: "company",
        entity_key: identity.dedupeKey,
        label: entity.label,
        identity,
        source: {
          message_id: source?.message_id ?? null,
          result_index: entities.indexOf(entity),
          // Only `prior_result` reaches here now; a saved set is never bound
          // from chat referents. The union keeps `saved_set` for a future
          // surface-side binding, which would carry a different provenance.
          kind: "prior_result",
        },
        // A weak dedupe kind never reaches here, so anything bound is a match
        // on domain, LinkedIn id or LinkedIn URL.
        status: "verified_match",
      });
    }
  }

  return { request, bindings, failures };
}

/**
 * A DETERMINISTIC IDENTITY FOR THE BINDINGS THEMSELVES.
 *
 * ── WHY THIS EXISTS ALONGSIDE `missionHash` AND NOT INSIDE IT ──────────────
 *
 * `missionHash` covers `company_profile`, which carries the company NAMES. Two
 * different real companies that share a name therefore produce the SAME mission
 * hash — and `stateMatchesMission` would then accept a checkpoint written for
 * one while executing against the other. That is the "company A resumes against
 * company B" failure, and it cannot be seen from the mission alone.
 *
 * Changing what `missionHash` covers would invalidate every persisted
 * checkpoint in the system at once, so this is a SECOND fingerprint stored
 * beside it. A run with no bindings produces `null` and behaves exactly as it
 * did before bindings existed — which is what keeps every existing checkpoint
 * resumable.
 *
 * Only the identity fields are hashed. The label, the source message and the
 * result index are provenance: they say where a binding came from, not which
 * entity it names, and a re-resolution from a different message must not read
 * as a different question.
 */
export async function bindingFingerprint(
  bindings: readonly ResolvedReferentBinding[],
): Promise<string | null> {
  if (bindings.length === 0) return null;
  const canonical = bindings
    .map((b) => ({
      p: b.part_id,
      t: b.entity_type,
      k: b.entity_key,
      d: b.identity.canonicalDomain,
      l: b.identity.linkedinCompanyId ?? b.identity.linkedinUrl,
    }))
    .sort((a, b) => (a.p + a.k).localeCompare(b.p + b.k));
  return await sha256Hex(canonicalJson({ v: REFERENT_BINDING_VERSION, b: canonical }));
}

/**
 * May a checkpoint be resumed against these bindings?
 *
 * BOTH ABSENT is compatible — that is every run written before bindings
 * existed, and refusing them would strand paid work. BOTH PRESENT must match
 * exactly. One present and one absent is a mismatch: a run that had a fixed
 * identity must not resume without one, and a run that had none must not
 * acquire one mid-flight.
 */
export function bindingsMatchCheckpoint(
  checkpointFingerprint: string | null | undefined,
  currentFingerprint: string | null,
): boolean {
  const a = checkpointFingerprint ?? null;
  return a === currentFingerprint;
}

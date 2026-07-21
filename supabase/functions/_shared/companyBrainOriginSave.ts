// Origin-aware Company Brain writes — the save/refresh BOUNDARY.
//
// WHY THIS EXISTS
//   PR #82 gave us the resolver, the identity block, source-role stripping and a
//   refresh diff — but those were only ADVISORY at the write boundary. A generic
//   `save_draft` could still apply an entire automated draft as if it were a
//   manual edit, silently overwriting a confirmed seller identity, and an
//   approval had no protection against a Brain that changed underneath it.
//
//   Every write now declares its ORIGIN, and this module decides what may
//   actually change:
//
//     manual_edit / onboarding_seller_confirmation → user is authoritative
//     migration                                    → trusted system write
//     automated_refresh                            → fill EMPTY fields only;
//                                                     non-seller sources are
//                                                     stripped of seller fields;
//                                                     everything else is a
//                                                     reviewable suggestion
//     approved_refresh_suggestions                 → apply ONLY approved paths,
//                                                     and only against the exact
//                                                     Brain version reviewed
//     legacy_import                                → fill MISSING fields only
//
//   The result is a SAFE PATCH that the existing applyBrainSave() merges — this
//   module never persists and never recomputes derived flags, so it composes
//   with the current save without duplicating it.
//
// Pure — no DB, no network, no model.

import { mergeV2Patch } from "./companyBrainV2Save.ts";
import {
  stripNonSellerIdentityFields,
  SELLER_IDENTITY_FIELD_PATHS,
  isValidSourceRole,
  type SourceRole,
} from "./companyBrainSourceRole.ts";
import {
  computeBrainRefreshDiff,
  readPath,
  writePath,
  type RefreshFieldDiff,
} from "./companyBrainRefreshDiff.ts";
import { resolveCanonicalSellerIdentity } from "./workbench/sellerIdentity.ts";

export type ChangeOrigin =
  | "manual_edit"
  | "onboarding_seller_confirmation"
  | "automated_refresh"
  | "approved_refresh_suggestions"
  | "migration"
  | "legacy_import";

export const CHANGE_ORIGINS: readonly ChangeOrigin[] = [
  "manual_edit",
  "onboarding_seller_confirmation",
  "automated_refresh",
  "approved_refresh_suggestions",
  "migration",
  "legacy_import",
];

export function isValidChangeOrigin(v: unknown): v is ChangeOrigin {
  return typeof v === "string" && (CHANGE_ORIGINS as readonly string[]).includes(v);
}

/** Origins where the human is the author and may overwrite anything. */
const AUTHORITATIVE_ORIGINS = new Set<ChangeOrigin>([
  "manual_edit",
  "onboarding_seller_confirmation",
  "migration",
]);

export type SaveRejectReason =
  | "unknown_origin"
  | "stale_review"
  | "identity_conflict";

export interface OriginAwareSaveInput {
  existing: Record<string, unknown> | null | undefined;
  /** The proposed changes, in the same v2 patch shape applyBrainSave expects. */
  patch: Record<string, unknown>;
  /** Missing/undefined is treated as `automated_refresh` — never a blanket apply. */
  origin?: unknown;
  /** Role of the source for automated_refresh (competitor/reference/unknown → seller fields stripped). */
  sourceRole?: SourceRole;
  /** For approved_refresh_suggestions: the exact paths the user approved. */
  approvedPaths?: readonly string[];
  /** Fields the user has confirmed — never auto-filled, differing proposal = conflict. */
  confirmedPaths?: readonly string[];
  /** Stale-review guard: the updated_at the reviewer saw. */
  expectedUpdatedAt?: string | null;
  /** The row's actual current updated_at. */
  currentUpdatedAt?: string | null;
}

export interface OriginAwareSaveResult {
  ok: boolean;
  rejected_reason?: SaveRejectReason;
  effective_origin: ChangeOrigin;
  /** The SAFE patch to hand to applyBrainSave. Only these paths change. */
  safe_patch: Record<string, unknown>;
  applied_paths: string[];
  stripped_seller_fields: string[];
  /** Suggestions/conflicts NOT applied — for the UI review state. */
  pending_review: RefreshFieldDiff[];
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Dotted leaf paths of a nested object (recurses objects, stops at arrays/primitives). */
export function collectLeafPaths(obj: unknown, prefix = ""): string[] {
  if (!isObj(obj)) return prefix ? [prefix] : [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (/^\d+$/.test(k)) continue; // ignore char-index noise
    const path = prefix ? `${prefix}.${k}` : k;
    if (isObj(v)) out.push(...collectLeafPaths(v, path));
    else out.push(path);
  }
  return out;
}

function reject(reason: SaveRejectReason, effective: ChangeOrigin): OriginAwareSaveResult {
  return {
    ok: false,
    rejected_reason: reason,
    effective_origin: effective,
    safe_patch: {},
    applied_paths: [],
    stripped_seller_fields: [],
    pending_review: [],
  };
}

/** Would the merged result carry a self-contradicting seller identity? */
function createsIdentityConflict(existing: Record<string, unknown> | null | undefined, safePatch: Record<string, unknown>): boolean {
  const merged = mergeV2Patch(existing, safePatch as Record<string, unknown>);
  return resolveCanonicalSellerIdentity({ profile: merged }).identityStatus === "conflict";
}

/**
 * Decide the SAFE patch to persist for a Company Brain write, given its origin.
 * The caller then runs applyBrainSave(existing, result.safe_patch, …).
 */
export function resolveOriginAwareSave(input: OriginAwareSaveInput): OriginAwareSaveResult {
  const { existing, patch } = input;

  // A patch of nothing is a no-op regardless of origin.
  const providedOrigin = input.origin;

  // Missing origin defaults to the SAFEST path (never a blanket apply).
  // An explicitly-provided but invalid origin is rejected — a caller sending
  // garbage must not fall through to an authoritative write.
  let effective_origin: ChangeOrigin;
  if (providedOrigin === undefined || providedOrigin === null || providedOrigin === "") {
    effective_origin = "automated_refresh";
  } else if (isValidChangeOrigin(providedOrigin)) {
    effective_origin = providedOrigin;
  } else {
    return reject("unknown_origin", "automated_refresh");
  }

  // ---- authoritative writes: user/system is the author -----------------------
  if (AUTHORITATIVE_ORIGINS.has(effective_origin)) {
    return {
      ok: true,
      effective_origin,
      safe_patch: patch ?? {},
      applied_paths: collectLeafPaths(patch),
      stripped_seller_fields: [],
      pending_review: [],
    };
  }

  // ---- approved_refresh_suggestions: only approved paths, only vs the reviewed Brain
  if (effective_origin === "approved_refresh_suggestions") {
    // Stale-review guard: the reviewer must have seen the current version.
    if (
      input.expectedUpdatedAt != null &&
      input.currentUpdatedAt != null &&
      input.expectedUpdatedAt !== input.currentUpdatedAt
    ) {
      return reject("stale_review", effective_origin);
    }
    const role = isValidSourceRole(input.sourceRole) ? input.sourceRole : "unknown";
    const approved = new Set(input.approvedPaths ?? []);
    const sellerFields = new Set(SELLER_IDENTITY_FIELD_PATHS);

    let safe_patch: Record<string, unknown> = {};
    const applied_paths: string[] = [];
    const stripped: string[] = [];
    for (const path of approved) {
      const value = readPath(patch, path);
      if (value === undefined) continue;
      // A competitor/reference/unknown source can never be approved INTO a seller
      // field — approval does not launder provenance.
      const isSellerField = sellerFields.has(path) || sellerFields.has(path.split(".")[0]);
      if (isSellerField && role !== "seller") {
        stripped.push(path);
        continue;
      }
      safe_patch = writePath(safe_patch, path, value);
      applied_paths.push(path);
    }
    if (createsIdentityConflict(existing, safe_patch)) {
      return reject("identity_conflict", effective_origin);
    }
    return { ok: true, effective_origin, safe_patch, applied_paths, stripped_seller_fields: stripped, pending_review: [] };
  }

  // ---- automated_refresh / legacy_import: fill EMPTY fields only --------------
  // legacy_import is the seller's own historical data → never stripped, but still
  // only fills gaps. automated_refresh from a non-seller source is stripped of
  // seller fields first.
  const role: SourceRole = effective_origin === "legacy_import"
    ? "seller"
    : (isValidSourceRole(input.sourceRole) ? input.sourceRole : "unknown");

  const { safePatch: rolePatch, stripped } = stripNonSellerIdentityFields(patch ?? {}, role);

  const pathSet = [...new Set([...collectLeafPaths(rolePatch), ...SELLER_IDENTITY_FIELD_PATHS])];
  const diffs = computeBrainRefreshDiff(existing, rolePatch, pathSet, {
    source: effective_origin,
    source_role: role,
    confidence: null,
    confirmed_paths: input.confirmedPaths,
  });

  let safe_patch: Record<string, unknown> = {};
  const applied_paths: string[] = [];
  const pending_review: RefreshFieldDiff[] = [];
  for (const d of diffs) {
    if (d.action === "fill_empty") {
      safe_patch = writePath(safe_patch, d.field_path, d.proposed);
      applied_paths.push(d.field_path);
    } else if (d.action === "suggestion" || d.action === "conflict") {
      pending_review.push(d);
    }
  }

  if (createsIdentityConflict(existing, safe_patch)) {
    return reject("identity_conflict", effective_origin);
  }

  return { ok: true, effective_origin, safe_patch, applied_paths, stripped_seller_fields: stripped, pending_review };
}

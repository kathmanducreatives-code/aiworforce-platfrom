// Company Brain Refresh becomes SUGGESTION-based for confirmed/non-empty fields.
//
// WHY THIS EXISTS
//   The old save merged an automated draft straight onto the profile: a shallow
//   merge where "v2 always wins". A refresh could therefore silently overwrite a
//   manually corrected seller identity or positioning — the mechanism behind the
//   production contamination surviving edits.
//
//   Refresh now produces a DIFF. Only genuinely empty fields are auto-filled;
//   every non-empty field becomes a reviewable suggestion (or a flagged conflict)
//   that the user must approve. Manual edits are never silently replaced, and a
//   competitor/reference source can never downgrade a confirmed value.
//
// Pure — no DB, no network, no model.

import type { SourceRole } from "./companyBrainSourceRole.ts";

export type RefreshDiffAction = "fill_empty" | "suggestion" | "conflict" | "unchanged";

export interface RefreshFieldDiff {
  field_path: string;
  current: unknown;
  proposed: unknown;
  source: string;
  source_role: SourceRole;
  confidence: number | null;
  action: RefreshDiffAction;
}

export interface RefreshDiffMeta {
  source: string;
  source_role: SourceRole;
  /** 0..1 model/extraction confidence, when known. */
  confidence?: number | null;
  /**
   * Field paths the user has explicitly CONFIRMED. A confirmed field is never
   * auto-filled and never overwritten — a differing proposal is a `conflict`.
   */
  confirmed_paths?: readonly string[];
}

function isEmpty(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v as Record<string, unknown>).length === 0;
  return false;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "string" && typeof b === "string") return a.trim() === b.trim();
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}

/** Read a dotted path (`company.name`) off a nested object. */
export function readPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/** Write a dotted path immutably, returning a new object. */
export function writePath<T extends Record<string, unknown>>(obj: T, path: string, value: unknown): T {
  const keys = path.split(".");
  const root: Record<string, unknown> = { ...(obj ?? {}) };
  let cur = root;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    const next = cur[k];
    cur[k] = next && typeof next === "object" && !Array.isArray(next) ? { ...(next as Record<string, unknown>) } : {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]] = value;
  return root as T;
}

/**
 * Compute a per-field refresh diff between the current profile and a proposed
 * (automated) patch, over the given field paths.
 *
 *   - proposed empty                        → unchanged (nothing to offer)
 *   - proposed == current                   → unchanged
 *   - current empty & path not confirmed    → fill_empty (safe to auto-apply)
 *   - current non-empty OR path confirmed   → suggestion (or conflict if
 *                                             confirmed & differing)
 */
export function computeBrainRefreshDiff(
  current: Record<string, unknown> | null | undefined,
  proposed: Record<string, unknown> | null | undefined,
  fieldPaths: readonly string[],
  meta: RefreshDiffMeta,
): RefreshFieldDiff[] {
  const confirmed = new Set(meta.confirmed_paths ?? []);
  const out: RefreshFieldDiff[] = [];

  for (const path of fieldPaths) {
    const proposedVal = readPath(proposed, path);
    const currentVal = readPath(current, path);

    let action: RefreshDiffAction;
    if (isEmpty(proposedVal) || sameValue(currentVal, proposedVal)) {
      action = "unchanged";
    } else if (isEmpty(currentVal) && !confirmed.has(path)) {
      action = "fill_empty";
    } else if (confirmed.has(path)) {
      action = "conflict";
    } else {
      action = "suggestion";
    }

    if (action === "unchanged") continue;

    out.push({
      field_path: path,
      current: currentVal ?? null,
      proposed: proposedVal ?? null,
      source: meta.source,
      source_role: meta.source_role,
      confidence: meta.confidence ?? null,
      action,
    });
  }
  return out;
}

/**
 * Apply ONLY the safe part of a refresh diff: fields that were genuinely empty.
 * Suggestions and conflicts are returned untouched for the user to review — they
 * are NEVER auto-applied. Returns the new profile plus the pending items.
 */
export function applyRefreshDiff(
  current: Record<string, unknown> | null | undefined,
  diffs: readonly RefreshFieldDiff[],
): { profile: Record<string, unknown>; auto_filled: string[]; pending: RefreshFieldDiff[] } {
  let profile: Record<string, unknown> = { ...(current ?? {}) };
  const auto_filled: string[] = [];
  const pending: RefreshFieldDiff[] = [];

  for (const d of diffs) {
    if (d.action === "fill_empty") {
      profile = writePath(profile, d.field_path, d.proposed);
      auto_filled.push(d.field_path);
    } else if (d.action === "suggestion" || d.action === "conflict") {
      pending.push(d);
    }
  }
  return { profile, auto_filled, pending };
}

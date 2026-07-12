// Radar category model — pure, import-free so it's unit-testable. Fixes the
// recorded IA bugs: category tabs showing "68 signals hidden by filters" inside a
// zero-result category, filters persisting across categories, and Saved-vs-Drafts
// confusion. No React here — the Signals page consumes these helpers.

export type RadarCategory =
  | "all" | "hiring" | "funding" | "competitor" | "workflow_trend"
  | "linkedin_post" | "linkedin_comment" | "decision_maker" | "saved" | "reviewed";

export interface CategoryItem {
  signal_type?: string | null;
  is_person_only?: boolean | null;
  saved?: boolean | null;
  reviewed?: boolean | null;
}

const TYPE_TO_CATEGORY: Record<string, RadarCategory> = {
  hiring: "hiring", funding: "funding", competitor: "competitor",
  workflow_trend: "workflow_trend", linkedin_intent: "linkedin_post", linkedin_post: "linkedin_post",
  linkedin_comment: "linkedin_comment", people_profile: "decision_maker", people: "decision_maker",
};

export function itemCategory(item: CategoryItem): RadarCategory | null {
  const t = (item.signal_type ?? "").toLowerCase();
  return TYPE_TO_CATEGORY[t] ?? null;
}

/** Does an item belong in the given category tab? Person-only rows never count
 * toward the verified/account categories — only the Decision makers tab. */
export function itemInCategory(item: CategoryItem, category: RadarCategory): boolean {
  if (category === "all") return !item.is_person_only; // legacy person rows excluded from All
  if (category === "saved") return !!item.saved;
  if (category === "reviewed") return !!item.reviewed;
  if (category === "decision_maker") return !!item.is_person_only || itemCategory(item) === "decision_maker";
  if (item.is_person_only) return false;
  return itemCategory(item) === category;
}

/** Per-category count using CATEGORY membership — never the global total. */
export function categoryCount(items: CategoryItem[], category: RadarCategory): number {
  return items.filter((i) => itemInCategory(i, category)).length;
}

export interface EmptyState {
  kind: "no_source_results" | "hidden_by_filters" | "not_empty";
  message: string;
}

const CATEGORY_EMPTY_COPY: Partial<Record<RadarCategory, string>> = {
  funding: "No verified funding signals were found in this scan.",
  competitor: "No competitor changes matched your Company Brain.",
  linkedin_post: "No relevant posts with sufficient evidence were found.",
  linkedin_comment: "No ICP-fit commenters showed meaningful intent.",
  hiring: "No hiring signals matched your ICP in this scan.",
  workflow_trend: "No workflow trends with sufficient evidence were found.",
  decision_maker: "No decision makers are attached to a verified signal yet.",
};

/**
 * Honest empty state for a category. Distinguishes "this category genuinely
 * returned zero" from "results exist but your active filters hid them". Never
 * shows a global "N signals hidden" message inside a zero-result category.
 */
export function categoryEmptyState(args: {
  category: RadarCategory;
  categoryTotal: number;      // items in this category BEFORE filters
  visibleInCategory: number;  // items in this category AFTER filters
  activeFilterCount: number;
}): EmptyState {
  if (args.visibleInCategory > 0) return { kind: "not_empty", message: "" };
  if (args.categoryTotal > 0 && args.activeFilterCount > 0) {
    return { kind: "hidden_by_filters", message: `${args.categoryTotal} ${args.category.replace(/_/g, " ")} signal${args.categoryTotal === 1 ? "" : "s"} hidden by your filters.` };
  }
  return { kind: "no_source_results", message: CATEGORY_EMPTY_COPY[args.category] ?? "No results in this category for this scan." };
}

// ---------------------------------------------------------------------------
// Category-aware filters
// ---------------------------------------------------------------------------
export interface RadarFilters {
  decision?: string | null;      // contact | watch | needs_review | skip
  role_family?: string | null;   // exact | adjacent | unrelated (hiring only)
  post_group?: string | null;    // competitor | category_leader | ... (posts only)
  verified_only?: boolean;
}

/** Which filter keys are meaningful for a category. */
const CATEGORY_FILTER_KEYS: Record<RadarCategory, (keyof RadarFilters)[]> = {
  all: ["decision", "verified_only"],
  hiring: ["decision", "role_family", "verified_only"],
  funding: ["decision", "verified_only"],
  competitor: ["decision", "verified_only"],
  workflow_trend: ["decision", "verified_only"],
  linkedin_post: ["decision", "post_group", "verified_only"],
  linkedin_comment: ["decision", "verified_only"],
  decision_maker: ["decision"],
  saved: ["decision"],
  reviewed: ["decision"],
};

/** Drop filters that don't apply to the newly-selected category, so switching
 * tabs never leaves an impossible filter state (e.g. role_family on Funding). */
export function reconcileFilters(category: RadarCategory, filters: RadarFilters): RadarFilters {
  const allowed = new Set<string>(CATEGORY_FILTER_KEYS[category] as string[]);
  const out: RadarFilters = {};
  for (const [k, v] of Object.entries(filters)) {
    if (allowed.has(k) && v != null && v !== "") (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

export function activeFilterCount(filters: RadarFilters): number {
  return Object.values(filters).filter((v) => v != null && v !== "" && v !== false).length;
}

export function emptyFilters(): RadarFilters { return {}; }

// ---------------------------------------------------------------------------
// Saved signals vs content drafts are DIFFERENT objects
// ---------------------------------------------------------------------------
export interface SavedVsDraftInput { kind: "saved_signal" | "content_draft"; }
export function isSavedSignal(x: SavedVsDraftInput): boolean { return x.kind === "saved_signal"; }
export function isContentDraft(x: SavedVsDraftInput): boolean { return x.kind === "content_draft"; }
/** The Saved-Signals tab must never show a content-empty-state message. */
export function savedTabEmptyMessage(savedCount: number): string {
  return savedCount > 0 ? "" : "You haven't saved any signals yet. Bookmark a signal to keep it here.";
}

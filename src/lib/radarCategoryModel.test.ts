import { describe, it, expect } from "vitest";
import {
  categoryCount, itemInCategory, categoryEmptyState, reconcileFilters, activeFilterCount,
  isSavedSignal, isContentDraft, savedTabEmptyMessage, type CategoryItem,
} from "./radarCategoryModel";

const items: CategoryItem[] = [
  { signal_type: "hiring" }, { signal_type: "hiring" },
  { signal_type: "linkedin_intent" },
  { signal_type: "people_profile", is_person_only: true }, // legacy person row
  { signal_type: "hiring", saved: true },
];

describe("radar category model", () => {
  // 22. category empty state uses category count, not global total
  it("22. empty state uses category count, never the global total", () => {
    // Funding tab: zero funding items, but 5 total signals + no filters → no-source message (not "5 hidden").
    const es = categoryEmptyState({ category: "funding", categoryTotal: 0, visibleInCategory: 0, activeFilterCount: 0 });
    expect(es.kind).toBe("no_source_results");
    expect(es.message).toMatch(/no verified funding/i);
    expect(es.message).not.toMatch(/hidden/i);
    // Hiring tab: 3 hiring items but all hidden by a filter → hidden-by-filters uses the CATEGORY count (3), not 5.
    const hidden = categoryEmptyState({ category: "hiring", categoryTotal: 3, visibleInCategory: 0, activeFilterCount: 1 });
    expect(hidden.kind).toBe("hidden_by_filters");
    expect(hidden.message).toMatch(/^3 hiring signals hidden/);
  });

  it("counts per category and excludes person-only rows from All", () => {
    expect(categoryCount(items, "hiring")).toBe(3);
    expect(categoryCount(items, "linkedin_post")).toBe(1);
    expect(categoryCount(items, "decision_maker")).toBe(1);
    expect(categoryCount(items, "all")).toBe(4); // person-only excluded
    expect(itemInCategory({ signal_type: "people_profile", is_person_only: true }, "all")).toBe(false);
  });

  // 23. filters reset/reconcile when switching category
  it("23. reconcileFilters drops filters that don't apply to the new category", () => {
    const filters = { decision: "watch", role_family: "exact", post_group: "competitor", verified_only: true };
    // Funding has no role_family/post_group.
    const onFunding = reconcileFilters("funding", filters);
    expect(onFunding.role_family).toBeUndefined();
    expect(onFunding.post_group).toBeUndefined();
    expect(onFunding.decision).toBe("watch");
    expect(activeFilterCount(onFunding)).toBe(2); // decision + verified_only
    // Hiring keeps role_family, drops post_group.
    const onHiring = reconcileFilters("hiring", filters);
    expect(onHiring.role_family).toBe("exact");
    expect(onHiring.post_group).toBeUndefined();
  });

  // 26. saved signals and content drafts remain separate
  it("26. saved signals and content drafts are distinct objects", () => {
    expect(isSavedSignal({ kind: "saved_signal" })).toBe(true);
    expect(isContentDraft({ kind: "saved_signal" })).toBe(false);
    expect(isContentDraft({ kind: "content_draft" })).toBe(true);
    // Saved tab empty message is about saved signals, not content.
    expect(savedTabEmptyMessage(0)).toMatch(/saved any signals/i);
    expect(savedTabEmptyMessage(0)).not.toMatch(/draft|content/i);
    expect(savedTabEmptyMessage(2)).toBe("");
  });
});

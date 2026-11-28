// COMPANY BRAIN V2 · B2.3 — the ONE place memory item shapes are built.
//
// The Brain page's "Teach Agentory" forms and ORION's conversation offers build
// the same item for the same statement, so the same preference always lands on
// the same key: proposals dedupe, approvals supersede instead of duplicating,
// and the shared loader folds them in exactly one way. Pure.

export type ItemPayload = {
  kind: "fact" | "preference" | "decision";
  category: string;
  fact_key: string;
  value_type: "text" | "list" | "number_range" | "object";
  value: unknown;
  reason?: string;
};

export const memorySlug = (s: string) =>
  s.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[^a-z0-9.]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);

export const exclusionItem = (type: "industry" | "company" | "geography" | "keyword", value: string): ItemPayload => ({
  kind: "preference", category: "exclusions", fact_key: `exclusion.${type}:${memorySlug(value)}`,
  value_type: "object", value: { type, value },
});
export const companySizeItem = (min: number, max: number | null): ItemPayload => ({
  kind: "preference", category: "icp", fact_key: "icp.company_size", value_type: "number_range", value: { min, max },
});
export const toneItem = (text: string): ItemPayload => ({ kind: "preference", category: "content", fact_key: "content.tone", value_type: "text", value: text });
export const restrictionItem = (text: string): ItemPayload => ({
  kind: "preference", category: "content", fact_key: `content.restrictions:${memorySlug(text).slice(0, 60)}`, value_type: "list", value: [text],
});
export const priorityItem = (text: string): ItemPayload => ({
  kind: "preference", category: "sales_priority", fact_key: `priority.${memorySlug(text).slice(0, 40)}`, value_type: "text", value: text,
});
export const goalItem = (text: string): ItemPayload => ({ kind: "fact", category: "goals", fact_key: `goal.${memorySlug(text).slice(0, 40)}`, value_type: "text", value: text });
export const productItem = (text: string): ItemPayload => ({ kind: "fact", category: "products", fact_key: `product.${memorySlug(text).slice(0, 40)}`, value_type: "text", value: text });

/** A business fact in the team's words ("We have 12 employees", "Our HQ is in Lisbon"). */
export const factItem = (text: string): ItemPayload => ({
  kind: "fact", category: "company_facts", fact_key: `fact.${memorySlug(text).slice(0, 60)}`, value_type: "text", value: text,
});

/**
 * A business fact keyed by its SUBJECT ("sales cycle", "average deal size"), not by its wording,
 * so a later value for the same subject REPLACES the earlier one (the writer updates the active
 * item on the same key; history keeps the old value). ORION-003: "45 days" and later "60 days"
 * must be one memory with two versions, never two contradictory memories.
 */
export const subjectFactItem = (subject: string, value: string, previous?: string | null): ItemPayload => {
  const label = subject.trim().replace(/\s+/g, " ");
  const head = label ? label[0].toUpperCase() + label.slice(1) : label;
  return {
    kind: "fact", category: "company_facts", fact_key: `fact.${memorySlug(label).slice(0, 60)}`,
    value_type: "text", value: `${head}: ${value.trim()}`,
    ...(previous ? { reason: `Replaces: ${head}: ${previous.trim()}`.slice(0, 500) } : {}),
  };
};

/** A standing business decision. Workspace-wide decisions are limited to these categories (the database enforces it). */
export const WORKSPACE_DECISION_CATEGORIES = ["strategy_selected", "icp_changed", "brand_preference", "exclusion_added", "correction"] as const;
export type WorkspaceDecisionCategory = typeof WORKSPACE_DECISION_CATEGORIES[number];
export const decisionItem = (outcome: string, category: WorkspaceDecisionCategory = "strategy_selected"): ItemPayload => ({
  kind: "decision", category, fact_key: `decision.${memorySlug(outcome).slice(0, 60)}`, value_type: "object", value: { outcome },
});

/** A correction: what agents believed vs what is true. It supersedes the earlier belief for every agent. */
export const correctionItem = (wrong: string, right: string): ItemPayload => ({
  kind: "fact", category: "corrections", fact_key: `correction.${memorySlug(wrong).slice(0, 60)}`,
  value_type: "object", value: { wrong, right }, reason: `Replaces: ${wrong}`.slice(0, 500),
});

/** "50-200", "50 to 200", "50+" → a range, or null. */
export function parseSizeRange(text: string): { min: number; max: number | null } | null {
  const t = text.replace(/,/g, "").trim();
  const m = t.match(/^(\d+)\s*(?:-|–|to)\s*(\d+)$/) ?? t.match(/^(\d+)\s*\+$/);
  if (!m) return null;
  const min = Number(m[1]); const max = m[2] ? Number(m[2]) : null;
  if (max !== null && max < min) return null;
  return { min, max };
}

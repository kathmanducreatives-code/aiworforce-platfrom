// The Toolbar owns the visible filter chrome now. This module keeps the
// canonical Filters shape + applyFilters() so LeadLibrary.tsx and any other
// consumers keep working while the filter model is aligned with the
// canonical decision layer.

import type { LeadRow } from "@/lib/leadLibrary/types";
import { deriveLeadDecisionState, type LeadDecision, type FitBand, type BuyerState, type LeadLifecycle, fitBandFromScore } from "@/lib/leadLibrary/leadDecisionState";

export interface Filters {
  q: string;
  decision: LeadDecision | "any";
  lifecycle: LeadLifecycle | "any";
  fit: FitBand | "any";
  buyer: BuyerState | "any";
  industry: string | "any";
  source: string | "any";
}

export const EMPTY_FILTERS: Filters = {
  q: "",
  decision: "any",
  lifecycle: "any",
  fit: "any",
  buyer: "any",
  industry: "any",
  source: "any",
};

export function applyFilters(rows: LeadRow[], f: Filters): LeadRow[] {
  const q = f.q.trim().toLowerCase();
  return rows.filter((r) => {
    const s = deriveLeadDecisionState(r);
    if (q) {
      const hay = [
        r.name,
        r.domain,
        r.industry,
        r.selectedRecipient?.fullName,
        r.selectedRecipient?.title,
        s.whyNowSummary,
        r.strongestSource?.headline,
        r.strongestSource?.sourceType,
        r.strongestSource?.discoveryMethod,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (f.decision !== "any" && s.decision !== f.decision) return false;
    if (f.lifecycle !== "any" && s.lifecycle !== f.lifecycle) return false;
    if (f.fit !== "any" && fitBandFromScore(r.fitScore) !== f.fit) return false;
    if (f.buyer !== "any" && s.buyerState !== f.buyer) return false;
    if (f.industry !== "any" && r.industry !== f.industry) return false;
    if (f.source !== "any" && r.strongestSource?.discoveryMethod !== f.source) return false;
    return true;
  });
}

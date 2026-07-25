// User-facing label helpers for the Lead Library UI. Now delegates status
// derivations to the canonical decision layer (leadDecisionState) so the
// table, drawer and counters never disagree.

import type { LeadRow } from "./types";
import {
  deriveLeadDecisionState,
  decisionLabel,
  nextActionLabel as decisionNextActionLabel,
  humanizeSource,
} from "./leadDecisionState";

export function signalLabel(row: LeadRow): { label: string; sub: string | null } {
  const src = row.strongestSource;
  if (!src) return { label: "Limited timing evidence", sub: null };
  const type = humanizeSource(src.sourceType ?? src.discoveryMethod);
  const sub = src.headline ?? src.discoveryMethod ?? null;
  return { label: type, sub };
}

export function fitToneFor(score: number | null): "success" | "warning" | "danger" | "muted" {
  if (score == null) return "muted";
  if (score >= 60) return "success";
  if (score >= 40) return "warning";
  return "danger";
}

export function fitShortLabel(score: number | null): string {
  if (score == null) return "Unknown";
  if (score >= 80) return "Strong fit";
  if (score >= 60) return "Good fit";
  if (score >= 40) return "Soft fit";
  return "Poor fit";
}

export function readinessState(row: LeadRow): {
  label: string;
  steps: [boolean, boolean, boolean]; // research, buyer, draft
} {
  const s = deriveLeadDecisionState(row);
  const research = s.researchState === "ready";
  const buyer = s.buyerState === "verified";
  const draft = s.outreachState === "draft_ready" || s.outreachState === "awaiting_approval";
  return { label: decisionLabel(s.decision), steps: [research, buyer, draft] };
}

// Consistent terminology: always "Find decision-makers", never "Find buyer".
export function nextActionLabel(row: LeadRow): string {
  return decisionNextActionLabel(deriveLeadDecisionState(row).nextAction);
}

export function openerStatusLabel(row: LeadRow): { label: string; tone: "success" | "warning" | "muted" } {
  if (!row.opener) return { label: "No draft", tone: "muted" };
  const s = row.opener.status;
  if (s === "approved") return { label: "Awaiting approval", tone: "success" };
  if (s === "draft_ready" || s === "edited") return { label: "Draft ready", tone: "success" };
  if (s === "generating") return { label: "Preparing", tone: "warning" };
  if (s === "failed") return { label: "Retry failed", tone: "warning" };
  return { label: "No draft", tone: "muted" };
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const diff = Date.now() - t;
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return "Yesterday";
  if (d < 30) return `${d}d ago`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(mo / 12)}y ago`;
}

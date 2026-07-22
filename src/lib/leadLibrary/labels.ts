// User-facing label helpers for the Lead Library UI. Keeps raw snake_case
// values from the read model out of the presentation layer.

import type { LeadRow } from "./types";

export function signalLabel(row: LeadRow): { label: string; sub: string | null } {
  const src = row.strongestSource;
  if (!src) return { label: "Needs verification", sub: null };

  const method = (src.discoveryMethod ?? "").toLowerCase();
  const type = (src.sourceType ?? "").toLowerCase();

  let label = "Signal detected";
  if (/job|hiring|posting/.test(method + type)) label = "Hiring signal";
  else if (/fund|invest|series|raise/.test(method + type)) label = "Funding signal";
  else if (/engage|reply|comment|like|profile/.test(method + type)) label = "Engagement signal";
  else if (/news|press|announcement/.test(method + type)) label = "News signal";
  else if (src.confidence === "verified") label = "Verified signal";
  else if (src.confidence === "unverified") label = "Weak evidence";

  const sub = src.headline ?? src.discoveryMethod ?? src.sourceType;
  return { label, sub };
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
  const research = !!row.strongestSource;
  const buyer = row.contactReadiness === "verified";
  const draft =
    row.opener?.status === "draft_ready" ||
    row.opener?.status === "approved" ||
    row.opener?.status === "edited";
  const steps: [boolean, boolean, boolean] = [research, buyer, draft];

  let label: string;
  if (!research) label = "Researching";
  else if (!buyer) label = "Buyer needed";
  else if (row.opener?.status === "generating") label = "Draft preparing";
  else if (row.opener?.status === "approved") label = "Approved";
  else if (draft) label = "Ready for review";
  else label = "Contact-ready";
  return { label, steps };
}

export function nextActionLabel(row: LeadRow): string {
  if (row.accountStatus === "archived") return "Skip";
  if (!row.strongestSource) return "Complete research";
  if (row.contactReadiness !== "verified") return "Find buyer";
  if (!row.opener || row.opener.status === "not_generated") return "Prepare draft";
  if (row.opener.status === "draft_ready" || row.opener.status === "edited")
    return "Review draft";
  if (row.opener.status === "approved" && row.engagementStatus === "not_contacted")
    return "Contact";
  if (row.engagementStatus === "contacted") return "Follow up";
  return "Watch account";
}

export function openerStatusLabel(row: LeadRow): { label: string; tone: "success" | "warning" | "muted" } {
  if (!row.opener) return { label: "Not prepared", tone: "muted" };
  const s = row.opener.status;
  if (s === "approved") return { label: "Approved", tone: "success" };
  if (s === "draft_ready" || s === "edited") return { label: "Draft ready", tone: "success" };
  if (s === "generating") return { label: "Preparing", tone: "warning" };
  if (s === "failed") return { label: "Retry failed", tone: "warning" };
  return { label: "Not prepared", tone: "muted" };
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

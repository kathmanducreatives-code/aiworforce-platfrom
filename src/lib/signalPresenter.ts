// Pure presenter helpers for signal evidence / verification. Deno-testable, no
// React. Drive the premium SignalCard + SignalDetailDrawer and keep the UI honest:
// evidence is only "present" when a real source URL exists; weak proof surfaces a
// needs-verification state and an explicit missing-evidence list.

export interface EvidenceInput {
  sourceUrl?: string | null;
  verificationStatus?: string | null; // "verified" | "needs_verification" | "rejected"
  quality?: string | null; // "verified" | "needs_verification" | "legacy"
  company?: string | null;
}

export interface EvidenceState {
  hasEvidence: boolean;
  needsVerification: boolean;
  label: string; // short badge label
}

function isHttpUrl(u?: string | null): boolean {
  return /^https?:\/\/\S+/i.test((u ?? "").trim());
}

export function evidenceState(input: EvidenceInput): EvidenceState {
  const hasEvidence = isHttpUrl(input.sourceUrl);
  const v = (input.verificationStatus ?? input.quality ?? "").toLowerCase();
  const verified = v === "verified";
  const needsVerification = !verified && (v === "needs_verification" || v === "legacy" || !hasEvidence);
  const label = verified ? "Verified" : needsVerification ? "Needs review" : hasEvidence ? "Has source" : "No proof";
  return { hasEvidence, needsVerification, label };
}

/** Honest list of what evidence is missing for this signal. */
export function missingEvidence(input: EvidenceInput): string[] {
  const out: string[] = [];
  if (!isHttpUrl(input.sourceUrl)) out.push("Source proof URL");
  if (!(input.company ?? "").trim()) out.push("Company identity");
  const v = (input.verificationStatus ?? input.quality ?? "").toLowerCase();
  if (v !== "verified" && out.length === 0) out.push("Independent confirmation");
  return out;
}

export type ConfidenceLevel = "low" | "medium" | "high";

export function confidenceLabel(level?: string | null): { label: string; level: ConfidenceLevel } {
  const l = (level ?? "").toLowerCase();
  if (l === "high") return { label: "High confidence", level: "high" };
  if (l === "medium") return { label: "Medium confidence", level: "medium" };
  return { label: "Low confidence", level: "low" };
}

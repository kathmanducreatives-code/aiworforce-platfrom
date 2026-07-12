// Pure view helpers for source diagnostics. Honest readiness labels — "Ready" is
// never shown merely because an API key exists.

export type ReadinessTone = "good" | "warn" | "bad" | "neutral";

const READINESS: Record<string, { label: string; tone: ReadinessTone }> = {
  not_configured: { label: "Not configured", tone: "neutral" },
  configured_untested: { label: "Configured but untested", tone: "neutral" },
  healthy: { label: "Healthy", tone: "good" },
  degraded: { label: "Degraded", tone: "warn" },
  returned_zero: { label: "No matches", tone: "warn" },
  query_no_match: { label: "No matches", tone: "warn" },
  matches_rejected: { label: "All results rejected", tone: "warn" },
  auth_failed: { label: "Authentication failed", tone: "bad" },
  provider_error: { label: "Provider error", tone: "bad" },
};

export function readinessLabel(readiness: string | null | undefined): { label: string; tone: ReadinessTone } {
  return READINESS[(readiness ?? "").toLowerCase()] ?? { label: readiness ?? "Unknown", tone: "neutral" };
}

export const SOURCE_LABEL: Record<string, string> = {
  hiring: "Hiring",
  funding: "Funding",
  competitor: "Competitors",
  workflow_trend: "Workflow trends",
  linkedin_post: "LinkedIn posts",
  linkedin_comment: "Comments",
  decision_maker: "Decision makers",
};

export function sourceLabel(source: string): string {
  return SOURCE_LABEL[source] ?? source;
}

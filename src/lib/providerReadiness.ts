// Pure provider-readiness normalization. No React, no network — unit-testable
// under Deno. The `integration-readiness` edge function returns capability-keyed
// entries (firecrawl, apify_people, lovable_ai…), but the Signals/Content UI
// reads friendlier keys (apify, linkedin). Without an alias those resolve to
// `undefined` and the UI always shows "Apify isn't active" even when a token is
// present. This adds the aliases on the frontend so we don't have to redeploy
// the edge function.

export type IntegrationStatus = "connected" | "setup_needed" | "optional" | "unavailable";

export interface IntegrationEntry {
  status: IntegrationStatus;
  label: string;
  reason?: string;
}

export type ProviderMap = Record<string, IntegrationEntry>;

// Honest, capability-specific message shown when Apify people search is
// unavailable. Hiring and workflow signals come from Firecrawl, so we must NOT
// claim they are blocked — only the LinkedIn people/profile/comment capability.
export const APIFY_PEOPLE_BLOCKED_REASON =
  "LinkedIn people, profile, and comment discovery need an Apify token. " +
  "Hiring and workflow signals still work via Firecrawl.";

export function isConnected(entry: IntegrationEntry | undefined): boolean {
  return entry?.status === "connected";
}

/**
 * Return a copy of the raw provider map with UI-facing aliases added:
 *   apify    ← apify_people
 *   linkedin ← apify_people
 * Existing keys are never overwritten. When apify_people is not connected the
 * alias reason is rewritten to the capability-specific (LinkedIn-only) message,
 * so no consumer can claim hiring signals are blocked.
 */
export function withProviderAliases(raw: ProviderMap): ProviderMap {
  const out: ProviderMap = { ...raw };
  const people = raw["apify_people"];
  if (people) {
    const aliased: IntegrationEntry = {
      status: people.status,
      label: "Apify (LinkedIn people search)",
      reason: people.status === "connected" ? people.reason : APIFY_PEOPLE_BLOCKED_REASON,
    };
    if (!out["apify"]) out["apify"] = aliased;
    if (!out["linkedin"]) out["linkedin"] = aliased;
  }
  return out;
}

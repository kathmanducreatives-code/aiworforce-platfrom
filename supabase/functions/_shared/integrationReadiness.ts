// Provider readiness — which platform integrations are configured.
//
// Pure read of secret PRESENCE from the environment; never returns a secret
// value. Platform-level: the same answer for every workspace, so it is computed
// live wherever it is needed instead of being stored per workspace. (It used to
// be mirrored into company_brain.profile.integration_status on every visit to
// Content or Signals — a write-on-read that could overwrite a concurrent
// Company Brain edit. docs/audits/company-brain-onboarding, P0-3.)

export type Status = "connected" | "setup_needed" | "optional" | "unavailable";
export interface Entry { status: Status; label: string; reason?: string }
function present(name: string): boolean {
  const v = Deno.env.get(name);
  return !!(v && v.trim().length > 0);
}

function flag(name: string, fallback = false): boolean {
  const v = Deno.env.get(name);
  if (v == null) return fallback;
  const t = v.trim().toLowerCase();
  return t === "1" || t === "true" || t === "yes" || t === "on";
}

/** Live readiness of every provider integration. */
export function buildIntegrationStatus(): Record<string, Entry> {
  const lovable = present("LOVABLE_API_KEY");
  const firecrawl = present("FIRECRAWL_API_KEY");
  const apifyToken = present("APIFY_API_TOKEN");
  const apifyEnabled = flag("APIFY_ENABLE_PEOPLE_SEARCH", true);
  const resend = present("RESEND_API_KEY");
  const openai = present("OPENAI_API_KEY");
  const anthropic = present("ANTHROPIC_API_KEY");
  const google = present("GOOGLE_AI_API_KEY");

  return {
    lovable_ai: {
      status: lovable ? "connected" : "setup_needed",
      label: "Lovable AI Gateway",
      reason: lovable ? undefined : "Required for agent reasoning. Contact support if missing.",
    },
    firecrawl: {
      status: firecrawl ? "connected" : "setup_needed",
      label: "Firecrawl (web research)",
      reason: firecrawl ? undefined : "Needed for website audits, competitor research, and ICP enrichment.",
    },
    apify_people: {
      status: apifyToken && apifyEnabled ? "connected" : (apifyToken ? "setup_needed" : "setup_needed"),
      label: "Apify (people / hiring signals)",
      reason: apifyToken && apifyEnabled
        ? undefined
        : (!apifyToken
            ? "Add an Apify API token to find decision-makers and hiring signals."
            : "People search is disabled. Set APIFY_ENABLE_PEOPLE_SEARCH=true."),
    },
    resend: {
      status: resend ? "connected" : "optional",
      label: "Resend (email drafts)",
      reason: resend ? undefined : "Optional. Needed to send approved email drafts.",
    },
    openai: {
      status: openai ? "connected" : "optional",
      label: "OpenAI",
      reason: openai ? undefined : "Optional fallback model.",
    },
    anthropic: {
      status: anthropic ? "connected" : "optional",
      label: "Anthropic",
      reason: anthropic ? undefined : "Optional fallback model.",
    },
    google_ai: {
      status: google ? "connected" : "optional",
      label: "Google AI",
      reason: google ? undefined : "Optional fallback model.",
    },
  };
}

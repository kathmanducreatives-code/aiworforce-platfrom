// Feature flags for provider discovery. Every one is OFF unless set to a true
// value; an unset or malformed variable is off.
//
//   PROVIDER_DISCOVERY_ENABLED            master switch (edge functions answer 404 when off)
//   PROVIDER_DISCOVERY_WORKSPACES         comma list of workspace ids allowed; empty = none
//   PROVIDER_APOLLO_ENABLED               per provider
//   PROVIDER_LEADOCEAN_ENABLED
//   PROVIDER_APIFY_DISCOVERY_ENABLED
//   APOLLO_COMMERCIAL_TERMS_CONFIRMED     customer-facing use reviewed and agreed
//   LEADOCEAN_COMMERCIAL_TERMS_CONFIRMED  (both required before a connection is accepted)
//
// Pure: pass the environment in.

import type { ProviderId } from "./types.ts";

export type Env = (name: string) => string | undefined;

const on = (v: string | undefined) => !!v && ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());

export interface DiscoveryFlags {
  enabled: boolean;
  workspaces: Set<string>;
  provider: Record<ProviderId, boolean>;
  commercialTerms: Record<ProviderId, boolean>;
}

export function readFlags(env: Env): DiscoveryFlags {
  return {
    enabled: on(env("PROVIDER_DISCOVERY_ENABLED")),
    workspaces: new Set((env("PROVIDER_DISCOVERY_WORKSPACES") ?? "").split(",").map((s) => s.trim()).filter(Boolean)),
    provider: {
      apollo: on(env("PROVIDER_APOLLO_ENABLED")),
      leadocean: on(env("PROVIDER_LEADOCEAN_ENABLED")),
      apify: on(env("PROVIDER_APIFY_DISCOVERY_ENABLED")),
    },
    commercialTerms: {
      apollo: on(env("APOLLO_COMMERCIAL_TERMS_CONFIRMED")),
      leadocean: on(env("LEADOCEAN_COMMERCIAL_TERMS_CONFIRMED")),
      // Apify runs through the platform's existing integration.
      apify: true,
    },
  };
}

export function workspaceAllowed(f: DiscoveryFlags, workspaceId: string): boolean {
  return f.enabled && f.workspaces.has(workspaceId);
}

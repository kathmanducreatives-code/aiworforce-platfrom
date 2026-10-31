// Apollo — REGISTERED, NOT ENABLED.
//
// The slot exists so Apollo plugs in without restructuring: implement `run` for
// the capabilities SOURCE_REGISTRY.apollo declares, flip their status to
// `available` once access, permissions and capabilities are validated, and wire
// the existing adapter (discoveryProviders/adapters/apollo.ts: People API Search,
// Organization Search). Until then every call refuses, before any network use.
// No Apollo capability is assumed beyond its public documentation; the People
// API Search returned 403 API_INACCESSIBLE on the current plan (2026-10-30).

import type { DiscoveryAdapter } from "../../discoveryProviders/adapter.ts";
import { emptyResult, type DiscoverySource, type SourceRunInput, type SourceRunResult } from "../sources.ts";

export function apolloSource(_adapter: DiscoveryAdapter | null): DiscoverySource {
  return {
    id: "apollo",
    run(_input: SourceRunInput): Promise<SourceRunResult> {
      return Promise.resolve(emptyResult(["Apollo is registered but not enabled: integration not yet validated"], "provider_disabled"));
    },
  };
}

// SIGNALS MONITORING'S OWN DOOR INTO THE CAPABILITY GRAPH.
//
// Monitoring and Lead V2 share `buildCapabilityGraph`. Lead V2 now builds its
// plans with the executability gate enforced (`capabilityExecutability.ts`);
// monitoring must not change because of that. Every monitoring plan is built
// through this port, which pins the graph to `legacy` — the behaviour captured
// in `tests/fixtures/lead-v2/p0-legacy-monitoring-snapshots.json` and pinned by
// `p0LegacyContract.test.ts`.
//
// Changing monitoring's retrieval is a monitoring decision, made here,
// deliberately — never a side effect of Lead V2 work.

import { buildCapabilityGraph, type CapabilityPlan } from "./leadCapabilityGraph.ts";
import type { LeadMissionV1 } from "./leadMission.ts";

export const MONITORING_EXECUTABILITY_MODE = "legacy" as const;

export function buildMonitoringCapabilityGraph(mission: LeadMissionV1): CapabilityPlan {
  return buildCapabilityGraph(mission, { executability: MONITORING_EXECUTABILITY_MODE });
}

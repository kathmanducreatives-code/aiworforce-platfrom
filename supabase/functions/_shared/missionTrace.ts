// LEAD V2 P2 — THE MISSION TRACE. APPEND-ONLY.
//
// Five audits of Lead V2 runs had to reconstruct "what did the plan say, what
// did the engine change, what was actually sent and what did it cost" from log
// lines, ledger rows and provider run documents. The trace records it as it
// happens: plan versions, amendments and refusals, every compiled
// ProviderCallSpec, every reservation, execution, adoption and settlement.
//
// Carried in the execution state (and so the checkpoint); mirrored to
// `lead_mission_events` when that table exists. Events are never edited.
//
// Pure.

export const MISSION_TRACE_VERSION = "mission-trace-v1" as const;

export type TraceEventType =
  | "retrieval_plan_created"
  | "retrieval_plan_amended"
  | "amendment_refused"
  | "spec_compiled"
  | "spec_refused"
  | "call_reserved"
  | "call_refused_budget"
  | "call_idempotent_skip"
  | "call_adopted"
  | "call_executed"
  | "call_failed"
  | "call_released"
  | "call_settled"
  | "continuation_resumed"
  // P4: research fabric feedback and route control.
  | "research_wave_summarized"
  | "route_control_decided";

export interface TraceEvent {
  seq: number;
  at: string;
  type: TraceEventType;
  plan_version: number | null;
  provider_call_id: string | null;
  idempotency_key: string | null;
  detail: Record<string, unknown>;
}

export interface MissionTrace {
  version: typeof MISSION_TRACE_VERSION;
  events: TraceEvent[];
  /** Events dropped past the cap, counted so truncation is never silent. */
  dropped: number;
}

/** Bounded so a checkpoint stays small; the table mirror keeps everything. */
export const MISSION_TRACE_CAP = 2000;

export function newMissionTrace(): MissionTrace {
  return { version: MISSION_TRACE_VERSION, events: [], dropped: 0 };
}

export function appendTrace(
  trace: MissionTrace,
  type: TraceEventType,
  detail: Record<string, unknown>,
  refs: { plan_version?: number | null; provider_call_id?: string | null; idempotency_key?: string | null } = {},
  now: () => Date = () => new Date(),
): TraceEvent {
  const last = trace.events[trace.events.length - 1];
  const event: TraceEvent = Object.freeze({
    seq: (last?.seq ?? trace.dropped) + 1,
    at: now().toISOString(),
    type,
    plan_version: refs.plan_version ?? null,
    provider_call_id: refs.provider_call_id ?? null,
    idempotency_key: refs.idempotency_key ?? null,
    detail: Object.freeze({ ...detail }),
  }) as TraceEvent;
  trace.events.push(event);
  if (trace.events.length > MISSION_TRACE_CAP) {
    trace.events.shift();
    trace.dropped++;
  }
  return event;
}

export function traceOf(t: MissionTrace | null | undefined, type?: TraceEventType): TraceEvent[] {
  return (t?.events ?? []).filter((e) => !type || e.type === type);
}

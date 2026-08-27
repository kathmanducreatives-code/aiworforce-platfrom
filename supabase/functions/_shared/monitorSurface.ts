// TURNING "KEEP WATCHING THAT" INTO A SUBJECT THE SCHEDULER OWNS.
//
// ── WHY THIS IS NOT A RUN ──────────────────────────────────────────────────
//
// `monitor` is the only spending objective that buys nothing at the moment it
// is asked. It records an intention; `run-monitoring-tick` decides when that
// intention costs money, subject to its own cadence and period ceiling. So this
// module writes one row and stops — it never starts a scan, and a request to
// watch something must not quietly become a request to search for it now.
//
// ── WHAT IT REFUSES ────────────────────────────────────────────────────────
//
// A subject with no identity. "Keep watching them" with no resolved referent is
// already stopped upstream by blocking ambiguity, but a monitor request that
// arrives here without a nameable subject is refused rather than guessed —
// creating a subject for the wrong company would spend on it every cadence
// period, forever, unattended. That is the most expensive shape of the
// wrong-entity mistake.
//
// ── AND WHY THE EXISTING SCHEDULER IS UNTOUCHED ────────────────────────────
//
// `monitoring_subjects` already has a claim lease, a cadence and a period
// ceiling, and `run-monitoring-tick` already enforces all three. Phase D adds a
// way to CREATE a subject from chat; it does not add a second scheduler, and it
// deliberately does not set `cadence_minutes` — the column default is the
// workspace's policy, and overriding it from a chat message would let one
// sentence change unattended spend.

import type { RequestV1, RequestPart } from "./requestV1.ts";
import { isSignalEvent } from "./missionSignalDescriptor.ts";
import type { ResolvedReferentBinding } from "./referentBinding.ts";

export const MONITOR_SURFACE_VERSION = "monitor-surface-v1" as const;

export interface MonitorPlan {
  version: typeof MONITOR_SURFACE_VERSION;
  /** What to watch. Null when the request named nothing watchable. */
  subject: { kind: "company"; identifier: string; label: string } | null;
  /** Which events to watch for. Empty means "any", which the scanner allows. */
  signals: string[];
  timeframe_days: number | null;
  refusal: "no_subject" | "not_monitorable" | null;
}

/**
 * What would this request watch?
 *
 * Pure and total. A request with no nameable subject is refused here, before a
 * row exists — an unattended recurring spend against the wrong company is the
 * worst outcome this surface can produce.
 */
export function planMonitor(
  request: RequestV1,
  /**
   * The bindings the RESOLVER produced for this request, if any.
   *
   * Optional so every existing caller is unaffected; supplied, they are the
   * only source of an exact identity this function will accept.
   */
  bindings: readonly ResolvedReferentBinding[] = [],
): MonitorPlan {
  const base = {
    version: MONITOR_SURFACE_VERSION, signals: [] as string[],
    timeframe_days: null as number | null,
  };
  const part: RequestPart | undefined = request.parts.find((p) => p.objective === "monitor");
  if (!part) return { ...base, subject: null, refusal: "not_monitorable" };
  if (part.subject.entity !== "company" && part.subject.entity !== "person") {
    return { ...base, subject: null, refusal: "not_monitorable" };
  }

  const ref = (part.subject.references ?? [])[0];
  const named = (part.subject.filters ?? [])
    .find((f) => f.field === "company_name");

  // ── THE BINDING IS THE IDENTITY. `resolved_key` IS NOT. ──────────────────
  //
  // This read `ref.resolved_key` first, and `resolved_key` arrives from the
  // MODEL: `parseRequestStrict` copies it verbatim off whatever the model
  // returned. So a model that emitted a plausible-looking key decided which
  // real company this workspace pays to watch, every cadence period, forever
  // — the precise authority the binding sidecar exists to take away from it,
  // and the one asserted by "a forged resolved_key is ignored".
  //
  // A binding is produced by `resolveReferents` from records the system itself
  // wrote, using `resolveCompanyIdentity`. Its domain or canonical LinkedIn URL
  // is what `monitoring_subjects.identifier` is documented to hold, and its
  // `entity_key` is never a bare name — weak dedupe kinds do not bind.
  const bound = bindings.find((b) => b.part_id === part.id && b.entity_type === "company");
  const boundIdentifier = bound
    ? (bound.identity.canonicalDomain ?? bound.identity.linkedinUrl)
    : null;

  // Without a binding the user's own words stand, exactly as before — a NAMED
  // company the user typed is their statement, not the model's inference.
  const identifier = boundIdentifier
    ?? (ref ? ref.value : null)
    ?? (Array.isArray(named?.value) ? String(named!.value[0]) : null);
  if (!identifier) return { ...base, subject: null, refusal: "no_subject" };

  const signals = [...new Set((part.requirements ?? [])
    .map((r) => String(r.event)).filter(isSignalEvent))];
  const timeframe = (part.requirements ?? [])
    .map((r) => r.recency_days).find((d) => typeof d === "number" && d > 0) ?? null;

  return {
    ...base,
    subject: {
      kind: "company", identifier,
      // The label is what to CALL it, never what identifies it. A binding
      // carries the label the user was shown; otherwise their own words.
      label: bound?.label ?? ref?.value ?? identifier,
    },
    signals, timeframe_days: timeframe, refusal: null,
  };
}

export interface MonitorDb {
  // deno-lint-ignore no-explicit-any
  from: (table: string) => any;
}

export interface MonitorOutcome {
  created: boolean;
  /** True when the subject already existed and was left as it was. */
  already_watching: boolean;
  label: string;
  error: string | null;
}

/**
 * Record the intention.
 *
 * IDEMPOTENT BY IDENTIFIER. Asking twice to watch the same company must not
 * produce two subjects, because the scheduler would then scan it twice every
 * period — a duplicate row is duplicate unattended spend.
 */
export async function executeMonitor(
  db: MonitorDb, plan: MonitorPlan, workspaceId: string,
): Promise<MonitorOutcome> {
  if (!plan.subject) {
    return { created: false, already_watching: false, label: "",
      error: plan.refusal ?? "no_subject" };
  }
  const { identifier, label, kind } = plan.subject;
  try {
    const { data: existing } = await db.from("monitoring_subjects")
      .select("id, enabled")
      .eq("workspace_id", workspaceId).eq("identifier", identifier)
      .maybeSingle();
    if (existing?.id) {
      return { created: false, already_watching: true, label, error: null };
    }
    const { error } = await db.from("monitoring_subjects").insert({
      workspace_id: workspaceId,
      subject_kind: kind,
      identifier,
      label,
      signals: plan.signals,
      timeframe_days: plan.timeframe_days,
      enabled: true,
      // `cadence_minutes` DELIBERATELY UNSET — see the header. The column
      // default is workspace policy; a chat message must not change how often
      // money is spent unattended.
    });
    if (error) {
      return { created: false, already_watching: false, label, error: String(error) };
    }
    return { created: true, already_watching: false, label, error: null };
  } catch (e) {
    return { created: false, already_watching: false, label, error: String(e) };
  }
}

// ONE OUTSTANDING READ, HOWEVER MANY THINGS ASK FOR ONE.
//
// `usePlanDetail` re-reads a plan from four independent triggers: a 4-second
// heartbeat, every realtime event, a refocus, and an explicit refresh. Each read
// fans out to five queries. None of them waited for the previous read to
// finish.
//
// While the backend answers in milliseconds that is invisible. When it does
// not, it is the whole failure: five more connections every four seconds, each
// held for as long as the backend takes, forever. PostgREST's pool is small, so
// one Workbench tab pinned to a plan that never finalised filled it — and every
// other request, including loading the chat list and sending a message, then
// queued behind reads nobody was still waiting for and came back as an upstream
// timeout. A slow database is survivable; a client that answers slowness by
// issuing more work turns it into an outage.
//
// So: a read in flight absorbs the calls that arrive during it, and they
// collapse into exactly ONE follow-up read afterwards. Not zero — the whole
// point of a trigger is that something changed, and dropping it would leave the
// UI stale until the next heartbeat. Not N — the caller asked "re-read", not
// "re-read once per event", and the reads are idempotent, so a single fresh
// read satisfies every request that arrived while the last one ran.
//
// Latency under load therefore becomes the backend's response time rather than
// an unbounded queue, and concurrency stays at one no matter the trigger rate.
export interface CoalescedLoader {
  /** Read now, or fold into the read already running. Never rejects. */
  (): Promise<void>;
  /** True while a read is outstanding. For tests and diagnostics. */
  readonly busy: () => boolean;
}

export interface CoalesceOptions {
  /**
   * Checked between reads. A component that unmounted mid-read must not start
   * the follow-up its own heartbeat queued moments earlier.
   */
  isCancelled?: () => boolean;
  /** Reported, never rethrown — see `coalesceLoads`. */
  onError?: (e: unknown) => void;
}

/**
 * Wrap a read so that concurrent callers share one execution.
 *
 * NEVER REJECTS. Callers are timers, realtime handlers and event listeners,
 * none of which can handle a rejection — an unhandled one from a `setInterval`
 * is invisible in production and kills nothing useful. A failed read is
 * reported through `onError` and the next trigger simply tries again, which is
 * the correct recovery for a transient backend failure and the reason the
 * heartbeat exists at all.
 */
export function coalesceLoads(
  read: () => Promise<void>, opts: CoalesceOptions = {},
): CoalescedLoader {
  let inFlight = false;
  let pending = false;

  const run = async (): Promise<void> => {
    if (inFlight) {
      // Absorbed. The read already running does not yet reflect whatever
      // triggered this call, so exactly one more is queued behind it.
      pending = true;
      return;
    }
    inFlight = true;
    try {
      do {
        // Cleared BEFORE the read, not after: a trigger that arrives while this
        // read is running must still queue a follow-up, because this read may
        // already have fetched its rows by then.
        pending = false;
        try {
          await read();
        } catch (e) {
          opts.onError?.(e);
        }
      } while (pending && !opts.isCancelled?.());
    } finally {
      // A throw that escaped the inner catch must not leave the loader wedged
      // shut, or the heartbeat stops for the rest of the component's life —
      // which would be a worse failure than the one this fixes.
      inFlight = false;
      pending = false;
    }
  };

  const loader = run as CoalescedLoader;
  Object.defineProperty(loader, "busy", { value: () => inFlight });
  return loader;
}

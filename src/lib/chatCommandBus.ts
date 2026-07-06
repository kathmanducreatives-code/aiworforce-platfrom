// Buffered chat command bus.
//
// Card actions on the Signals and Content pages send a command to Pilot by
// dispatching a `chat:send` window event. The only listener for that event lives
// inside ChatComposerPro, which is unmounted whenever the chat workspace is
// closed (the default state). So on those pages, clicking an action used to fire
// an event into the void and still toast "Sent to Pilot" — a silent no-op.
//
// This bus fixes that: a command is buffered when no listener is mounted, the
// caller opens the chat (via the registered opener), and the buffered command is
// flushed to the composer the instant it subscribes. `dispatchAgentCommand`
// resolves true only once a mounted listener has accepted the command, so the UI
// can toast success/failure honestly.
//
// Pure module: no React, no DOM, no `@/` imports — unit-testable under Deno.

export interface ChatCommandPayload {
  text: string;
  conversation_id?: string | null;
  action_source?: string;
  metadata?: Record<string, unknown>;
}

type Handler = (p: ChatCommandPayload) => void;

interface Queued {
  payload: ChatCommandPayload;
  resolve: () => void;
}

let handler: Handler | null = null;
let queue: Queued[] = [];
let opener: (() => void) | null = null;

/** Register the function that opens/mounts the chat workspace (null to clear). */
export function setChatOpener(fn: (() => void) | null): void {
  opener = fn;
}

/** True when a chat listener (ChatComposerPro) is currently mounted. */
export function hasChatListener(): boolean {
  return handler !== null;
}

/**
 * Subscribe the chat composer. Flushes any buffered commands immediately.
 * Returns an unsubscribe fn that only clears the handler if it is still us
 * (safe under React StrictMode's mount → unmount → mount cycle).
 */
export function subscribeChatCommand(fn: Handler): () => void {
  handler = fn;
  if (queue.length) {
    const pending = queue;
    queue = [];
    for (const q of pending) {
      fn(q.payload);
      q.resolve();
    }
  }
  return () => {
    if (handler === fn) handler = null;
  };
}

/**
 * Send a command with guaranteed-delivery semantics. If no listener is mounted,
 * open the chat and buffer the command until the composer subscribes. Resolves
 * true when a mounted listener accepted it, false if nothing consumed it within
 * `timeoutMs` (in which case the command is dropped, not delivered late).
 */
export function dispatchAgentCommand(
  payload: ChatCommandPayload,
  opts: { ensureOpen?: () => void; timeoutMs?: number } = {},
): Promise<boolean> {
  if (handler) {
    handler(payload);
    return Promise.resolve(true);
  }
  const openFn = opts.ensureOpen ?? opener;
  openFn?.();
  const timeoutMs = opts.timeoutMs ?? 6000;
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const entry: Queued = {
      payload,
      resolve: () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(true);
      },
    };
    queue.push(entry);
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const i = queue.indexOf(entry);
      if (i >= 0) queue.splice(i, 1);
      resolve(false);
    }, timeoutMs);
  });
}

/** Test-only: reset all bus state. */
export function __resetChatCommandBus(): void {
  handler = null;
  queue = [];
  opener = null;
}

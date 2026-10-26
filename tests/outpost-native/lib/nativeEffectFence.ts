// Test transport only. Never imported by application code or used as authorization.
// Runtime tests must also keep Deno's network permission restricted to loopback.
export interface EffectEvent {
  readonly kind:
    | "local_request"
    | "external_attempt"
    | "cancelled"
    | "after_scope"
    | "invalid_request";
  readonly method: string;
  readonly origin: string | null;
}
export function nativeEffectFence(
  origins: readonly string[],
  delegate: typeof fetch,
) {
  const allowed = new Set(origins.map((origin) => {
    let u: URL;
    try {
      u = new URL(origin);
    } catch {
      throw new Error(
        "effect fence requires exact disposable loopback origins",
      );
    }
    if (
      u.protocol !== "http:" ||
      !["127.0.0.1", "localhost"].includes(u.hostname) ||
      !u.port || u.username || u.password || u.pathname !== "/" || u.search ||
      u.hash
    ) {
      throw new Error(
        "effect fence requires exact disposable loopback origins",
      );
    }
    return u.origin;
  }));
  if (!allowed.size) {
    throw new Error("effect fence requires a disposable origin");
  }
  const events: EffectEvent[] = [];
  const scope = new AbortController();
  let closed = false;
  const record = (
    kind: EffectEvent["kind"],
    method: string,
    origin: string | null,
  ) => events.push(Object.freeze({ kind, method, origin }));
  const guarded: typeof fetch = async (input, init) => {
    let request: Request, origin: string;
    try {
      request = new Request(input, init);
      origin = new URL(request.url).origin;
    } catch {
      record("invalid_request", "UNKNOWN", null);
      throw new Error("effect fence refused invalid request");
    }
    if (closed) {
      record("after_scope", request.method, origin);
      throw new Error("effect fence scope closed");
    }
    if (!allowed.has(origin)) {
      record("external_attempt", request.method, origin);
      throw new Error("effect fence refused external request");
    }
    if (request.signal.aborted) {
      record("cancelled", request.method, origin);
      throw new DOMException("request already aborted", "AbortError");
    }
    record("local_request", request.method, origin);
    // A local redirect must not silently escape the approved disposable origin.
    // Cancellation prevents further HTTP work; it does NOT prove DB rollback.
    return await delegate(
      new Request(request, {
        redirect: "error",
        signal: AbortSignal.any([request.signal, scope.signal]),
      }),
    );
  };
  return {
    fetch: guarded,
    close() {
      closed = true;
      scope.abort();
    },
    snapshot(): readonly EffectEvent[] {
      return Object.freeze(events.map((e) => Object.freeze({ ...e })));
    },
  };
}

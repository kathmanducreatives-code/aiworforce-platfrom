// Import this BEFORE an edge function's index.ts: the module's own
// `Deno.serve(handler)` is captured instead of listening, so a test calls the
// ACTUAL handler in process. Call restoreServe() once the handler(s) are imported.
export type EdgeHandler = (request: Request) => Response | Promise<Response>;
export const captured: EdgeHandler[] = [];

const original = Object.getOwnPropertyDescriptor(Deno, "serve")!;
Object.defineProperty(Deno, "serve", {
  configurable: true,
  writable: true,
  value: (...args: unknown[]) => {
    const handler = args.find((a) => typeof a === "function") as EdgeHandler | undefined;
    if (!handler) throw new Error("captureServe: Deno.serve called without a handler");
    captured.push(handler);
    return { finished: Promise.resolve(), shutdown: () => Promise.resolve(), ref() {}, unref() {} };
  },
});

export function restoreServe(): void {
  Object.defineProperty(Deno, "serve", original);
}

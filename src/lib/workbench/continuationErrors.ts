// WHAT THE USER ACTUALLY READS WHEN A CONTINUATION FAILS.
//
// Split out of `continueWorkflow.ts` so it can be imported and tested WITHOUT
// pulling in the Supabase client. The `@/` alias does not resolve under Deno, so
// a pure helper living beside a client import is a helper no test can call —
// the same trap that once made `credits.ts` untestable.
//
// PURE. No network, no client, no secrets.

/**
 * A message the user can act on, from the status and backend code.
 *
 * "Edge Function returned a non-2xx status code" is what
 * `supabase.functions.invoke` reports when it never reads the response body. It
 * is true and useless: the first failed click returned a 403 carrying an exact
 * reason, and none of it reached the screen.
 *
 * Nothing here echoes a token, a SQL detail or a service value — only the status
 * and the backend's own safe error code.
 */
export function describeContinuationError(
  status: number | null | undefined, code?: string | null, backendMessage?: string | null,
): string {
  if (code === 'already_continued') return 'This workflow has already been continued.';
  if (code === 'would_start_new_actor') {
    return 'The continuation could not start. No paid work was launched.';
  }
  switch (status) {
    case 401: return 'Your session expired. Sign in again and retry.';
    case 403: return backendMessage ?? 'You do not have access to continue this workflow.';
    case 404: return backendMessage ?? 'The original workflow could not be found.';
    case 409: return backendMessage ?? 'This workflow already has a continuation or is no longer eligible.';
    case 400: return backendMessage ?? 'That continuation request was not valid.';
    case 502:
    case 500: return 'The continuation could not start. No paid work was launched.';
    default:  return backendMessage ?? 'The continuation could not start. No paid work was launched.';
  }
}

/** Read the JSON body `functions.invoke` leaves unread on a non-2xx response. */
export async function readErrorBody(
  error: unknown,
): Promise<{ status: number | null; code: string | null; message: string | null; requestId: string | null }> {
  const ctx = (error as { context?: unknown })?.context;
  if (ctx instanceof Response) {
    const requestId = ctx.headers.get('x-request-id') ?? ctx.headers.get('sb-request-id');
    try {
      const body = await ctx.clone().json() as { error?: string; message?: string };
      return {
        status: ctx.status,
        code: body?.error ?? null,
        message: body?.message ?? null,
        requestId,
      };
    } catch {
      return { status: ctx.status, code: null, message: null, requestId };
    }
  }
  return { status: null, code: null, message: null, requestId: null };
}


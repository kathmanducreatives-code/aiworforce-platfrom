// THE SERVER'S REASON FOR A FAILED EDGE-FUNCTION CALL.
//
// supabase-js reports every non-2xx as "Edge Function returned a non-2xx status
// code". The function's own `{ error, detail }` — "workspace model spend ceiling
// reached", OpenAI's "no credits remaining" — rides on `error.context`, a
// Response. Without reading it, a user is told nothing about why a call failed.
//
// PURE: no client, no React. Deno-testable.

/** `detail ?? error` from a failed edge-function response, or null. */
export async function functionErrorDetail(error: unknown): Promise<string | null> {
  const ctx = (error as { context?: unknown } | null)?.context as
    { clone?: () => { json: () => Promise<unknown> }; json?: () => Promise<unknown> } | undefined;
  if (!ctx) return null;
  try {
    const body = (await (ctx.clone ? ctx.clone().json() : ctx.json?.())) as
      { detail?: unknown; error?: unknown } | undefined;
    if (typeof body?.detail === 'string' && body.detail) return body.detail;
    if (typeof body?.error === 'string' && body.error) return body.error;
    return null;
  } catch {
    return null;
  }
}

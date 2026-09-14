// Pure decision logic behind ProtectedRoute's redirect rules.
//
// Extracted so the auth gate, the onboarding gate, and return-path capture
// can be unit tested without mounting React or touching the DOM — this repo
// has no jsdom/testing-library dependency, so a testable ProtectedRoute means
// a ProtectedRoute that is a thin renderer over a plain function.
//
// Recovered (2026-09) from the "return to where you came from" + "gate
// onboarding-incomplete users into /onboarding/company-brain" behavior that
// existed, uncommitted, in the `remix-of-remix-of-screeningpilot` worktree —
// reimplemented against the CURRENT auth/onboarding architecture rather than
// copied, since the old ProtectedRoute predates both `useCompanyBrain` and
// this file's `?next=` convention (already used by src/pages/Auth.tsx).

const BLOCKED_RETURN_PREFIXES = ['/auth', '/onboarding/company-brain'];

/**
 * Validates a same-origin, relative return path before it's ever used as a
 * redirect target. Mirrors the inline `safeNext` guard already in
 * src/pages/Auth.tsx: must be relative (no scheme, no protocol-relative
 * `//host`), and must not point back at /auth or the onboarding flow itself
 * (which would otherwise be able to produce a redirect loop).
 */
export function safeReturnPath(path: string | null | undefined): string | null {
  if (!path) return null;
  if (!path.startsWith('/') || path.startsWith('//')) return null;
  if (BLOCKED_RETURN_PREFIXES.some((prefix) => path.startsWith(prefix))) return null;
  return path;
}

/** Appends a validated return path as `?next=`, or returns basePath unchanged. */
export function withReturnPath(basePath: string, returnPath: string | null): string {
  return returnPath ? `${basePath}?next=${encodeURIComponent(returnPath)}` : basePath;
}

export type RouteGuardDecision =
  | { type: 'loading' }
  | { type: 'redirect'; to: string }
  | { type: 'render' };

export interface RouteGuardState {
  /** useAuth().loading */
  authLoading: boolean;
  /** useAuth().user */
  user: unknown | null;
  /** false only for the onboarding route itself, so it can't gate-redirect to itself. */
  requireOnboarding: boolean;
  /** useCompanyBrain().loading */
  onboardingLoading: boolean;
  /**
   * useCompanyBrain().data?.onboarding_completed.
   * `null` means "unknown" (no data yet, or the read failed) — treated as
   * fail-open (render) rather than trapping a user behind a broken gate.
   */
  onboardingCompleted: boolean | null;
  pathname: string;
  search: string;
}

/** The single source of truth for what ProtectedRoute renders. */
export function decideRouteGuard(state: RouteGuardState): RouteGuardDecision {
  if (state.authLoading) return { type: 'loading' };

  if (!state.user) {
    const next = safeReturnPath(state.pathname + state.search);
    return { type: 'redirect', to: withReturnPath('/auth', next) };
  }

  if (state.requireOnboarding) {
    if (state.onboardingLoading) return { type: 'loading' };
    if (state.onboardingCompleted === false) {
      const next = safeReturnPath(state.pathname + state.search);
      return { type: 'redirect', to: withReturnPath('/onboarding/company-brain', next) };
    }
  }

  return { type: 'render' };
}

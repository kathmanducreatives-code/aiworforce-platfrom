// Which Supabase project is this build actually talking to?
//
// The audit found the frontend/CLI targeting PROD (ohsdatpvfdjdemstoiuj) while
// the MCP/CLI tooling was pointed at TEST (ohsdatpvfdjdemstoiuj). This module
// makes the resolved project ref + environment name inspectable so an operator
// can verify the target before trusting a diagnostic — and refuse to treat TEST
// as production.
//
// Canonical refs are declared here for INTERNAL diagnostics/validation only.
// They are never rendered as customer-facing copy.
//
// Pure — no network. Reads only the already-public Vite env values.

/**
 * SINGLE-PROJECT DEPLOYMENT. Both keys hold the SAME ref, deliberately.
 *
 * Agentory previously ran two projects, and this map existed to stop one being
 * mistaken for the other — the audit that created it found the frontend talking
 * to production while the tooling talked to test. As of the migration to
 * `ohsdatpvfdjdemstoiuj` there is one project serving both roles, so that
 * particular confusion is no longer possible: there is nowhere else to send a
 * request.
 *
 * The map is kept rather than collapsed because the guard it feeds is still
 * worth having, and its meaning has simply changed. It no longer answers "is
 * this test or production" — it answers "is this the project we are supposed to
 * be talking to at all", which is the question that matters while two abandoned
 * projects still exist and still accept credentials.
 *
 * Resolution order puts `production` first, so a ref matching both classifies as
 * production. That is correct: with one live project, everything IS production.
 * No behaviour is lost — every capability in `capabilityRegistry` is enabled for
 * all environments, so nothing was ever test-only.
 */
export const CANONICAL_PROJECT_REFS = {
  production: "ohsdatpvfdjdemstoiuj",
  test: "ohsdatpvfdjdemstoiuj",
} as const;

export type ProjectEnvironmentName = "production" | "test" | "unknown";

export interface ProjectEnvironment {
  /** The Supabase project ref the client is configured to use. */
  projectRef: string | null;
  /** Classified against the canonical refs — never inferred from a var name. */
  environment: ProjectEnvironmentName;
  /** The Supabase URL host, for display. */
  supabaseUrlHost: string | null;
  /** Build/source version when the bundler injected one (never a secret). */
  buildSha: string | null;
}

/** Extract a project ref from a Supabase URL like https://<ref>.supabase.co. */
export function projectRefFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /^https?:\/\/([a-z0-9]+)\.supabase\.(co|in|net)/i.exec(url.trim());
  return m ? m[1].toLowerCase() : null;
}

export function classifyEnvironment(projectRef: string | null): ProjectEnvironmentName {
  if (projectRef === CANONICAL_PROJECT_REFS.production) return "production";
  if (projectRef === CANONICAL_PROJECT_REFS.test) return "test";
  return "unknown";
}

/**
 * Resolve the current environment from an env bag (defaults to import.meta.env).
 * Accepts an explicit bag so it is unit-testable without a bundler.
 */
export function resolveProjectEnvironment(
  env: Record<string, string | undefined> = readViteEnv(),
): ProjectEnvironment {
  const url = env.VITE_SUPABASE_URL ?? null;
  const projectRef =
    env.VITE_SUPABASE_PROJECT_ID?.trim() ||
    projectRefFromUrl(url) ||
    // Fall back to the production default baked into the generated client.
    CANONICAL_PROJECT_REFS.production;

  let supabaseUrlHost: string | null = null;
  try { if (url) supabaseUrlHost = new URL(url).host; } catch { /* ignore */ }

  return {
    projectRef,
    environment: classifyEnvironment(projectRef),
    supabaseUrlHost,
    buildSha: env.VITE_BUILD_SHA?.trim() || env.VITE_COMMIT_SHA?.trim() || null,
  };
}

function readViteEnv(): Record<string, string | undefined> {
  // `import.meta.env` exists under Vite; guard so the module also imports under
  // a plain Node/test context.
  try {
    return (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  } catch {
    return {};
  }
}

export class TestTreatedAsProductionError extends Error {
  constructor(public readonly projectRef: string | null) {
    super(`Refusing to treat the TEST project (${projectRef}) as production.`);
    this.name = "TestTreatedAsProductionError";
  }
}

/**
 * Guard for any code path that intends to act on PRODUCTION. Throws if the
 * resolved project is the known TEST ref, so a mis-pointed environment cannot
 * silently run a production-only action against TEST (or vice-versa).
 */
export function assertEnvironmentIs(
  expected: Exclude<ProjectEnvironmentName, "unknown">,
  env?: Record<string, string | undefined>,
): ProjectEnvironment {
  const resolved = resolveProjectEnvironment(env);
  if (expected === "production" && resolved.projectRef === CANONICAL_PROJECT_REFS.test) {
    throw new TestTreatedAsProductionError(resolved.projectRef);
  }
  if (resolved.environment !== expected) {
    throw new Error(
      `Environment mismatch: expected ${expected}, resolved ${resolved.environment} (${resolved.projectRef}).`,
    );
  }
  return resolved;
}

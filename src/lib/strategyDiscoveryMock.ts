// DEVELOPMENT-ONLY simulation of lead-pipeline for the Workbench (MRLE).
//
// Active only when BOTH hold: a Vite development build (import.meta.env.DEV) and
// VITE_STRATEGY_DISCOVERY_MOCK is 'true' (ready plan → run) or 'blocked' (a REQUIRED
// requirement no tool can check → review-only re-plan). A production build never enables it.
//
// The responses are NOT hand-written: scripts/dev/mrle-simulation.ts produced them from the
// real lead-pipeline service with mocked providers (synthetic .example companies). The panel
// labels everything from here "Simulated data". No network call is made.

import type { Invoke } from './strategyDiscovery';

/** The generated simulation (src/lib/__fixtures__/strategyDiscoverySimulation.json). */
export interface Simulation { simulated: true; plan: Canned; run: Canned; blockedPlan: Canned; reviewOnlyPlan: Canned }

export type MockMode = 'off' | 'ready' | 'blocked';

export function strategyDiscoveryMockMode(env: Record<string, unknown> = (import.meta as { env?: Record<string, unknown> }).env ?? {}): MockMode {
  if (env.DEV !== true) return 'off';
  return env.VITE_STRATEGY_DISCOVERY_MOCK === 'true' ? 'ready' : env.VITE_STRATEGY_DISCOVERY_MOCK === 'blocked' ? 'blocked' : 'off';
}

export type Canned = { status: number; body: unknown };
const respond = <T>(c: Canned): { data: T | null; error: (Error & { context?: Response }) | null } =>
  c.status < 300 ? { data: c.body as T, error: null }
    : { data: null, error: Object.assign(new Error(`HTTP ${c.status}`), { context: new Response(JSON.stringify(c.body), { status: c.status }) }) };

/** An `Invoke` that answers from the generated simulation, after a short delay. */
export function simulatedInvoke(mode: Exclude<MockMode, 'off'>, simulation: Simulation, delayMs = 500): Invoke {
  return (async <T,>(name: string, body: unknown) => {
    await new Promise((r) => setTimeout(r, delayMs));
    const b = (body ?? {}) as { action?: string; allow_review_only?: boolean };
    if (name !== 'lead-pipeline') return respond<T>({ status: 404, body: { error: 'not simulated' } });
    if (b.action === 'strategy_plan') {
      if (mode === 'blocked') return respond<T>(b.allow_review_only ? simulation.reviewOnlyPlan : simulation.blockedPlan);
      return respond<T>(simulation.plan);
    }
    if (b.action === 'strategy_run') return respond<T>(simulation.run);
    return respond<T>({ status: 400, body: { error: 'unknown action' } });
  }) as Invoke;
}

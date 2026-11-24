// Live provider tests are CLOSED by default (LeadOcean evaluation closed 2026-10-31).
//
// Every script that can spend provider records or money calls `assertLiveTestsEnabled`
// before its first metered request. It passes only when the operator sets
// AGENTORY_PROVIDER_LIVE_TESTS=enabled for that one invocation — in addition to the
// script's own exact approval string, lock and ledger. Dry runs and free checks are unaffected.

export const LIVE_TEST_ENV = "AGENTORY_PROVIDER_LIVE_TESTS";

export class LiveTestsClosed extends Error { override name = "LiveTestsClosed"; }

export function assertLiveTestsEnabled(env: (k: string) => string | undefined = (k) => Deno.env.get(k)): void {
  if (env(LIVE_TEST_ENV) !== "enabled") {
    throw new LiveTestsClosed(`refused: live provider tests are closed by default — set ${LIVE_TEST_ENV}=enabled for an explicitly approved run`);
  }
}

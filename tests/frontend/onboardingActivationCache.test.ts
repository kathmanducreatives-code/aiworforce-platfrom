// WHY THIS FILE EXISTS.
//
// Completing Company Brain onboarding showed the dashboard for a moment and
// then bounced straight back to onboarding, over and over.
//
// Nothing was broken in the database: `onboarding_completed` was true, the
// timestamp was set, the profile held 23 keys. The bug was entirely on the
// client. `useCompanyBrain` caches the row with a five-minute `staleTime` and
// `refetchOnWindowFocus: false` — both deliberate, and both right for a value
// that changes approximately never. But it DOES change once, at activation, and
// nothing told the cache.
//
// So `OnboardingGate` read its own stale `onboarding_completed: false`, decided
// the user had not onboarded, and redirected. The dashboard was visible for the
// instant between navigation and the gate's decision, which made a
// straightforward stale read look like a loop.
//
// The shape of this bug is worth naming: a write that reaches the database and
// not the cache is invisible to every backend test, every typecheck and every
// integration check that talks to Postgres. It can only be caught on the client
// side of the boundary, which is where this test lives.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const ROOT = new URL("../../", import.meta.url);
const read = (p: string) => Deno.readTextFile(new URL(p, ROOT));

const ONBOARDING = await read("src/pages/OnboardingCompanyBrain.tsx");
const HOOK = await read("src/hooks/useCompanyBrain.ts");
const GATE = await read("src/components/OnboardingGate.tsx");

Deno.test("1. activation invalidates the cached brain before navigating", () => {
  // The fix itself. Without this line the gate reads a five-minute-old `false`
  // and sends the user back where they came from.
  assert(
    /invalidateQueries\(\s*\{\s*queryKey:\s*companyBrainKey\(/.test(ONBOARDING),
    "activation must invalidate companyBrainKey, or the gate reads a stale row",
  );

  // ORDER MATTERS. Invalidating after `navigate` races the gate: the query
  // refetches while the gate is already deciding, so the bounce still happens —
  // just intermittently, which is worse than reliably.
  const inval = ONBOARDING.indexOf("invalidateQueries");
  const nav = ONBOARDING.indexOf("navigate('/dashboard')");
  assert(inval > -1 && nav > -1);
  assert(inval < nav, "the cache must be invalidated BEFORE navigating, not after");
  assert(
    /await queryClient\.invalidateQueries/.test(ONBOARDING),
    "and awaited, so the refetch cannot race the gate",
  );
});

Deno.test("2. the invalidation is scoped to this workspace", () => {
  // `companyBrainKey` includes the workspace id precisely so one workspace's
  // cache can never serve another. Invalidating a bare key would blow away
  // every workspace's row, which is both wasteful and a way to leak one
  // workspace's loading state into another's screen.
  assert(
    /companyBrainKey\(workspaceId\)/.test(ONBOARDING),
    "invalidate the key for THIS workspace, not a bare prefix",
  );
});

Deno.test("3. the caching that made this possible is intentional, and stays", () => {
  // This test must not be read as "caching was the bug". The cache is why the
  // page no longer flashes a full-screen loader on every tab focus — a
  // regression the hook's own header describes at length. The fix is to notify
  // it, not to weaken it.
  assert(/staleTime:/.test(HOOK), "the brain read stays cached");
  assert(
    /refetchOnWindowFocus:\s*false/.test(HOOK),
    "focus must still not refetch — that was the original bug this hook fixed",
  );
});

Deno.test("4. the gate still refuses an incomplete brain", () => {
  // The fix must not have been "let everyone through". The redirect is correct
  // behaviour for a user who genuinely has not onboarded.
  assert(/onboarding_completed/.test(GATE));
  assert(/Navigate to="\/onboarding\/company-brain"/.test(GATE));
  // And the onboarding route itself must stay reachable, or a real
  // pre-onboarding user is redirected to a page that redirects them again.
  assert(
    /ALLOWED_PRE_ONBOARDING/.test(GATE) &&
      /'\/onboarding\/company-brain'/.test(GATE),
    "the onboarding route must be exempt from its own gate",
  );
});

Deno.test("5. every writer of the brain refreshes what reads it", () => {
  // The generalisation. Two places write this row — onboarding activation and
  // the settings editor — and a write that does not refresh is the same bug
  // again in a different screen.
  const dashboard = Deno.readTextFileSync(
    new URL("src/pages/CompanyBrainDashboard.tsx", ROOT),
  );
  assert(
    /\.from\('company_brain'\)[\s\S]{0,200}\.update\(/.test(dashboard),
    "the settings editor is expected to write the row",
  );
  assert(
    /refresh\(\)/.test(dashboard),
    "and must refresh after writing, or the page shows what it just replaced",
  );
});

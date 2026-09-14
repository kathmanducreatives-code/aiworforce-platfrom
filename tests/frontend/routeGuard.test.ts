// RECOVERED FEATURE: return-to-origin login + onboarding gate.
//
// ProtectedRoute previously did only one thing: bounce unauthenticated users
// to /auth. It never remembered where they were headed, and it never checked
// whether onboarding was complete — a returning user with an incomplete
// Company Brain could deep-link straight past onboarding into any protected
// route. This pins the fixed decision matrix.
//
// Pure. Zero network, zero React rendering — decideRouteGuard is a plain
// function so this exercises exactly what ProtectedRoute.tsx renders from.

import { assert, assertEquals, assertStrictEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { decideRouteGuard, safeReturnPath, withReturnPath, type RouteGuardState } from "../../src/lib/routeGuard.ts";

const baseState: RouteGuardState = {
  authLoading: false,
  user: { id: "u1" },
  requireOnboarding: true,
  onboardingLoading: false,
  onboardingCompleted: true,
  pathname: "/dashboard",
  search: "",
};

// ── auth gate: unauthenticated protected-route access ──────────────────────

Deno.test("unauthenticated user is redirected to /auth with the attempted path preserved", () => {
  const d = decideRouteGuard({ ...baseState, user: null, pathname: "/leads", search: "" });
  assertEquals(d, { type: "redirect", to: "/auth?next=%2Fleads" });
});

Deno.test("unauthenticated user's query string is preserved in the return path", () => {
  const d = decideRouteGuard({ ...baseState, user: null, pathname: "/leads", search: "?tab=icp" });
  assertEquals(d, { type: "redirect", to: "/auth?next=%2Fleads%3Ftab%3Dicp" });
});

Deno.test("auth still loading takes priority over everything else", () => {
  const d = decideRouteGuard({ ...baseState, authLoading: true, user: null, onboardingCompleted: false });
  assertEquals(d, { type: "loading" });
});

// ── login return path (the composed /auth?next=... / /onboarding?next=...) ─

Deno.test("withReturnPath appends an encoded ?next= when a return path is given", () => {
  assertEquals(withReturnPath("/auth", "/leads/find"), "/auth?next=%2Fleads%2Ffind");
});

Deno.test("withReturnPath returns the base path unchanged when there is nothing to return to", () => {
  assertEquals(withReturnPath("/auth", null), "/auth");
});

// ── normal authenticated navigation ─────────────────────────────────────────

Deno.test("authenticated + onboarded user renders the route normally", () => {
  const d = decideRouteGuard(baseState);
  assertEquals(d, { type: "render" });
});

Deno.test("a route that doesn't require onboarding renders even mid-auth-loading-free normal case", () => {
  const d = decideRouteGuard({ ...baseState, requireOnboarding: false, onboardingCompleted: true });
  assertEquals(d, { type: "render" });
});

// ── onboarding incomplete ───────────────────────────────────────────────────

Deno.test("onboarding-incomplete user is gated into /onboarding/company-brain with a return path", () => {
  const d = decideRouteGuard({ ...baseState, onboardingCompleted: false, pathname: "/leads", search: "" });
  assertEquals(d, { type: "redirect", to: "/onboarding/company-brain?next=%2Fleads" });
});

Deno.test("onboarding-incomplete user is NOT gated when the route opts out (the onboarding route itself)", () => {
  const d = decideRouteGuard({
    ...baseState,
    requireOnboarding: false,
    onboardingCompleted: false,
    pathname: "/onboarding/company-brain",
  });
  assertEquals(d, { type: "render" });
});

Deno.test("onboarding status still loading blocks render while it's required", () => {
  const d = decideRouteGuard({ ...baseState, onboardingLoading: true, onboardingCompleted: null });
  assertEquals(d, { type: "loading" });
});

Deno.test("unknown onboarding status (no row / failed read) fails OPEN rather than trapping the user", () => {
  const d = decideRouteGuard({ ...baseState, onboardingLoading: false, onboardingCompleted: null });
  assertEquals(d, { type: "render" });
});

// ── onboarding complete ─────────────────────────────────────────────────────

Deno.test("onboarding-complete user passes the gate straight through", () => {
  const d = decideRouteGuard({ ...baseState, onboardingCompleted: true, pathname: "/company-brain" });
  assertEquals(d, { type: "render" });
});

// ── malformed / unsafe return paths ─────────────────────────────────────────

Deno.test("safeReturnPath accepts an ordinary relative path", () => {
  assertEquals(safeReturnPath("/leads/find"), "/leads/find");
});

Deno.test("safeReturnPath accepts a relative path with a query string", () => {
  assertEquals(safeReturnPath("/leads?tab=icp"), "/leads?tab=icp");
});

Deno.test("safeReturnPath rejects null/undefined/empty", () => {
  assertStrictEquals(safeReturnPath(null), null);
  assertStrictEquals(safeReturnPath(undefined), null);
  assertStrictEquals(safeReturnPath(""), null);
});

Deno.test("safeReturnPath rejects an absolute URL (scheme-relative escape)", () => {
  assertStrictEquals(safeReturnPath("https://evil.example.com/phish"), null);
});

Deno.test("safeReturnPath rejects a protocol-relative URL (//host escapes same-origin)", () => {
  assertStrictEquals(safeReturnPath("//evil.example.com/phish"), null);
});

Deno.test("safeReturnPath rejects a javascript: URI", () => {
  assertStrictEquals(safeReturnPath("javascript:alert(1)"), null);
});

Deno.test("safeReturnPath rejects a path with no leading slash", () => {
  assertStrictEquals(safeReturnPath("leads/find"), null);
});

Deno.test("safeReturnPath rejects a loop back to /auth", () => {
  assertStrictEquals(safeReturnPath("/auth"), null);
  assertStrictEquals(safeReturnPath("/auth?next=%2Fdashboard"), null);
});

Deno.test("safeReturnPath rejects a loop back to onboarding", () => {
  assertStrictEquals(safeReturnPath("/onboarding/company-brain"), null);
});

Deno.test("a malformed attempted path never reaches decideRouteGuard's redirect target", () => {
  // pathname can't practically be unsafe (react-router supplies it), but the
  // gate must still degrade gracefully if search makes the composed value odd.
  const d = decideRouteGuard({ ...baseState, user: null, pathname: "/onboarding/company-brain", search: "" });
  // The attempted path itself resolves to a blocked prefix, so no ?next= is added.
  assertEquals(d, { type: "redirect", to: "/auth" });
});

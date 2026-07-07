import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  computeSourceStatuses,
  runnableSourceKeys,
  RADAR_SOURCES,
  type SourceStatus,
} from "./radarSources.ts";

function byKey(list: SourceStatus[]) {
  return Object.fromEntries(list.map((s) => [s.key, s]));
}

Deno.test("registry covers the six target sources + people", () => {
  const keys = RADAR_SOURCES.map((s) => s.key);
  for (const k of ["hiring", "linkedin_posts", "comments", "competitor", "funding", "workflow", "people"]) {
    assert(keys.includes(k as any), `missing source ${k}`);
  }
});

Deno.test("Firecrawl only → hiring/posts/funding/competitor/workflow runnable, comments/people not", () => {
  const s = byKey(computeSourceStatuses({ firecrawlReady: true, apifyReady: false }));
  assert(s.hiring.runnable);
  assertEquals(s.hiring.state, "ready_basic");
  assert(s.linkedin_posts.runnable);
  assert(s.funding.runnable);
  assert(s.competitor.runnable);
  assertEquals(s.competitor.state, "ready");
  assert(s.workflow.runnable);
  // No Firecrawl fallback:
  assert(!s.comments.runnable);
  assert(!s.people.runnable);
});

Deno.test("hiring is never reported blocked when Firecrawl is up (fallback honesty)", () => {
  const s = byKey(computeSourceStatuses({ firecrawlReady: true, apifyReady: false }));
  assert(!/blocked|unavailable/i.test(s.hiring.reason));
  assert(/Firecrawl/i.test(s.hiring.reason));
});

Deno.test("Apify ready → posts/comments/people become fully ready", () => {
  const s = byKey(computeSourceStatuses({ firecrawlReady: true, apifyReady: true }));
  assertEquals(s.linkedin_posts.state, "ready");
  assert(s.comments.runnable);
  assert(s.people.runnable);
});

Deno.test("no providers → nothing runnable, honest setup_needed", () => {
  const list = computeSourceStatuses({ firecrawlReady: false, apifyReady: false });
  assertEquals(runnableSourceKeys({ firecrawlReady: false, apifyReady: false }).length, 0);
  for (const s of list) assert(s.state === "setup_needed");
});

Deno.test("enable flag off → source not runnable", () => {
  const s = byKey(computeSourceStatuses({ firecrawlReady: true, apifyReady: true, flags: { funding: false } }));
  assertEquals(s.funding.state, "flag_off");
  assert(!s.funding.runnable);
});

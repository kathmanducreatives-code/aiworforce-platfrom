// Refresh is suggestion-based for confirmed / non-empty fields.
//
// No network, database, provider or model.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  computeBrainRefreshDiff,
  applyRefreshDiff,
  readPath,
  writePath,
  type RefreshDiffMeta,
} from "../../../supabase/functions/_shared/companyBrainRefreshDiff.ts";

const META: RefreshDiffMeta = { source: "company_website", source_role: "seller", confidence: 0.8 };
const PATHS = ["company.name", "company.website_url", "positioning.offer", "content_angles"];

// 17. refresh can fill an empty field -------------------------------------------
Deno.test("17. an empty field is a fill_empty and auto-applies", () => {
  const current = { company: { name: "Agentory" } };
  const proposed = { company: { name: "Agentory", website_url: "https://agentory.space" } };
  const diffs = computeBrainRefreshDiff(current, proposed, PATHS, META);

  const site = diffs.find((d) => d.field_path === "company.website_url");
  assertEquals(site?.action, "fill_empty");

  const applied = applyRefreshDiff(current, diffs);
  assertEquals(readPath(applied.profile, "company.website_url"), "https://agentory.space");
  assert(applied.auto_filled.includes("company.website_url"));
});

// 16. refresh produces a suggestion for a non-empty field -----------------------
Deno.test("16/19. a non-empty field is a suggestion, never auto-applied", () => {
  const current = { company: { name: "Agentory" } };
  const proposed = { company: { name: "Goji" } };
  const diffs = computeBrainRefreshDiff(current, proposed, PATHS, META);

  const name = diffs.find((d) => d.field_path === "company.name");
  assertEquals(name?.action, "suggestion");

  const applied = applyRefreshDiff(current, diffs);
  // The manual value is preserved; the proposal is pending review.
  assertEquals(readPath(applied.profile, "company.name"), "Agentory");
  assertEquals(applied.pending.length, 1);
  assertEquals(applied.pending[0].proposed, "Goji");
});

// 14/15. a CONFIRMED field differing is a conflict, never overwritten -----------
Deno.test("14/15. a confirmed field with a differing proposal is a conflict", () => {
  const current = { company: { name: "Agentory" }, positioning: { offer: "AI workforce platform" } };
  const proposed = { company: { name: "Goji" }, positioning: { offer: "passive talent discovery" } };
  const diffs = computeBrainRefreshDiff(current, proposed, PATHS, {
    ...META,
    confirmed_paths: ["company.name", "positioning.offer"],
  });

  assertEquals(diffs.find((d) => d.field_path === "company.name")?.action, "conflict");
  assertEquals(diffs.find((d) => d.field_path === "positioning.offer")?.action, "conflict");

  const applied = applyRefreshDiff(current, diffs);
  assertEquals(readPath(applied.profile, "company.name"), "Agentory");
  assertEquals(readPath(applied.profile, "positioning.offer"), "AI workforce platform");
  assertEquals(applied.auto_filled.length, 0);
});

// a confirmed EMPTY field is not auto-filled either -----------------------------
Deno.test("a confirmed field is never auto-filled even when empty", () => {
  const current = {};
  const proposed = { company: { name: "Goji" } };
  const diffs = computeBrainRefreshDiff(current, proposed, PATHS, { ...META, confirmed_paths: ["company.name"] });
  assertEquals(diffs.find((d) => d.field_path === "company.name")?.action, "conflict");
});

// unchanged / equal values produce nothing --------------------------------------
Deno.test("equal or empty proposals produce no diff", () => {
  const current = { company: { name: "Agentory" } };
  const proposed = { company: { name: "Agentory" }, positioning: { offer: "" } };
  const diffs = computeBrainRefreshDiff(current, proposed, PATHS, META);
  assertEquals(diffs.length, 0);
});

// writePath is immutable --------------------------------------------------------
Deno.test("writePath does not mutate the source object", () => {
  const src = { company: { name: "Agentory" } };
  const out = writePath(src, "company.website_url", "https://agentory.space");
  assertEquals((src.company as Record<string, unknown>).website_url, undefined);
  assertEquals(readPath(out, "company.website_url"), "https://agentory.space");
});

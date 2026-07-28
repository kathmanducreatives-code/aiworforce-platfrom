// The save/refresh BOUNDARY: origin decides what may actually change.
//
// No network, database, provider or model.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  resolveOriginAwareSave,
  isValidChangeOrigin,
  collectLeafPaths,
} from "./companyBrainOriginSave.ts";
import { readPath } from "./companyBrainRefreshDiff.ts";

const CONFIRMED_BRAIN = {
  company: { name: "Agentory", website_url: "https://agentory.space" },
  positioning: { offer: "AI workforce platform for GTM teams" },
};

// ---- manual edit is authoritative ---------------------------------------------
Deno.test("manual_edit applies the patch as-is (user is authoritative)", () => {
  const r = resolveOriginAwareSave({
    existing: CONFIRMED_BRAIN,
    patch: { company: { name: "Agentory Inc" } },
    origin: "manual_edit",
  });
  assert(r.ok);
  assertEquals(r.effective_origin, "manual_edit");
  assertEquals(readPath(r.safe_patch, "company.name"), "Agentory Inc");
});

// ---- automated refresh cannot overwrite a non-empty confirmed field -----------
Deno.test("automated_refresh does NOT overwrite a non-empty field", () => {
  const r = resolveOriginAwareSave({
    existing: CONFIRMED_BRAIN,
    patch: { company: { name: "Goji" }, positioning: { offer: "passive talent discovery" } },
    origin: "automated_refresh",
    sourceRole: "seller",
  });
  assert(r.ok);
  // Nothing applied (both fields already populated) → both are pending review.
  assertEquals(r.applied_paths.length, 0);
  assertEquals(readPath(r.safe_patch, "company.name"), undefined);
  assert(r.pending_review.some((d) => d.field_path === "company.name"));
});

// ---- automated refresh fills a genuinely empty field --------------------------
Deno.test("automated_refresh fills an EMPTY field", () => {
  const r = resolveOriginAwareSave({
    existing: { company: { name: "Agentory" } },
    patch: { company: { website_url: "https://agentory.space" } },
    origin: "automated_refresh",
    sourceRole: "seller",
  });
  assert(r.ok);
  assertEquals(readPath(r.safe_patch, "company.website_url"), "https://agentory.space");
  assert(r.applied_paths.includes("company.website_url"));
});

// ---- generic save (missing origin) is treated as automated_refresh ------------
Deno.test("a missing origin does NOT apply a full draft (defaults to automated_refresh)", () => {
  const r = resolveOriginAwareSave({
    existing: CONFIRMED_BRAIN,
    patch: { company: { name: "Goji", website_url: "https://gojiberry.ai" }, positioning: { offer: "passive talent discovery" } },
    origin: undefined,
    sourceRole: "seller",
  });
  assert(r.ok);
  assertEquals(r.effective_origin, "automated_refresh");
  // The confirmed name is not overwritten; nothing seller-identity changes.
  assertEquals(readPath(r.safe_patch, "company.name"), undefined);
  assertEquals(readPath(r.safe_patch, "positioning.offer"), undefined);
});

// ---- unknown/invalid explicit origin is rejected ------------------------------
Deno.test("an explicit INVALID origin is rejected", () => {
  const r = resolveOriginAwareSave({ existing: CONFIRMED_BRAIN, patch: { company: { name: "X" } }, origin: "sneaky" });
  assertEquals(r.ok, false);
  assertEquals(r.rejected_reason, "unknown_origin");
});

// ---- competitor content cannot reach seller fields ----------------------------
Deno.test("automated_refresh from a competitor source strips seller fields", () => {
  const r = resolveOriginAwareSave({
    existing: {},
    patch: {
      company: { name: "Goji", website_url: "https://gojiberry.ai" },
      positioning: { offer: "passive talent discovery" },
      competitors: ["Agentory"],
    },
    origin: "automated_refresh",
    sourceRole: "competitor",
  });
  assert(r.ok);
  assert(r.stripped_seller_fields.includes("company"));
  assert(r.stripped_seller_fields.includes("positioning"));
  // Even into an EMPTY brain, competitor content never fills the seller name.
  assertEquals(readPath(r.safe_patch, "company.name"), undefined);
  // Non-seller competitive research can still fill an empty field.
  assert(r.applied_paths.includes("competitors"));
});

// ---- unknown source role cannot become seller ---------------------------------
Deno.test("automated_refresh with UNKNOWN source role cannot populate seller identity", () => {
  const r = resolveOriginAwareSave({
    existing: {},
    patch: { company: { name: "Mystery Co" } },
    origin: "automated_refresh",
    sourceRole: undefined, // → unknown
  });
  assert(r.ok);
  assertEquals(readPath(r.safe_patch, "company.name"), undefined);
  assert(r.stripped_seller_fields.includes("company"));
});

// ---- approved_refresh_suggestions: only approved paths ------------------------
Deno.test("approved_refresh_suggestions applies ONLY approved paths", () => {
  const r = resolveOriginAwareSave({
    existing: { company: { name: "Agentory" } },
    patch: { company: { website_url: "https://agentory.space" }, positioning: { offer: "AI workforce platform" } },
    origin: "approved_refresh_suggestions",
    sourceRole: "seller",
    approvedPaths: ["company.website_url"],
  });
  assert(r.ok);
  assertEquals(readPath(r.safe_patch, "company.website_url"), "https://agentory.space");
  // The un-approved path is not applied.
  assertEquals(readPath(r.safe_patch, "positioning.offer"), undefined);
  assertEquals(r.applied_paths, ["company.website_url"]);
});

// ---- approval cannot launder competitor content into a seller field -----------
Deno.test("approval of a seller field from a non-seller source is blocked", () => {
  const r = resolveOriginAwareSave({
    existing: {},
    patch: { company: { name: "Goji" } },
    origin: "approved_refresh_suggestions",
    sourceRole: "competitor",
    approvedPaths: ["company.name"],
  });
  assert(r.ok);
  assertEquals(readPath(r.safe_patch, "company.name"), undefined);
  assert(r.stripped_seller_fields.includes("company.name"));
});

// ---- stale review is rejected -------------------------------------------------
Deno.test("a stale review (Brain changed since) is rejected", () => {
  const r = resolveOriginAwareSave({
    existing: { company: { name: "Agentory" } },
    patch: { company: { website_url: "https://agentory.space" } },
    origin: "approved_refresh_suggestions",
    sourceRole: "seller",
    approvedPaths: ["company.website_url"],
    expectedUpdatedAt: "2026-07-21T09:00:00.000Z",
    currentUpdatedAt: "2026-07-21T10:00:00.000Z",
  });
  assertEquals(r.ok, false);
  assertEquals(r.rejected_reason, "stale_review");
});

// ---- approval creating an identity conflict is rejected -----------------------
Deno.test("approving a flat value that conflicts the nested identity is rejected", () => {
  const r = resolveOriginAwareSave({
    existing: { company: { name: "Agentory" } },
    patch: { company_name: "Goji" },
    origin: "approved_refresh_suggestions",
    sourceRole: "seller",
    approvedPaths: ["company_name"],
  });
  assertEquals(r.ok, false);
  assertEquals(r.rejected_reason, "identity_conflict");
});

// ---- legacy_import fills missing canonical fields only ------------------------
Deno.test("legacy_import fills a MISSING field but never overwrites", () => {
  const filled = resolveOriginAwareSave({
    existing: { company: {} },
    patch: { company: { name: "Agentory" } },
    origin: "legacy_import",
  });
  assert(filled.ok);
  assertEquals(readPath(filled.safe_patch, "company.name"), "Agentory");

  const overwrite = resolveOriginAwareSave({
    existing: { company: { name: "Agentory" } },
    patch: { company: { name: "Legacy Name" } },
    origin: "legacy_import",
  });
  assertEquals(readPath(overwrite.safe_patch, "company.name"), undefined);
  assert(overwrite.pending_review.some((d) => d.field_path === "company.name"));
});

// ---- confirmed paths are protected even when empty ----------------------------
Deno.test("a confirmed path is never auto-filled by refresh", () => {
  const r = resolveOriginAwareSave({
    existing: {},
    patch: { company: { name: "Proposed" } },
    origin: "automated_refresh",
    sourceRole: "seller",
    confirmedPaths: ["company.name"],
  });
  assertEquals(readPath(r.safe_patch, "company.name"), undefined);
  assert(r.pending_review.some((d) => d.field_path === "company.name" && d.action === "conflict"));
});

// ---- helpers ------------------------------------------------------------------
Deno.test("isValidChangeOrigin + collectLeafPaths", () => {
  assert(isValidChangeOrigin("manual_edit"));
  assert(!isValidChangeOrigin("nope"));
  const paths = collectLeafPaths({ company: { name: "A", website_url: "u" }, competitors: ["x"] });
  assert(paths.includes("company.name"));
  assert(paths.includes("company.website_url"));
  assert(paths.includes("competitors"));
});

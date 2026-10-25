// THE REDESIGNED COMPANY BRAIN PAGE SAVES ONLY THROUGH THE AUTHORIZED BACKEND UPDATE.
//
// design/ui-polish built inline editing on a direct browser write of the whole
// merged profile. #147 replaced direct writes with generate-company-brain-draft
// `update`, which accepts only structured top-level keys and refuses a save on
// an out-of-date version. These tests pin the redesigned page to that contract:
//
//   1. every patch the inline editors and the drawer can build uses only keys
//      the backend accepts (UPDATABLE_KEYS) — a rejected key would make a whole
//      section unsaveable;
//   2. the page's save queue sends the PATCH (never the merged profile) through
//      saveCompanyBrainPatch, chains the version each save returns, and never
//      writes the row itself.
//
// Pure. No React, no network.
import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildFieldPatch, buildPatch, initialFor } from "../../src/lib/companyBrainPatch.ts";
import { normalizeCompanyBrain } from "../../src/lib/normalizeCompanyBrain.ts";
import { UPDATABLE_KEYS } from "../../supabase/functions/_shared/companyBrainUpdate.ts";

const ROOT = new URL("../../", import.meta.url);
const SECTIONS = ["company", "targeting", "buyers", "signals", "disqualifiers", "messaging"] as const;
const full = normalizeCompanyBrain({
  schema_version: 2,
  company: { name: "Northwind", description: "Revenue analytics", business_model: "B2B SaaS", team_size: "24" },
  founder: { name: "Ada", role: "CEO" },
  target_customer: { industries: ["Fintech"], geography: ["US"], company_size: { min: 50, max: 200, label: "" } },
  buyer_personas: ["CFO"], pain_points: ["Slow reporting"], triggers: ["New funding"], jobs_to_watch: ["FP&A Lead"],
  competitors: ["Clari"], tools: ["Salesforce"], positive_examples: ["Acme"], negative_examples: ["Agency X"],
  positioning: { promise: "Close the quarter", offer: "Pilot", differentiators: ["Fast"] },
  brand_voice: { tone: "Direct", avoid: ["hype"] }, content_angles: ["Forecasting"],
  qualification_rules: { required_evidence: ["Pricing page"], reject_if: [], manual_review_if: [] },
});

Deno.test("1. every section's drawer patch uses only keys the backend update accepts", () => {
  for (const section of SECTIONS) {
    const keys = Object.keys(buildPatch(section, initialFor(section, full), full));
    const rejected = keys.filter((k) => !UPDATABLE_KEYS.has(k));
    assertEquals(rejected, [], `${section} drawer patch has keys the backend refuses`);
  }
});

Deno.test("2. every section's inline-field patch uses only accepted keys", () => {
  for (const section of SECTIONS) {
    const keys = Object.keys(buildFieldPatch(section, initialFor(section, full), full));
    const rejected = keys.filter((k) => !UPDATABLE_KEYS.has(k));
    assertEquals(rejected, [], `${section} inline patch has keys the backend refuses`);
  }
});

Deno.test("3. the page saves through saveCompanyBrainPatch, sends the patch, chains the version", async () => {
  const src = await Deno.readTextFile(new URL("src/pages/CompanyBrainDashboard.tsx", ROOT));
  assert(/saveCompanyBrainPatch\(\{\s*workspaceId,\s*patch,\s*expectedUpdatedAt:\s*version\.current\s*\}\)/.test(src),
    "the queue sends the edit's patch with the version it builds on");
  assert(/\(result as \{ updatedAt\?: string \}\)\.updatedAt;\s*version\.current = next \?\? version\.current;/.test(src), "and carries the returned version into the next save");
  // Phase 3c (held): a client Brain saves through its own call and chains its integer version.
  assert(/saveClientBrainPatch\(\{ workspaceId, scope, patch, expectedVersion: version\.current === null \? null : Number\(version\.current\) \}\)/.test(src));
  assert(/if \(currentScopeKey\.current !== savedFor\) return result\.ok;/.test(src), "an answer that arrives after a switch never moves the new Brain's version");
  assertFalse(/from\(['"]company_brain['"]\)/.test(src), "the page never touches the row itself");
  assertFalse(/supabase/.test(src), "nor imports the client");
  assertFalse(/saveCompanyBrainPatch\(\{[^}]*merged/.test(src), "the merged profile is for display only");
});

Deno.test("4. a failed drawer save throws, so the drawer keeps the user's edit", async () => {
  const page = await Deno.readTextFile(new URL("src/pages/CompanyBrainDashboard.tsx", ROOT));
  assert(/if \(!\(await writePatch\(patch\)\)\) throw/.test(page));
  const drawer = await Deno.readTextFile(new URL("src/components/company-brain/CompanyBrainEditDrawer.tsx", ROOT));
  assert(/\} catch \{[\s\S]{0,200}\} finally \{\s*setBusy\(false\)/.test(drawer), "the drawer swallows the throw and keeps its state");
});

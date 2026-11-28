// CB-003 · Every Company Brain drawer section persists exactly what the person typed.
//
// The drawer's state → buildPatch → the REAL server update plan (planBrainUpdate, what
// generate-company-brain-draft `update` writes) → the stored profile → the page's
// normalizer → initialFor. What comes back must equal what was typed, field by field,
// for every section; otherwise a saved editor would reopen with different values.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildPatch, initialFor } from "../../src/lib/companyBrainPatch.ts";
// The drawer sections (src/lib/companyBrainSections.ts SECTION_ORDER; that module pulls in icons).
const SECTION_ORDER = ["targeting", "buyers", "signals", "company", "disqualifiers", "messaging"] as const;
import { normalizeCompanyBrain } from "../../src/lib/normalizeCompanyBrain.ts";
import { planBrainUpdate } from "../../supabase/functions/_shared/companyBrainUpdate.ts";

const EXISTING = {
  schema_version: 2,
  company: { name: "Northwind Field Services (fictional)", description: "Scheduling software for field-service teams" },
  target_customer: { industries: ["Manufacturing"], geography: ["United States"] },
};
const NUMERIC = new Set(["size_min", "size_max"]);

function filled(section: string, base: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(base)) {
    if (NUMERIC.has(k)) out[k] = k === "size_min" ? "10" : "200";
    else if (k === "size_label") out[k] = "10-200";
    else if (Array.isArray(v)) out[k] = [`${section} ${k} one`, `${section} ${k} two`];
    else if (typeof v === "string" || v == null) out[k] = k.endsWith("_url") ? `https://example.com/${section}/${k}` : `${section} ${k} value`;
    else out[k] = v;
  }
  return out;
}

for (const section of SECTION_ORDER) {
  Deno.test(`CB-003 · ${section}: every field typed in the drawer is stored and reads back unchanged`, () => {
    const brain = normalizeCompanyBrain(EXISTING as never);
    const typed = filled(section, initialFor(section, brain));
    const patch = buildPatch(section, typed, brain);
    const plan = planBrainUpdate({ existing: EXISTING, currentUpdatedAt: "v1", expectedUpdatedAt: "v1", patch, alreadyActive: true });
    if (!plan.ok) throw new Error(`${section}: the server refused the drawer's patch: ${plan.reason} ${plan.detail ?? ""}`);
    const back = initialFor(section, normalizeCompanyBrain(plan.profile as never));
    assertEquals(back, typed, `${section}: what reopens is not what was saved`);
  });
}

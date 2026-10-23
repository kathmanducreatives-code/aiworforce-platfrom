// A COMPANY BRAIN NOBODY HAS STARTED GETS ONE CLEAR WAY IN.
//
// A new workspace's Brain (profile {} from provisioning, not activated) used to
// show a "·" avatar, an "Identity needs confirmation" warning and a "Re-run
// setup" button for a setup that never ran. It now shows a setup prompt
// ("Start guided setup" for editors; an explanation for viewers), a "Start
// setup" header action that opens onboarding directly, and no identity warning.
// Browser-checked with the preview harness (?empty=1, ?empty=1&role=viewer, 390 px).
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isEmptyBrain } from "../../src/lib/companyBrainInsights.ts";
import { normalizeCompanyBrain } from "../../src/lib/normalizeCompanyBrain.ts";

const ROOT = new URL("../../", import.meta.url);
const read = (p: string) => Deno.readTextFileSync(new URL(p, ROOT));
const b = (p: Record<string, unknown>) => normalizeCompanyBrain({ schema_version: 2, ...p });

Deno.test("E-1 empty means: never activated and nothing filled in at all", () => {
  assert(isEmptyBrain(normalizeCompanyBrain({}), false), "the provisioning row");
  assertEquals(isEmptyBrain(normalizeCompanyBrain({}), true), false, "an activated Brain is never 'empty'");
  assertEquals(isEmptyBrain(b({ company: { name: "Northwind" } }), false), false, "a name means someone started");
  assertEquals(isEmptyBrain(b({ target_customer: { industries: ["Fintech"] }, buyer_personas: ["CFO"] }), false), false);
  assertEquals(isEmptyBrain(b({ pain_points: ["Slow close"] }), false), false, "any one value counts");
});

Deno.test("E-2 the page: setup prompt, direct setup action, no identity warning, no '·' avatar", () => {
  const overview = read("src/components/company-brain/BrainOverview.tsx");
  assert(/\{empty && \(\s*<section className="brain-empty"/.test(overview));
  assert(/\{editable && <Button onClick=\{onStartSetup\} className="shrink-0">Start guided setup<\/Button>\}/.test(overview));
  assert(/onClick=\{active \? onRestart : onStartSetup\}/.test(overview), "never 'restart' a setup that never ran");
  assert(/\{c\.name\.trim\(\) \? monogram\(c\.name\) : <Building2 size=\{18\} \/>\}/.test(overview));
  const page = read("src/pages/CompanyBrainDashboard.tsx");
  assert(/\{identityBanner && !brainEmpty && \(/.test(page));
  assert(/onStartSetup=\{\(\) => navigate\('\/onboarding\/company-brain'\)\}/.test(page));
});

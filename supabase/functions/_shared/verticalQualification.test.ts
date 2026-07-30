import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { qualifyCompanyVertical } from "./verticalQualification.ts";

const q = qualifyCompanyVertical;

// SaaS — preserves PR #92 behavior.
Deno.test("35. advisory firm without software product → not a SaaS target", () => {
  assertEquals(q({ name: "Optivas Advisors", description: "boutique management advisory for SMB leaders" }, "saas").outcome, "fail");
});
Deno.test("36. recruiting/search firm → fail", () => {
  assertEquals(q({ name: "Netsoft Search", job_description: "Principal Search Consultant", industries: ["Staffing & Recruiting"] }, "saas").outcome, "fail");
});
Deno.test("37. hosted-search SOFTWARE is not rejected on 'search'", () => {
  assertEquals(q({ name: "Algolia", description: "hosted search platform and API" }, "saas").outcome, "pass");
});
Deno.test("38. advisory SOFTWARE is not rejected on 'advisory'", () => {
  assertEquals(q({ name: "WealthGrid Advisors", description: "robo-advisory investment platform (SaaS) with an API" }, "saas").outcome, "pass");
});

// Automation integrator.
Deno.test("40. real controls integrator → pass", () => {
  assertEquals(q({ name: "Midwest Controls", description: "controls engineering and PLC/SCADA system integration; panel build and commissioning" }, "automation_integrator").outcome, "pass");
});
Deno.test("39. automation distributor with no integration service → fail", () => {
  assertEquals(q({ name: "IndSupply", description: "industrial equipment distributor and reseller; we stock and ship components" }, "automation_integrator").outcome, "fail");
});
Deno.test("integrator request rejects a software-only product company", () => {
  assertEquals(q({ name: "CloudApp", description: "B2B SaaS analytics platform" }, "automation_integrator").outcome, "fail");
});

// Manufacturer.
Deno.test("42. real small manufacturer → pass", () => {
  assertEquals(q({ name: "PrecisionParts", description: "contract manufacturer of machined metal parts; CNC machining and fabrication" }, "manufacturer").outcome, "pass");
});
Deno.test("41. pure importer with no manufacturing → fail", () => {
  assertEquals(q({ name: "GlobalImports", description: "we import and distribute consumer electronics from overseas suppliers" }, "manufacturer").outcome, "fail");
});
Deno.test("manufacturer qualifies via NAICS 31-33 when present", () => {
  assertEquals(q({ name: "MetalWorks", description: "precision components", naics: "3327" }, "manufacturer").outcome, "pass");
});

// Recruiter is never a target, in ANY vertical.
Deno.test("staffing firm fails every vertical", () => {
  for (const v of ["saas", "automation_integrator", "manufacturer"] as const) {
    assertEquals(q({ name: "TalentX", industries: ["Staffing & Recruiting"] }, v).outcome, "fail");
  }
});

// OFFLINE PROBE (audit evidence; reproduces the "before" state on launch/hardening): does an edit made on the Company
// Brain page reach (a) the lead compiler and (b) the <company_brain> block every
// run-agent prompt gets? Uses the real production modules; no network.
const root = Deno.args[0];
const { renderCompanyBrainBlock } = await import(`${root}/supabase/functions/_shared/companyBrainContext.ts`);
const { compileCompanyBrainContext } = await import(`${root}/supabase/functions/_shared/companyBrainCompiler.ts`);
const { mergeLegacyIcpProjection, normalizeCompanyBrain } = await import(`${root}/supabase/functions/_shared/normalizeCompanyBrain.ts`);

// 1. What onboarding's backend save stores: v2 + the legacy icp projection.
const v2 = {
  schema_version: 2,
  company: { name: "Northwind", description: "Revenue analytics" },
  target_customer: { industries: ["Fintech"], business_models: ["B2B SaaS"], geography: ["United Kingdom"], must_have: ["Hiring RevOps"],
    disqualifiers: { industries: ["Agencies"], company_types: [], domains: [], keywords: [], titles: [] } },
  buyer_personas: ["CFO"],
};
const afterOnboarding = { ...v2, icp: mergeLegacyIcpProjection({}, normalizeCompanyBrain(v2)) };

// 2. What the Company Brain page writes for "change industries to Logistics":
//    a shallow top-level merge of target_customer (no legacy projection).
const afterPageEdit = { ...afterOnboarding, target_customer: { ...afterOnboarding.target_customer, industries: ["Logistics"] } };

// 3. And for "remove all industries":
const afterClear = { ...afterOnboarding, target_customer: { ...afterOnboarding.target_customer, industries: [] } };

const compiled = (p: unknown) => {
  const c = compileCompanyBrainContext({ workspace_id: "ws", profile: p }) as { icp: { industries: string[] } };
  return JSON.stringify(c.icp.industries);
};
const icpLine = (p: unknown) => (renderCompanyBrainBlock(p, true).split("\n").find((l: string) => l.startsWith("ICP:")) ?? "(no ICP line)");
for (const [label, p] of [["after onboarding", afterOnboarding], ["after page edit → Logistics", afterPageEdit], ["after page clears industries", afterClear]] as const) {
  console.log(`\n${label}`);
  console.log(`  lead compiler industries : ${compiled(p)}`);
  console.log(`  agent prompt ${icpLine(p)}`);
  console.log(`  frontend normalizer reads: ${JSON.stringify(normalizeCompanyBrain(p).target_customer.industries)}`);
}
console.log(`\nfields absent from the agent prompt block even after onboarding:`);
const block = renderCompanyBrainBlock(afterOnboarding, true);
for (const k of ["United Kingdom", "Hiring RevOps", "B2B SaaS"]) console.log(`  ${k.padEnd(16)} in prompt? ${block.includes(k)}`);

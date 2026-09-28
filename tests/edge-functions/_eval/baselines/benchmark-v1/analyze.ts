// Read-only analysis of bench.json. No network.
const S = "/private/tmp/claude-501/-Users-prasidha-agentory-main-local/601151e0-1c74-40ad-9a8a-201359b65102/scratchpad";
const R = "/Users/prasidha/agentory-main-local";
const { ALL_FIXTURES } = await import(`${R}/tests/edge-functions/_eval/facetFixtures.ts`);
// deno-lint-ignore no-explicit-any
const b: any = JSON.parse(await Deno.readTextFile(`${S}/bench.json`));
const FACETS = ["business_customer", "consumer_customer", "software_product", "saas_delivery", "service_heavy", "ai_product"];
const ARMS = ["current_grounder", "gpt_fixed", "jev"];
const short = { states: "S", contradicts: "C", not_stated: "-" } as Record<string, string>;
const pct = (x: number | null) => x === null || x === undefined ? "n/a" : `${(x * 100).toFixed(1)}%`;
// deno-lint-ignore no-explicit-any
const m = (arm: string) => b.metrics.find((x: any) => x.arm === arm);

// ── cost / tokens per arm from the metered calls ──
const roleArm: Record<string, string> = { facet_attestation_jev: "jev", facet_attestation_gpt: "gpt_fixed" };
const agg: Record<string, { calls: number; ok: number; in: number; out: number; usd: number; unpriced: number }> = {};
for (const c of b.calls) {
  const arm = roleArm[c.role] ?? "current_grounder";
  const a = agg[arm] ??= { calls: 0, ok: 0, in: 0, out: 0, usd: 0, unpriced: 0 };
  a.calls++; if (c.ok) a.ok++;
  a.in += c.input_tokens ?? 0; a.out += c.output_tokens ?? 0; a.usd += c.estimated_cost_usd ?? 0;
  if (c.cost_source === "unknown") a.unpriced++;
}
console.log("ROLES:", [...new Set(b.calls.map((c: { role: string; model: string }) => `${c.role}/${c.model}`))].join(", "));
console.log("\nCALLS/TOKENS/COST by arm:", JSON.stringify(agg, null, 1));

// ── metrics table ──
const row = (label: string, f: (x: any) => string) => console.log(`${label} | ${ARMS.map((a) => f(m(a))).join(" | ")}`);
console.log("\nMETRIC | current | gpt | jev");
row("runs / failures", (x) => `${x.runs} / ${x.failures}`);
row("scored cells", (x) => `${x.scored_cells}`);
row("accuracy", (x) => pct(x.facet_accuracy));
for (const f of FACETS) row(`  acc ${f}`, (x) => pct(x.per_facet_accuracy[f] ?? null));
row("false states rate", (x) => pct(x.false_pass_rate));
row("false contradiction rate", (x) => pct(x.false_contradiction_rate));
row("repeatability", (x) => pct(x.repeatability));
row("invalid id rate", (x) => pct(x.invalid_snippet_id_rate));
row("support hit rate", (x) => pct(x.support_hit_rate));
row("hostile false-pass runs", (x) => `${x.hostile_false_passes}`);
row("p50 ms", (x) => `${x.latency_p50_ms}`);
row("p95 ms", (x) => `${x.latency_p95_ms}`);
row("mean cost/company", (x) => x.mean_cost_usd === null ? "n/a" : `$${x.mean_cost_usd.toFixed(6)}`);
row("disagree vs current", (x) => pct(x.disagreement_vs_current));

// ── counts of false states / contradictions (absolute) ──
// deno-lint-ignore no-explicit-any
const fx: Record<string, any> = Object.fromEntries(ALL_FIXTURES.map((f: any) => [f.id, f]));
for (const arm of ARMS) {
  let fs = 0, fc = 0, tot = 0, invalid = 0, returned = 0;
  for (const [fid, list] of Object.entries(b.runs[arm] ?? {})) for (const r of list as any[]) {
    returned += r.returned_ids; invalid += r.invalid_ids;
    if (!r.verdicts) continue;
    for (const f of FACETS) { tot++; const p = r.verdicts[f], l = fx[fid].labels[f]; if (p === "states" && l !== "states") fs++; if (p === "contradicts" && l !== "contradicts") fc++; }
  }
  console.log(`ABS ${arm}: false_states=${fs} false_contra=${fc} cells=${tot} invalid_ids=${invalid}/${returned}`);
}

// ── hostile fixture verdicts ──
for (const arm of ARMS) {
  const list = (b.runs[arm] ?? {})["prompt_injection"] ?? [];
  console.log(`HOSTILE ${arm}: ` + list.map((r: any) => r.verdicts ? FACETS.map((f) => short[r.verdicts[f]]).join("") : `FAIL(${r.failure})`).join(" "));
}

// ── raw index: arm → fixture → repeat outcomes ──
const rawBy: Record<string, Record<string, any[]>> = {};
for (const e of b.raw) {
  const fid = ALL_FIXTURES.find((f: any) => f.company_key === e.company_key)!.id;
  ((rawBy[e.arm] ??= {})[fid] ??= []).push(e.out);
}
const snip = (fid: string, id: unknown) => {
  if (typeof id !== "string" || id === "NONE") return "NONE";
  const t = b.snippets[fx[fid].company_key]?.[id];
  return t ? `"${t.slice(0, 70)}"` : `${id}(INVALID)`;
};

// ── every disagreement cell ──
console.log("\nDISAGREEMENTS (any repeat of any arm differs from the label):");
for (const fid of Object.keys(fx)) for (const f of FACETS) {
  const label = fx[fid].labels[f];
  const verdicts = (arm: string) => ((b.runs[arm] ?? {})[fid] ?? []).map((r: any) => r.verdicts ? short[r.verdicts[f]] : "x").join("");
  const any = ARMS.some((a) => [...verdicts(a)].some((v) => v !== short[label]));
  if (!any) continue;
  console.log(`\n# ${fid}.${f}  expected=${short[label]}  current=${verdicts("current_grounder")}  gpt=${verdicts("gpt_fixed")}  jev=${verdicts("jev")}`);
  const cur = (rawBy.current_grounder ?? {})[fid]?.[0];
  if (cur) console.log(`   current: value=${cur.value} decision=${cur.decision} stated=[${cur.facets_stated}] quotes=${JSON.stringify((cur.quotes ?? []).slice(0, 4)).slice(0, 220)} rejected=[${cur.rejected}]`);
  for (const arm of ["gpt_fixed", "jev"]) {
    const outs = (rawBy[arm] ?? {})[fid] ?? [];
    const desc = outs.map((o: any) => {
      if (!o.ok) return `FAIL:${o.failure}`;
      const a = o.answers?.[f];
      if (!a) return "missing";
      const sup = Array.isArray(a.support) ? a.support.map((x: unknown) => snip(fid, x)).join("+") : snip(fid, a.support);
      const con = Array.isArray(a.contradiction) ? a.contradiction.map((x: unknown) => snip(fid, x)).join("+") : snip(fid, a.contradiction);
      const probs = a.probabilities ? ` p=${JSON.stringify(a.probabilities)}` : "";
      return `${a.verdict} conf=${a.confidence ?? "n/a"}${probs} sup=${sup}${con !== "NONE" && con !== "" ? ` con=${con}` : ""}`;
    });
    const uniq = [...new Set(desc)];
    console.log(`   ${arm}: ${uniq.map((u) => `${desc.filter((d: string) => d === u).length}× ${u}`).join(" || ").slice(0, 700)}`);
  }
}

console.log("\nGATES:");
for (const [k, g] of Object.entries(b.gates)) {
  console.log(`${k}: passed=${(g as any).passed}`);
  for (const c of (g as any).checks) console.log(`   ${c.passed ? "PASS" : "FAIL"} ${c.check} — ${c.detail}`);
}
console.log(`\nTOTAL model calls=${b.model_calls} estimated=$${b.model_cost_usd.toFixed(6)}`);

// The ATLAS simulator's human-readable report: request → plan → Actors → companies →
// verdicts → dedupe → persistence → Workbench. Every line comes from the service's own
// response or the mocked boundary's call log; nothing is re-derived here.

import type { SimResult } from "./harness.ts";

type R = Record<string, unknown>;
const j = (v: unknown, max = 600) => { const s = JSON.stringify(v); return s.length > max ? s.slice(0, max) + "…" : s; };
const arr = <T = R>(v: unknown): T[] => (Array.isArray(v) ? v as T[] : []);
const obj = (v: unknown): R => (v && typeof v === "object" && !Array.isArray(v) ? v as R : {});

/** Removes anything that looks like a credential before it is printed or written. */
export function redact<T>(v: T): T {
  return JSON.parse(JSON.stringify(v, (k, x) => {
    if (/token|secret|password|authorization|api[_-]?key/i.test(k) && typeof x === "string") return x ? "[redacted]" : x;
    if (typeof x === "string" && /\b(sb_secret_|sk-|apify_api_)[A-Za-z0-9_-]{8,}/.test(x)) return "[redacted]";
    return x;
  }));
}

function companyLine(c: R): string[] {
  const co = obj(c.company); const st = obj(c.statuses); const bm = obj(c.businessModel);
  const lines = [`  • ${co.name} (${co.domain ?? co.key}) — qualification: ${st.qualification}, screening: ${st.screening}`];
  if (Object.keys(bm).length) lines.push(`      business model: ${bm.status}${bm.quote ? ` — “${String(bm.quote).slice(0, 110)}”` : ""}${bm.url ? ` (${bm.url})` : ""}`);
  for (const ch of arr<R>(obj(c.qualification).checks)) {
    const ev = arr<R>(ch.evidence).map((e) => e.actor).join(",");
    lines.push(`      ${ch.result === "pass" ? "✓" : ch.result === "fail" ? "✗" : "…"} ${ch.dimension}: ${ch.reason}${ev ? `  [evidence: ${ev}]` : ""}`);
  }
  const reasons = arr<string>(c.screeningReasons); if (reasons.length) lines.push(`      screening: ${reasons.join("; ")}`);
  const ids = arr<string>(c.existingLeadIds); if (ids.length) lines.push(`      existing lead(s): ${ids.join(", ")}`);
  const blk = arr<unknown>(c.outreachBlockers); if (blk.length) lines.push(`      outreach blocked: ${j(blk, 200)}`);
  return lines;
}

export function renderReport(r: SimResult): string {
  const out: string[] = [];
  const s = r.scenario;
  const H = (t: string) => out.push("", `── ${t} ${"─".repeat(Math.max(0, 70 - t.length))}`);
  out.push("SIMULATED DATA — NO EXTERNAL PROVIDERS CALLED", `scenario: ${s.name}   correlation: ${r.correlationId}`, s.description, `request: “${s.query}”`);

  const plan = obj(r.plan.body.plan); const interp = obj(r.plan.body.interpretation);
  H("1–3 INTERPRETATION (mocked model answer → real contract)");
  out.push(`plan HTTP ${r.plan.status}${r.plan.body.status ? ` · ${r.plan.body.status}` : ""}${r.plan.body.error ? ` · ${String(r.plan.body.error).slice(0, 300)}` : ""}`);
  out.push(`mandatory:   ${arr<R>(interp.hard).map((h) => h.label).join(" · ") || "—"}`);
  out.push(`preferences: ${arr<R>(interp.preferences).map((p) => `${p.key}=${j(p.values, 80)}`).join(" · ") || "—"}`);
  for (const q of arr<string>(r.plan.body.questions ?? plan.questions)) out.push(`question:    ${q}`);

  H("4 CAPABILITY ROUTING (who can verify each requirement)");
  for (const rt of arr<R>(plan.requirementRoutes)) out.push(`  ${String(rt.necessity).padEnd(9)} ${String(rt.label).padEnd(40)} → ${rt.route}${arr(rt.checkedBy).length ? ` by ${arr(rt.checkedBy).join(", ")}` : ""}`);
  if (plan.blockedReason) out.push(`BLOCKED: ${plan.blockedReason}`);

  H("5–7 PLAN · ACTORS · ESTIMATE");
  out.push(`strategy: ${plan.strategy ?? "—"} (status ${plan.status ?? "—"})   planHash: ${String(plan.planHash ?? "—").slice(0, 16)}…`);
  for (const st of arr<R>(plan.steps)) out.push(`  step ${st.capability}  maxItems=${st.maxItems}  est=${j(st.estimate, 120)}`);
  out.push(`ESTIMATED worst case: ${j(plan.estimate)}   ceilings: ${j(obj(plan.binding).ceilings)}`);

  r.runs.forEach((run, i) => {
    const b = run.body; const outc = obj(b.outcome);
    H(`RUN ${i + 1} (approval: ${run.approval}) → HTTP ${run.status} ${b.status ?? ""}`);
    if (run.status >= 300) { out.push(`  refused: ${j(b.error ?? b, 400)}`); return; }
    out.push(`outcome: ${outc.status} — ${outc.summary}`);
    out.push(`ACTUAL spend reported: ${j(b.spend)} (basis: ${obj(outc.spend).basis ?? "—"}) — compare ESTIMATED above`);
    out.push(`excluded: ${b.excludedCount ?? 0}   merged (dedupe): ${j(b.mergedCompanies, 300)}`);
    out.push("", "8–12 COMPANIES", "QUALIFIED:"); arr<R>(b.queue).forEach((c) => out.push(...companyLine(c)));
    if (!arr(b.queue).length) out.push("  (none)");
    out.push("NEEDS VERIFICATION:"); arr<R>(b.review).forEach((c) => out.push(...companyLine(c)));
    if (!arr(b.review).length) out.push("  (none)");
    out.push("REJECTED (not written to Leads):");
    arr<R>(b.rejected).forEach((x) => out.push(`  ✗ ${x.name} (${x.domain ?? x.linkedinUrl ?? x.leadKey}) — ${arr<string>(x.reasons).join("; ") || "ruled out"}`));
    if (!arr(b.rejected).length) out.push(`  (${b.excludedCount ?? 0} excluded${b.excludedCount ? ", names not reported by this backend" : ""})`);
    out.push("requirement verdicts:", ...arr<R>(b.requirementVerdicts).map((v) => `  ${j(v, 200)}`));
    if (b.evidenceRefused) out.push(`evidence refused: ${j(b.evidenceRefused, 300)}`);
    const per = obj(b.persistence);
    out.push(`14 persisted: ${j(b.written, 300)}${Object.keys(per).length ? `   inserted=${per.inserted} updated=${per.updated} FAILED=${per.failed}` : ""}   workbench: ${j(b.workbench)}`);
    for (const f of arr<R>(per.failures)) out.push(`   ✗ not saved: ${f.name} — ${f.error}`);
    if (Number(per.failed) > 0 && String(b.status) === "completed") out.push("   ⚠ the run reports status \"completed\" although rows failed to save (see persistence.failed)");
  });

  H("6 ACTOR CALLS (exact input JSON sent to the mocked Apify)");
  for (const c of r.actorCalls) out.push(`  ${c.actor}  outcome=${c.outcome} items=${c.items} maxItems=${c.maxItems} charged=${c.chargedUsd ?? "unknown"}`, `    input ${j(c.input, 900)}`, `    key   ${c.key}`);
  if (!r.actorCalls.length) out.push("  (no Actor was called)");
  if (r.groundingCalls.length) out.push(`grounding model readings: ${r.groundingCalls.map((g) => `${g.host}=${g.value}`).join(", ")}`);

  H("13–15 DEDUPE · PERSISTENCE · WORKBENCH (in-memory DB, real persistRows)");
  out.push(`accounts: ${r.db.accounts.length}  contacts: ${r.db.contacts.length}  leads: ${r.db.leads.length}`);
  for (const l of r.db.leads) out.push(`  lead ${l.id} account=${l.account_id} plan_id=${l.plan_id ?? "—"} status=${l.status}`);
  for (const p of r.planRecords) out.push(`  plan record: ${p.planId ?? "FAILED"} (${p.status})`);
  for (const w of r.workbench) out.push(`  Workbench view for plan ${w.planId}: ${w.leadIds.length} lead(s)  filter=${w.filter}`);
  out.push("", `timings: plan ${r.timingsMs.plan.toFixed(0)} ms · runs ${r.timingsMs.runs.map((t) => t.toFixed(0) + " ms").join(", ") || "—"}`);
  return out.join("\n");
}

/** What the Workbench dev preview loads (same shape as src/lib/__fixtures__/strategyDiscoverySimulation.json). */
export function previewSimulation(r: SimResult) {
  const run = r.runs[0] ?? { status: 409, body: { error: "not run" } };
  return redact({
    simulated: true, query: r.scenario.query, scenario: r.scenario.name,
    note: `Generated by scripts/dev/atlas-sim.ts (${r.scenario.name}) from the real lead-pipeline service with mocked providers. Development only.`,
    plan: r.plan, run: { status: run.status, body: run.body }, blockedPlan: r.plan, reviewOnlyPlan: r.plan,
  });
}

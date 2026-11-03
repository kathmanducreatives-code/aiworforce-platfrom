// Writes the discovery baseline: baseline.json, baseline.csv and index.html.
//
//   deno run --allow-read --allow-write --allow-env scripts/dev/discovery-benchmark-report.ts [--out docs/benchmarks/discovery-baseline]
//
// Report-safe by construction: synthetic `.example` companies only, no person names,
// no contact values, no tokens. `--check` compares with the recorded baseline instead
// of writing (exit 1 on any verdict or metric change).

import { BENCHMARK_VERSION, baseline, type Result } from "./discovery-benchmark.ts";

export const DEFAULT_OUT = "docs/benchmarks/discovery-baseline";

/** The stable, comparable projection of a result (runtime is excluded: it varies by machine). */
export function summaryRow(r: Result) {
  const x = r.record;
  return {
    id: r.id, group: r.group, title: r.title, verdict: r.verdict, strategy: x?.strategy ?? null, planStatus: x?.planStatus ?? "not_run",
    planHash: x?.planHash ?? null, semanticFingerprint: x?.semanticFingerprint ?? null,
    hardRequirements: x?.hardRequirements.length ?? 0, hardPreserved: x?.hardPreserved ?? null,
    providerCalls: x?.providerCalls.length ?? 0, apifyItems: x?.itemsPurchased.apify ?? 0, leadoceanRecords: x?.leadoceanRecords ?? 0,
    candidates: x?.candidates ?? 0, uniqueCompanies: x?.uniqueCompanies ?? 0, qualified: x?.qualified ?? 0, rejected: x?.rejected ?? 0, review: x?.review ?? 0,
    falseQualified: x?.falseQualified.length ?? 0, precision: x?.precision ?? null, recall: x?.recall ?? null,
    apifyUsdUpperBound: x?.costUsd.apify ?? 0, costPerQualifiedUsd: x?.costPerQualifiedUsd ?? null,
    errors: x?.errors.length ?? 0, dbWrites: x?.dbWrites ?? 0,
  };
}

const CSV_COLS = ["id", "group", "title", "verdict", "strategy", "planStatus", "hardRequirements", "hardPreserved", "providerCalls", "apifyItems", "leadoceanRecords",
  "candidates", "uniqueCompanies", "qualified", "rejected", "review", "falseQualified", "precision", "recall", "apifyUsdUpperBound", "costPerQualifiedUsd", "errors", "dbWrites"] as const;

export function toCsv(rows: ReturnType<typeof summaryRow>[]): string {
  const cell = (v: unknown) => { const t = v == null ? "" : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  return [CSV_COLS.join(","), ...rows.map((r) => CSV_COLS.map((c) => cell(r[c])).join(","))].join("\n") + "\n";
}

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function toHtml(results: Result[], generatedAt: string): string {
  const count = (v: string) => results.filter((r) => !["X", "F"].includes(r.group) && r.verdict === v).length;
  const rows = results.map((r) => {
    const x = r.record;
    return `<tr class="v-${r.verdict}"><td class="id">${esc(r.id)}</td><td>${esc(r.title)}</td><td><span class="pill ${r.verdict}">${r.verdict}</span></td>
<td>${esc(x?.strategy ?? "—")}</td><td class="n">${x ? x.uniqueCompanies : "—"}</td><td class="n">${x ? x.qualified : "—"}</td><td class="n">${x ? x.rejected : "—"}</td><td class="n">${x ? x.review : "—"}</td>
<td class="n">${x?.precision ?? "—"}</td><td class="n">${x ? `$${x.costUsd.apify.toFixed(4)}` : "—"}</td><td class="n">${x ? x.leadoceanRecords : "—"}</td><td class="n">${x?.costPerQualifiedUsd != null ? `$${x.costPerQualifiedUsd.toFixed(4)}` : "—"}</td></tr>`;
  }).join("\n");
  const details = results.map((r) => {
    const x = r.record;
    const companies = x?.companies.map((c) => `<li><span class="pill ${c.verdict === "qualified" ? "PASS" : c.verdict === "rejected" ? "FAIL" : "BLOCKED"}">${c.verdict}</span> ${esc(c.name)} <code>${esc(c.domain)}</code>${c.gaps.length ? ` — unproven: ${esc(c.gaps.join(", "))}` : ""}${c.evidence.length ? `<br><small>evidence: ${esc(c.evidence.join(", "))}</small>` : ""}</li>`).join("") ?? "";
    return `<details id="${esc(r.id)}"><summary><b>${esc(r.id)}</b> ${esc(r.title)} <span class="pill ${r.verdict}">${r.verdict}</span></summary>
<p class="req">“${esc(x?.request ?? "")}”</p>
<dl>
<dt>Result</dt><dd>${esc(r.detail)}</dd>
<dt>Hard (stated)</dt><dd>${esc(r.spec.hard.join(" · ") || "—")}</dd>
<dt>Hard (compiled)</dt><dd>${esc(x?.hardRequirements.join(" · ") || "—")}</dd>
<dt>Preferences</dt><dd>${esc((x?.preferences.length ? x.preferences : r.spec.preferences).join(" · ") || "—")}</dd>
<dt>Verification</dt><dd>${esc(r.spec.verification.join(" · ") || "—")}</dd>
<dt>Providers</dt><dd>${esc(r.spec.providers)}</dd>
<dt>Expected</dt><dd>${esc(r.spec.expected)}</dd>
<dt>PASS condition</dt><dd>${esc(r.spec.pass)}</dd>
${x ? `<dt>Plan</dt><dd>${esc(x.planStatus)}${x.planHash ? ` · hash <code>${esc(x.planHash.slice(0, 16))}…</code>` : ""} · semantics <code>${esc(x.semanticFingerprint.slice(0, 16))}…</code></dd>
<dt>Limitations</dt><dd>${esc(x.planLimitations.join(" | ") || "—")}</dd>
<dt>Provider calls</dt><dd>${esc(x.providerCalls.map((c) => `${c.provider} ${c.capability} (${c.items})`).join(" · ") || "none")}</dd>
<dt>Errors</dt><dd>${esc(x.errors.join(" | ") || "none")}</dd>
<dt>Writes (TEST rows it would project)</dt><dd>${x.dbWrites}</dd>` : ""}
</dl>${companies ? `<ul class="cos">${companies}</ul>` : ""}</details>`;
  }).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ATLAS Discovery Baseline</title>
<style>
:root{--bg:#fafaf9;--fg:#1c1917;--muted:#57534e;--line:#e7e5e4;--card:#fff;--pass:#15803d;--fail:#b91c1c;--blocked:#a16207;--unsup:#6d28d9}
@media (prefers-color-scheme:dark){:root{--bg:#0c0a09;--fg:#f5f5f4;--muted:#a8a29e;--line:#292524;--card:#1c1917;--pass:#4ade80;--fail:#f87171;--blocked:#facc15;--unsup:#c4b5fd}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px}
h1{font-size:22px;margin:0 0 4px}.sub{color:var(--muted);margin:0 0 20px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin-bottom:24px}
.tile{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px}.tile b{display:block;font-size:26px}
.table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:10px;background:var(--card)}
table{border-collapse:collapse;width:100%;min-width:860px}th,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}td.n{text-align:right;font-variant-numeric:tabular-nums}td.id{font-weight:600}
.pill{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;font-weight:600;border:1px solid currentColor}
.PASS{color:var(--pass)}.FAIL{color:var(--fail)}.BLOCKED{color:var(--blocked)}.UNSUPPORTED{color:var(--unsup)}
details{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 14px;margin:10px 0}summary{cursor:pointer}
dl{display:grid;grid-template-columns:180px 1fr;gap:4px 12px;margin:10px 0}dt{color:var(--muted)}dd{margin:0}
@media (max-width:640px){dl{grid-template-columns:1fr}}
.req{font-style:italic}code{font-size:12px}.cos{padding-left:18px}.cos li{margin:4px 0}small{color:var(--muted)}
.note{color:var(--muted);font-size:13px;margin-top:24px}
</style></head><body><main>
<h1>ATLAS discovery baseline</h1>
<p class="sub">${esc(BENCHMARK_VERSION)} · offline (synthetic providers, network blocked) · generated ${esc(generatedAt)}</p>
<div class="tiles"><div class="tile"><b class="PASS">${count("PASS")}</b>PASS</div><div class="tile"><b class="FAIL">${count("FAIL")}</b>FAIL</div>
<div class="tile"><b class="BLOCKED">${count("BLOCKED")}</b>BLOCKED</div><div class="tile"><b class="UNSUPPORTED">${count("UNSUPPORTED")}</b>UNSUPPORTED</div></div>
<div class="table-wrap"><table><thead><tr><th>ID</th><th>Scenario</th><th>Verdict</th><th>Strategy</th><th>Unique</th><th>Qualified</th><th>Rejected</th><th>Review</th><th>Precision</th><th>Apify (≤)</th><th>LO records</th><th>$ / qualified</th></tr></thead>
<tbody>${rows}</tbody></table></div>
<h2>Scenarios</h2>
${details}
<p class="note">Apify cost is an estimated UPPER BOUND: the synchronous actor run reports no charge, so the ledger records the worst case for the items returned. LeadOcean is billed in records. Precision and recall are measured against each scenario's ground truth over synthetic data; they show what ATLAS's rules do, not live provider quality. X1–X2 are supplementary combined-strategy runs and F1–F2 failure-injection runs; both are outside the 12-scenario matrix (the tiles count only the 12).</p>
</main></body></html>
`;
}

function arg(name: string): string | undefined {
  const i = Deno.args.indexOf(name);
  return i >= 0 ? Deno.args[i + 1] : undefined;
}

if (import.meta.main) {
  const out = arg("--out") ?? DEFAULT_OUT;
  const results = await baseline();
  const rows = results.map(summaryRow);
  if (Deno.args.includes("--check")) {
    const recorded = JSON.parse(await Deno.readTextFile(`${out}/baseline.json`)).summary as ReturnType<typeof summaryRow>[];
    const diff = rows.flatMap((r) => {
      const b = recorded.find((x) => x.id === r.id);
      if (!b) return [`${r.id}: new`];
      return Object.keys(r).filter((k) => JSON.stringify((r as Record<string, unknown>)[k]) !== JSON.stringify((b as Record<string, unknown>)[k])).map((k) => `${r.id}.${k}: ${JSON.stringify((b as Record<string, unknown>)[k])} → ${JSON.stringify((r as Record<string, unknown>)[k])}`);
    });
    console.log(diff.length ? diff.join("\n") : `baseline unchanged (${rows.length} scenarios)`);
    if (diff.length) Deno.exit(1);
  } else {
    await Deno.mkdir(out, { recursive: true });
    const generatedAt = new Date().toISOString().slice(0, 10);
    const full = results.map((r) => ({ ...r, record: r.record ? { ...r.record, runtimeMs: undefined } : null }));
    await Deno.writeTextFile(`${out}/baseline.json`, JSON.stringify({ version: BENCHMARK_VERSION, mode: "offline", generatedAt, summary: rows, results: full }, null, 1) + "\n");
    await Deno.writeTextFile(`${out}/baseline.csv`, toCsv(rows));
    await Deno.writeTextFile(`${out}/index.html`, toHtml(results, generatedAt));
    console.log(`wrote ${out}/baseline.json, baseline.csv, index.html`);
    for (const r of rows) console.log(`${r.id} ${r.verdict}`);
  }
}

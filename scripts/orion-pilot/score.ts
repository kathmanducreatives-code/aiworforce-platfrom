// SCORE A RECORDED ORION PILOT RUN AGAINST THE ACCEPTANCE CRITERIA. Offline; no network.
//
//   deno run --allow-read scripts/orion-pilot/score.ts transcript.json [baseline.json]
//
// transcript.json: [{ question_id, answer, metadata, latency_ms }] — exported from
// TEST `messages` (see ORION_EVIDENCE_PILOT.md for the read-only export query) with
// the measured end-to-end latency of each turn. baseline.json: the same questions
// with the evidence flag OFF (for the speed delta). Prints every criterion with
// PASS / FAIL and the numbers behind it.

import { PILOT_QUESTIONS, type Expectation } from "./questions.ts";

export interface Turn { question_id: string; answer: string; metadata?: Record<string, unknown> | null; latency_ms: number }

export const ACCEPTANCE = Object.freeze({
  required_points_rate: 0.9,     // ≥ 90% of must_mention groups met across the 15
  citation_integrity: 1.0,       // 100% of [E#] refer to an evidence id recorded for that turn
  forbidden_recommendations: 0,  // never recommend a rejected / excluded / contradicted company
  isolation_leaks: 0,            // never mention the other workspace's canary
  freshness_flags: 1.0,          // 100% of stale / contradicted mentions are labelled as such
  action_rate: 0.8,              // ≥ 80% of action-expected answers name a next step + department
  retrieval_p95_ms: 800,         // evidence retrieval p95 on TEST
  e2e_p50_ms: 8000, e2e_p95_ms: 15000,
  evidence_overhead_p50_ms: 1000, // flag on vs off, p50 delta
  terra_calls: 0,                // routing stays disabled in this pilot
});

const lc = (s: string) => s.toLowerCase();
const pct = (xs: number[], p: number) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const DEPARTMENTS = /\b(ATLAS|LISA|LYRA|ORION)\b/;
const ACTION = /\b(next step|recommend|should|suggest|i'd|let's|run|research|draft|watch|monitor|approve|approval)\b/i;

export function scoreTurn(q: Expectation, t: Turn) {
  const gated = !!q.gate_acceptable && typeof t.metadata?.gated === "string";
  const a = t.answer ?? "", al = lc(a);
  const met = q.must_mention.filter((alts) => alts.some((x) => al.includes(lc(x)))).length;
  const leaks = q.must_not_mention.filter((x) => al.includes(lc(x)) || JSON.stringify(t.metadata ?? {}).includes(x));
  const sentences = a.split(/(?<=[.!?\n])\s+/);
  const forbidden = q.must_not_recommend.filter((c) => sentences.some((s) => s.includes(c) &&
    /\b(prioriti|pursue|recommend|contact|target|focus on|research|reach out)/i.test(s) &&
    !/\b(not|don't|do not|avoid|skip|exclud|reject|deprioriti|instead|rather than|contradict|stale)/i.test(s)));
  const cited = [...new Set([...a.matchAll(/\[E(\d+)\]/g)].map((m) => Number(m[1])))];
  const ev = (t.metadata?.orion_evidence as { cited_ids?: string[]; retrieval_ms?: number } | undefined) ?? null;
  const citationsOk = cited.every((n) => ev?.cited_ids && n >= 1 && n <= ev.cited_ids.length);
  const freshnessNeeded = [/pinecrest/i.test(a), /ridgeway/i.test(a)];
  const freshnessOk = [
    !freshnessNeeded[0] || /\b(stale|old|months|130|outdated|not recent|forum|unverified)\b/i.test(a),
    !freshnessNeeded[1] || /\b(contradict|denied|disputed|conflict)/i.test(a),
  ];
  const route = t.metadata?.model_route as { decision?: string } | undefined;
  return {
    id: q.id, category: q.category, gated,
    required: gated ? { met: 0, of: 0 } : { met, of: q.must_mention.length }, leaks, forbidden,
    citations: { cited: cited.length, ok: citationsOk },
    freshness: { checked: freshnessNeeded.filter(Boolean).length, ok: freshnessOk.filter((x, i) => freshnessNeeded[i] && x).length },
    action: q.expects_action && !gated ? (ACTION.test(a) && DEPARTMENTS.test(a)) : null,
    retrieval_ms: typeof ev?.retrieval_ms === "number" ? ev.retrieval_ms : null,
    latency_ms: t.latency_ms, terra: route?.decision === "terra",
  };
}

export function scoreRun(turns: readonly Turn[], baseline: readonly Turn[] = []) {
  const rows = PILOT_QUESTIONS.map((q) => { const t = turns.find((x) => x.question_id === q.id); return t ? scoreTurn(q, t) : null; });
  const done = rows.filter((r): r is NonNullable<typeof r> => !!r);
  const req = done.reduce((s, r) => ({ met: s.met + r.required.met, of: s.of + r.required.of }), { met: 0, of: 0 });
  const fresh = done.reduce((s, r) => ({ ok: s.ok + r.freshness.ok, of: s.of + r.freshness.checked }), { ok: 0, of: 0 });
  const actions = done.filter((r) => r.action !== null);
  const retr = done.map((r) => r.retrieval_ms).filter((x): x is number => x != null);
  const lat = done.map((r) => r.latency_ms);
  const baseP50 = pct(baseline.map((b) => b.latency_ms), 0.5);
  const A = ACCEPTANCE;
  const criteria = {
    answered: { value: `${done.length}/15`, pass: done.length === 15 },
    gated_by_missing_brain: { value: done.filter((r) => r.gated).map((r) => r.id), pass: null },
    evidence_required_points: { value: req.of ? req.met / req.of : null, pass: req.of > 0 && req.met / req.of >= A.required_points_rate },
    evidence_citation_integrity: { value: done.filter((r) => r.citations.ok).length / Math.max(1, done.length), pass: done.every((r) => r.citations.ok) },
    evidence_forbidden_recommendations: { value: done.reduce((s, r) => s + r.forbidden.length, 0), pass: done.every((r) => r.forbidden.length === 0) },
    freshness_labels: { value: fresh.of ? fresh.ok / fresh.of : null, pass: fresh.ok === fresh.of },
    isolation_leaks: { value: done.reduce((s, r) => s + r.leaks.length, 0), pass: done.every((r) => r.leaks.length === 0) },
    usefulness_action_rate: { value: actions.length ? actions.filter((r) => r.action).length / actions.length : null,
      pass: actions.length > 0 && actions.filter((r) => r.action).length / actions.length >= A.action_rate },
    speed_retrieval_p95_ms: { value: pct(retr, 0.95), pass: retr.length > 0 && (pct(retr, 0.95) ?? Infinity) <= A.retrieval_p95_ms },
    speed_e2e_p50_ms: { value: pct(lat, 0.5), pass: (pct(lat, 0.5) ?? Infinity) <= A.e2e_p50_ms },
    speed_e2e_p95_ms: { value: pct(lat, 0.95), pass: (pct(lat, 0.95) ?? Infinity) <= A.e2e_p95_ms },
    speed_evidence_overhead_p50_ms: { value: baseP50 == null ? null : (pct(lat, 0.5) ?? 0) - baseP50,
      pass: baseP50 == null ? null : (pct(lat, 0.5) ?? 0) - baseP50 <= A.evidence_overhead_p50_ms },
    cost_terra_calls: { value: done.filter((r) => r.terra).length, pass: done.every((r) => !r.terra) },
  };
  return { criteria, rows: done, note: "Usefulness also needs the blind human grade (mean ≥ 4.0/5) — not computable here." };
}

if (import.meta.main) {
  const [file, base] = Deno.args;
  if (!file) { console.log("usage: score.ts transcript.json [baseline.json]"); Deno.exit(2); }
  const out = scoreRun(JSON.parse(Deno.readTextFileSync(file)), base ? JSON.parse(Deno.readTextFileSync(base)) : []);
  for (const [k, v] of Object.entries(out.criteria)) console.log(`${v.pass === null ? "N/A " : v.pass ? "PASS" : "FAIL"}  ${k.padEnd(36)} ${JSON.stringify(v.value)}`);
  console.log(out.note);
}

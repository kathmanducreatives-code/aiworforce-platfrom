// A RATCHET: EXISTING DEBT IS ALLOWED, NEW DEBT IS NOT.
//
// The frontend carries type and lint debt that predates CI (23 `tsc` errors, all
// in the unrouted Talent Intelligence scrapers; ~1,300 eslint errors). Gating on
// zero would keep CI red until a cleanup nobody has scheduled; not gating at all
// lets the debt grow. So each finding is counted per FILE and per CODE/RULE and
// compared against a committed baseline: any count that rises fails, any that
// falls is reported so the baseline can be lowered.
//
// Pure: parsing and comparison only. `ratchet.mjs` runs the tools.

/** Normalise a path to repo-relative with forward slashes, so a baseline is portable. */
export function relPath(p, root) {
  let s = String(p).replace(/\\/g, "/");
  const r = String(root).replace(/\\/g, "/").replace(/\/+$/, "");
  if (r && s.startsWith(r + "/")) s = s.slice(r.length + 1);
  return s.replace(/^\.\//, "");
}

/** `tsc --pretty false` output → { "file|TS1234": count }. */
export function parseTsc(text, root = "") {
  const counts = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^(.+?)\(\d+,\d+\): error (TS\d+):/.exec(line);
    if (!m) continue;
    const key = `${relPath(m[1], root)}|${m[2]}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/** `eslint -f json` output → { "file|rule": count }, errors only (severity 2). */
export function parseEslint(json, root = "") {
  const counts = {};
  const results = typeof json === "string" ? JSON.parse(json) : json;
  for (const r of results ?? []) {
    for (const msg of r.messages ?? []) {
      if (msg.severity !== 2) continue;
      const key = `${relPath(r.filePath, root)}|${msg.ruleId ?? "parse-error"}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  return counts;
}

/**
 * Compare against the baseline. `regressions` fail the check; `improvements`
 * mean the baseline can be lowered (`ratchet.mjs <tool> --update`).
 */
export function compareCounts(current, baseline) {
  const regressions = [];
  const improvements = [];
  for (const [key, n] of Object.entries(current)) {
    const was = baseline[key] ?? 0;
    if (n > was) regressions.push({ key, was, now: n });
  }
  for (const [key, was] of Object.entries(baseline)) {
    const n = current[key] ?? 0;
    if (n < was) improvements.push({ key, was, now: n });
  }
  const total = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  regressions.sort((a, b) => a.key.localeCompare(b.key));
  improvements.sort((a, b) => a.key.localeCompare(b.key));
  return { ok: regressions.length === 0, regressions, improvements, total_now: total(current), total_baseline: total(baseline) };
}

/** Stable JSON for a baseline file: sorted keys, one per line, trailing newline. */
export function formatBaseline(counts) {
  const sorted = Object.fromEntries(Object.keys(counts).sort().map((k) => [k, counts[k]]));
  return JSON.stringify(sorted, null, 1) + "\n";
}

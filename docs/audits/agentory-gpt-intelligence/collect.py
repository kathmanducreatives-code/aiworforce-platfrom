"""Collect local offline receipts; no network, credentials or application writes.

Run from repository root after the commands in testing.md. Output only under docs.
"""
import collections
import hashlib
import json
from pathlib import Path
import re

OUT = Path(__file__).parent / "evidence"
OUT.mkdir(exist_ok=True)
PINS = {
    "integration": "5d86703712205a04d059a39cf0d38a0621fc3ddb",
    "pr113": "671edf35da4b4271ffcbd849ffece856ebd1057f",
    "pr123": "2d0a6327978ba5605d12f6e2315af3df78041ccc",
    "pr125": "a542b2f1e768e48d3ee794145b982d910d8253c7",
}


def read_events(path, prefix):
    events = []
    for line in path.read_text().splitlines():
        start = line.find(prefix + " ")
        if start >= 0:
            events.append(json.loads(line[start + len(prefix) + 1:]))
    return events


def dump(name, value):
    (OUT / name).write_text(json.dumps(value, indent=2) + "\n")


summary = {}
for tag, sha in PINS.items():
    path = Path(f"/tmp/gpt-audit-{tag}-routing.log")
    rows = read_events(path, "ROUTING_TRACE")
    assert len(rows) == 40 and all(r["tested_commit"] == sha for r in rows)
    # Preserve real boundary outputs, omitting repetitive diagnostics only.
    for row in rows:
        row.pop("runtime_logs", None)
        row.pop("execution_state", None)
    (OUT / f"{tag}-routing.jsonl").write_text("".join(json.dumps(r, separators=(",", ":")) + "\n" for r in rows))
    semantic = read_events(path, "ROUTING_SEMANTIC_ASSERTION")
    summary[tag] = {
        "sha": sha, "runtime_scenarios": len(rows),
        "status_counts": dict(collections.Counter(r["status"] for r in rows)),
        "semantic_assertions": semantic,
        "characterization": re.findall(r"ok \| \d+ passed \| \d+ failed", path.read_text())[-1:],
        "raw_log_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    }
dump("routing-summary.json", summary)
for tag in ("integration", "pr125"):
    path = Path(f"/tmp/gpt-audit-probe-{tag}.log")
    dump(f"{tag}-probes.json", {"sha": PINS[tag], "compiler_probes": read_events(path, "INTELLIGENCE_PROBE"), "risk_probes": read_events(path, "INTELLIGENCE_RISK")})
for name in ("focused", "budget", "semantic-controls", "semantic-controls-runtime", "q2-evidence", "pr125-strict", "truncation-red"):
    text = Path(f"/tmp/gpt-audit-{name}.log").read_text()
    # ANSI escapes are terminal presentation, not test evidence.
    text = re.sub(r"\x1b\[[0-9;]*m", "", text)
    if name in ("pr125-strict", "truncation-red"):
        text = "\n".join(text.splitlines()[-40:]) + "\n"
    (OUT / f"{name}.txt").write_text("\n".join(line.rstrip() for line in text.splitlines()).strip() + "\n")

# Syntactic cross-check, not an assertion that every factory is invoked per mission.
sites = []
pattern = re.compile(r"\b(gptStructured|generateText|generateJson|understandRequest|createGpt\w+|makeGpt\w+)\s*(?:<[^\n]+?>)?\s*\(")
for directory in ("supabase/functions", "worker", "src"):
    for p in sorted(Path(directory).rglob("*.ts")):
        if p.as_posix().endswith("/mcp/index.ts"):
            continue
        for n, line in enumerate(p.read_text().splitlines(), 1):
            if line.lstrip().startswith(("//", "*", "import ")) or "export function" in line or "export async function" in line:
                continue
            for m in pattern.finditer(line):
                sites.append({"path": p.as_posix(), "line": n, "symbol": m[1], "source": line.strip(), "url": f"https://github.com/kathmanducreatives-code/aiworforce-platfrom/blob/{PINS['integration']}/{p.as_posix()}#L{n}"})
dump("model-call-sites.json", {"sha": PINS["integration"], "method": "regex cross-check of calls and factory wiring; curated runtime interpretation in current-map.md; not a call-count receipt", "sites": sites})
dump("snapshot.json", {"pins": PINS, "date": "2026-10-20", "routing_harness_sha": "aca94e6b739e5f5c129ae0e11b56676e9da09c80", "external_execution": False, "database_writes": False, "paid_calls": 0, "notes": "Synthetic transports and pure modules only; no native DB or deployed receipts. PR heads remain separate from integration."})

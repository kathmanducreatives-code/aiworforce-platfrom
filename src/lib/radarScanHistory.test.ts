import { describe, it, expect } from "vitest";
import { listScanRuns, currentScanRunId, signalsForRun, currentScanSignals, type ScanScopedSignal } from "./radarScanHistory";

const signals: ScanScopedSignal[] = [
  { id: "1", created_at: "2026-07-12T10:00:00Z", raw: { scan_run_id: "runB" } },
  { id: "2", created_at: "2026-07-12T10:01:00Z", raw: { scan_run_id: "runB" } },
  { id: "3", created_at: "2026-07-11T09:00:00Z", raw: { scan_run_id: "runA" } },
  { id: "4", created_at: "2026-07-10T09:00:00Z", raw: {} }, // legacy, no scan_run_id
];

describe("radar scan history", () => {
  it("lists runs newest-first with legacy last", () => {
    const runs = listScanRuns(signals);
    expect(runs.map((r) => r.scan_run_id)).toEqual(["runB", "runA", "legacy"]);
    expect(runs[0].count).toBe(2);
  });

  it("current run is the newest scan", () => {
    expect(currentScanRunId(signals)).toBe("runB");
  });

  it("current-scan isolation: only current run's signals count", () => {
    expect(currentScanSignals(signals).map((s) => s.id)).toEqual(["1", "2"]);
    // Previous run remains accessible separately.
    expect(signalsForRun(signals, "runA").map((s) => s.id)).toEqual(["3"]);
    // History does not leak into current.
    expect(currentScanSignals(signals).some((s) => s.id === "3")).toBe(false);
  });

  it("empty input → no current run", () => {
    expect(currentScanRunId([])).toBeNull();
    expect(currentScanSignals([])).toEqual([]);
  });
});

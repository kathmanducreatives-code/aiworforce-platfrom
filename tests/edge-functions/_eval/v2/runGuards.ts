// BENCHMARK V2 — WHAT STANDS BETWEEN THE LIVE RUNNER AND A PAID CALL.
//
//   verifyFrozen   every file the freeze manifest names still has its frozen
//                  SHA-256; the runner refuses on any drift, before any call.
//   SpendGuard     a hard ceiling on estimated spend. A run may START only if
//                  what has been spent, plus the worst case of one more run,
//                  stays within the ceiling. A run that reported no cost is
//                  charged the worst case, never zero.

/** Worst case for ONE arm run on one fixture: a GPT call is at most two attempts
 *  (one retry), each ≤ ~10k input and 2k output tokens at gpt-5.6-luna prices
 *  (≈ $0.0044 per attempt). Jev is far below this. */
export const RUN_COST_BOUND_USD = 0.01;

export class SpendGuard {
  private meteredUsd = 0;
  private unmeteredRuns = 0;
  constructor(readonly ceilingUsd: number, readonly boundUsd: number = RUN_COST_BOUND_USD) {
    if (!(ceilingUsd > 0) || !(boundUsd > 0)) throw new Error("SpendGuard needs a positive ceiling and bound");
  }
  /** The most that can have been spent so far. */
  get upperBoundUsd(): number { return this.meteredUsd + this.unmeteredRuns * this.boundUsd; }
  canStart(): boolean { return this.upperBoundUsd + this.boundUsd <= this.ceilingUsd; }
  /** The estimated costs of the calls ONE run made. None, or any unknown, charges the bound. */
  settle(costs: Array<number | null | undefined>): void {
    const known = costs.filter((c): c is number => typeof c === "number" && Number.isFinite(c) && c >= 0);
    if (costs.length === 0 || known.length < costs.length) this.unmeteredRuns++;
    this.meteredUsd += known.reduce((a, b) => a + b, 0);
  }
  report() {
    return { ceiling_usd: this.ceilingUsd, metered_usd: this.meteredUsd, unmetered_runs: this.unmeteredRuns, upper_bound_usd: this.upperBoundUsd };
  }
}

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Paths (relative to `root`) whose bytes no longer match their frozen hash. */
export async function verifyFrozen(hashes: Record<string, string>, root: URL): Promise<string[]> {
  const drift: string[] = [];
  for (const [path, want] of Object.entries(hashes)) {
    let got: string | null = null;
    try { got = await sha256Hex(await Deno.readFile(new URL(path, root))); } catch { /* missing */ }
    if (got !== want) drift.push(path);
  }
  return drift;
}

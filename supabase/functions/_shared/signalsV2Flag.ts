// SIGNALS_V2 — the single canonical flag gating Signals Storage V2 dual-writes.
//
// Phase 2 contract (docs/architecture/signals-storage-schema-v2.md):
//   * OFF by default, everywhere. There is no production-specific default.
//   * Server-side only: read from the Edge Function environment, never exposed to
//     or parsed from any frontend/user/tool input.
//   * STRICT parsing — only the three explicit values below enable it. Arbitrary
//     non-empty strings ("yes", "on", "TRUE!", "2") resolve to false so a typo can
//     never silently enable dual-writing.
//   * Test injection: pass a reader so tests never depend on real env state.

export const SIGNALS_V2_FLAG = "SIGNALS_V2";

/** The ONLY values that enable the flag (after trim + lowercase). */
export const SIGNALS_V2_ENABLED_VALUES: ReadonlySet<string> = new Set(["true", "1", "enabled"]);

export type EnvReader = (key: string) => string | undefined;

/** Strict, allowlist-only parse. Everything not explicitly enabled is OFF. */
export function parseSignalsV2Flag(raw: string | null | undefined): boolean {
  if (typeof raw !== "string") return false;
  return SIGNALS_V2_ENABLED_VALUES.has(raw.trim().toLowerCase());
}

/**
 * Resolve the flag from the server environment (or an injected reader in tests).
 * Missing env permission or any reader error resolves FALSE — never throws.
 */
export function isSignalsV2Enabled(read?: EnvReader): boolean {
  try {
    const get: EnvReader = read ?? ((k) => Deno.env.get(k));
    return parseSignalsV2Flag(get(SIGNALS_V2_FLAG));
  } catch {
    return false;
  }
}

/**
 * SIGNALS RECOVERY (2026-11-28): THE SIGNALS COLLECTORS WRITE THE CANONICAL STORE BY DEFAULT.
 *
 * `signal_events` is the one store every consumer reads (Signals page, LISA, ORION, executive
 * brief, dashboard, content, the ATLAS handoff). The radar and the monitoring scan used to write
 * it only behind SIGNALS_V2 (off by default), so a radar signal reached the page but never ORION.
 * For THESE collectors canonical writing is now on unless SIGNALS_V2 is explicitly switched off
 * ("false" / "0" / "off" / "disabled"). `isSignalsV2Enabled` (strict, default off) is unchanged
 * for every other caller — the ATLAS lead paths keep their own flag.
 */
export const SIGNALS_V2_DISABLED_VALUES: ReadonlySet<string> = new Set(["false", "0", "off", "disabled"]);
export function isCanonicalSignalWriteEnabled(read?: EnvReader): boolean {
  try {
    const raw = read ? read(SIGNALS_V2_FLAG) : (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(SIGNALS_V2_FLAG);
    return !(typeof raw === "string" && SIGNALS_V2_DISABLED_VALUES.has(raw.trim().toLowerCase()));
  } catch {
    return true;
  }
}

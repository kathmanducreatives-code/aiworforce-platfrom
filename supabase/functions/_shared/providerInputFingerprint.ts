// ONE FINGERPRINT FOR A PROVIDER CALL.
//
// ── WHAT WAS HERE BEFORE ───────────────────────────────────────────────────
//
// Three schemes, each canonicalising differently and each persisted somewhere:
//
//   hashInput          FNV-1a 32-bit   -> compiled_input_hash, and through it
//                                         logical_call_key and the credit
//                                         transaction's idempotency key
//   inputFingerprint   djb2 32-bit     -> completed_operations, the record that
//                                         stops a resume re-buying a search
//   _sha256Hex         SHA-256         -> actorInputPlanner's compiled calls
//
// Two of them are 32 bits. A 32-bit space is 4.3e9, and the value they protect
// is "do not buy this again" — a collision does not corrupt data, it silently
// SKIPS a paid call that should have been made, or charges for one that should
// have collided. Neither includes the actor: the same input aimed at two
// different actors hashed identically, and only the capability segment of the
// surrounding key kept them apart.
//
// ── WHY THIS IS SYNCHRONOUS ────────────────────────────────────────────────
//
// `crypto.subtle.digest` is async-only. Every actor compiler in
// `hiringActorInputs.ts` is synchronous and is called from synchronous stretches
// of the engine, so an async digest would turn a hashing change into a rewrite
// of the compile path. The implementation below is FIPS 180-4 SHA-256, verified
// in the tests against the NIST vectors and against `crypto.subtle` itself.

// ── canonical form ─────────────────────────────────────────────────────────

/**
 * Canonical JSON: object keys sorted, `undefined` dropped, arrays left in order.
 *
 * Array ORDER IS SIGNIFICANT and deliberately so — `companies: [a, b]` and
 * `[b, a]` are the same question, but `jobTitles` order can change which rows a
 * capped actor returns. Treating them as equal would let a materially different
 * call reuse a cheaper one's result.
 */
export function canonicalJson(v: unknown): string {
  if (v === undefined) return "null";
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${
    Object.keys(o).sort()
      .filter((k) => o[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(",")
  }}`;
}

// ── SHA-256, synchronous ───────────────────────────────────────────────────

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

/** FIPS 180-4 SHA-256 over UTF-8, hex-encoded. Synchronous by necessity. */
export function sha256Hex(message: string): string {
  const bytes = new TextEncoder().encode(message);
  const bitLen = bytes.length * 8;
  // message + 0x80 + zero pad to 56 mod 64 + 8-byte big-endian length
  const padded = new Uint8Array(((bytes.length + 8) >> 6) * 64 + 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const dv = new DataView(padded.buffer);
  // Length is written as 64-bit big-endian; JS numbers are safe well past any
  // payload this system produces, so the high word is derived by division.
  dv.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  dv.setUint32(padded.length - 4, bitLen >>> 0);

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);

  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  return [...h].map((x) => x.toString(16).padStart(8, "0")).join("");
}

// ── the fingerprint ────────────────────────────────────────────────────────

export const PROVIDER_FINGERPRINT_VERSION = "v2" as const;

/** How many hex characters of the digest a persisted key carries. */
export const FINGERPRINT_HEX_LENGTH = 24;

/**
 * The canonical fingerprint of a provider call.
 *
 * `actorKey` IS part of the hash. The same input aimed at two actors is two
 * different purchases, and the old schemes could only tell them apart through
 * whatever surrounded the hash in the key.
 *
 * Prefixed `v2:` so a persisted value announces its own scheme. Anything without
 * a prefix is a legacy 32-bit hash and is treated as such — see
 * `fingerprintMatches`.
 */
export function providerInputFingerprint(actorKey: string, input: unknown): string {
  const digest = sha256Hex(canonicalJson({ actorKey, input }));
  return `${PROVIDER_FINGERPRINT_VERSION}:${digest.slice(0, FINGERPRINT_HEX_LENGTH)}`;
}

/** True when a persisted fingerprint was written by the v2 scheme. */
export function isV2Fingerprint(s: unknown): boolean {
  return typeof s === "string" && s.startsWith(`${PROVIDER_FINGERPRINT_VERSION}:`);
}

// ── legacy, kept ONLY so already-paid work stays recognisable ───────────────
//
// These reproduce the two 32-bit schemes byte for byte. They are never used to
// WRITE a new key; they exist so a checkpoint written before this change still
// answers "yes, that search was already bought".

/** FNV-1a 32-bit over the old `canonical()` form. Historical reads only. */
export function legacyFnvHash(v: unknown): string {
  const s = canonicalJson(v);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** djb2 32-bit over the old `inputFingerprint` form. Historical reads only. */
export function legacyDjb2Fingerprint(input: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .filter(([, x]) => x !== undefined && x !== null)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, x]) => [k, norm(x)]));
    }
    return v;
  };
  const s = JSON.stringify(norm(input));
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

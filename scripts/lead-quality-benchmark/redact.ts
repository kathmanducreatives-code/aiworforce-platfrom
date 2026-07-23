// Secret-safe logging.
//
// The benchmark must never print or log Supabase access tokens, service-role
// keys, Apify tokens, Authorization headers, cookies, or provider secrets. All
// guard/preflight code works with credential *presence* (booleans), never the
// values — but any place that echoes a config object routes through here as a
// defence in depth.

const SENSITIVE_KEY_RE =
  /(token|secret|key|authorization|auth|cookie|password|bearer|apikey|api_key|service_role|anon_key|jwt|session)/i;

/** Redact any value whose key looks sensitive; recurse into nested objects. */
export function redact<T>(value: T): T {
  return redactInner(value, 0) as T;
}

function redactInner(value: unknown, depth: number): unknown {
  if (depth > 8) return "[…]";
  if (Array.isArray(value)) return value.map((v) => redactInner(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY_RE.test(k) ? "[REDACTED]" : redactInner(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** True when a string looks like a credential we must never print. */
export function looksSensitive(s: string): boolean {
  const t = s.trim();
  if (t.length === 0) return false;
  // JWT-shaped, sb-* keys, long high-entropy tokens.
  if (/^ey[A-Za-z0-9_-]{10,}\./.test(t)) return true;
  if (/^sb[ps]?_[A-Za-z0-9]{16,}$/.test(t)) return true;
  if (/^apify_api_[A-Za-z0-9]{16,}$/i.test(t)) return true;
  if (/^Bearer\s+/i.test(t)) return true;
  return false;
}

/** Console logger that redacts objects and refuses to print sensitive strings. */
export function safeLog(message: string, detail?: unknown): void {
  if (looksSensitive(message)) {
    console.log("[benchmark] [REDACTED message]");
    return;
  }
  if (detail === undefined) console.log(message);
  else console.log(message, redact(detail));
}

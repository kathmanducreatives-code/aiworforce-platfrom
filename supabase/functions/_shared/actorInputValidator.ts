// actorInputValidator: deterministic safety net around any generated (Gemini)
// or deterministic actor input. Gemini PLANS the input; this module is the
// guardrail that decides whether it may run. Never trusts the model blindly.

import { getActorByKey } from "./actorRegistry.ts";
import {
  type ActorInputSchema,
  GENERIC_TOP_LEVEL_KEYS,
} from "./actorInputSchemas.ts";

export type ValidationResult = {
  ok: boolean;
  reason?: string;
  errors: string[];
  warnings: string[];
};

// Outbound / fake-data field names that must NEVER appear in a sourcing input —
// sourcing only READS public data; sending/posting is a separate approval-gated
// path. Also blocks fabricated contact fields sneaking into the actor input.
const FORBIDDEN_KEY_RE =
  /\b(send|sender|post|posting|publish|comment(?:ing)?|dm|message|email|reply|connect|invite|outreach|fromEmail|smtp|webhook|phone|phone_number|personal_email)\b/i;

const MAX_QUERY_CHARS = 160;
const MAX_QUERY_WORDS = 16;

function deepKeys(obj: unknown, prefix = ""): string[] {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return [];
  const out: string[] = [];
  for (const k of Object.keys(obj as Record<string, unknown>)) {
    out.push(prefix + k);
    const v = (obj as Record<string, unknown>)[k];
    if (v && typeof v === "object" && !Array.isArray(v)) out.push(...deepKeys(v, prefix + k + "."));
  }
  return out;
}

function actorCap(schema: ActorInputSchema): number {
  const reg = getActorByKey(schema.actor_key);
  return reg?.max_safe_results ?? 100;
}

function getPath(input: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), input);
}

function isRawParagraph(q: string): boolean {
  const t = q.trim();
  if (t.length > MAX_QUERY_CHARS) return true;
  if (t.split(/\s+/).length > MAX_QUERY_WORDS) return true;
  // Full-sentence imperative ("Find me 5 companies that …") is not a search query.
  if (/^(find|get|source|please|i\s+(?:want|need)|can you|could you)\b/i.test(t) && t.split(/\s+/).length > 6) return true;
  return false;
}

/** Validate a GENERIC actor input against its schema. Does NOT mutate. */
export function validateActorInputAgainstSchema(
  input: Record<string, unknown>,
  schema: ActorInputSchema,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Unknown top-level fields.
  for (const k of Object.keys(input)) {
    if (!(GENERIC_TOP_LEVEL_KEYS as readonly string[]).includes(k)) {
      errors.push(`unknown top-level field: ${k}`);
    }
  }

  // 2. Unknown user_input keys.
  const ui = (input.user_input && typeof input.user_input === "object" && !Array.isArray(input.user_input))
    ? input.user_input as Record<string, unknown> : {};
  for (const k of Object.keys(ui)) {
    if (!schema.allowed_user_input_keys.includes(k)) errors.push(`unknown user_input key: ${k}`);
  }

  // 3. Forbidden outbound / fake-contact fields anywhere.
  for (const key of deepKeys(input)) {
    const leaf = key.split(".").pop() ?? key;
    if (FORBIDDEN_KEY_RE.test(leaf)) errors.push(`forbidden field (outbound/fake-data): ${key}`);
  }

  // 4. max_results present + capped.
  const cap = actorCap(schema);
  const mr = input[schema.max_results_field];
  if (typeof mr !== "number" || !Number.isFinite(mr) || mr < 1) {
    errors.push(`${schema.max_results_field} must be a positive number`);
  } else if (mr > cap) {
    warnings.push(`${schema.max_results_field} ${mr} exceeds actor cap ${cap}`);
  }

  // 5. Required schema fields present (top-level or dotted).
  for (const f of schema.fields) {
    if (!f.required) continue;
    const path = f.path ?? f.name;
    const v = getPath(input, path);
    if (v === undefined || v === null || (Array.isArray(v) && v.length === 0) || (typeof v === "string" && !v.trim())) {
      errors.push(`missing required field: ${path}`);
    }
  }

  // 6. Query quality (only when the actor uses a query). Empty + raw-paragraph guards.
  if (schema.query_fields.length > 0) {
    const queryValues = schema.query_fields.map((qf) => getPath(input, qf)).filter(Boolean);
    const hasAnyQuery = queryValues.some((v) =>
      (typeof v === "string" && v.trim().length > 0) || (Array.isArray(v) && v.length > 0));
    if (!hasAnyQuery) {
      errors.push("empty query: no query / user_input keyword provided");
    } else {
      for (const v of queryValues) {
        if (typeof v === "string" && isRawParagraph(v)) errors.push(`raw-paragraph query rejected: "${v.slice(0, 40)}…"`);
      }
    }
  }

  return { ok: errors.length === 0, reason: errors[0], errors, warnings };
}

/** Strip unknown fields, cap counts, trim — returns a safe input to run. */
export function sanitizeActorInput(
  input: Record<string, unknown>,
  schema: ActorInputSchema,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of GENERIC_TOP_LEVEL_KEYS) {
    if (input[k] !== undefined) out[k] = input[k];
  }
  // Cap max_results.
  const cap = actorCap(schema);
  const mr = Number(out[schema.max_results_field]);
  out[schema.max_results_field] = Math.max(1, Math.min(cap, Number.isFinite(mr) && mr > 0 ? mr : 5));
  // Filter user_input keys to the allowed set.
  if (out.user_input && typeof out.user_input === "object" && !Array.isArray(out.user_input)) {
    const ui = out.user_input as Record<string, unknown>;
    const clean: Record<string, unknown> = {};
    for (const k of schema.allowed_user_input_keys) if (ui[k] !== undefined) clean[k] = ui[k];
    out.user_input = clean;
  }
  // Trim string query/location.
  if (typeof out.query === "string") out.query = out.query.trim();
  if (typeof out.location === "string") out.location = (out.location as string).trim() || undefined;
  if (Array.isArray(out.role_keywords)) out.role_keywords = (out.role_keywords as unknown[]).filter((r) => typeof r === "string" && r.trim()).map((r) => (r as string).trim());
  return out;
}

export type StrictRequestContext = {
  // strict.* flags from sourcingRetry.parseStrictConstraints, plus the literal
  // strict location the user named (e.g. "London").
  strict: { location?: boolean; industry?: boolean; stage?: boolean; count_exact?: boolean };
  strict_location_value?: string | null;
};

/** Enforce user strict constraints on the (already schema-valid) input. */
export function validateStrictConstraints(
  input: Record<string, unknown>,
  ctx: StrictRequestContext,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (ctx.strict?.location && ctx.strict_location_value) {
    const loc = typeof input.location === "string" ? input.location.toLowerCase() : "";
    const want = ctx.strict_location_value.toLowerCase();
    if (loc && !loc.includes(want) && !want.includes(loc)) {
      errors.push(`strict location violated: requested "${ctx.strict_location_value}" but input.location="${input.location}"`);
    }
    if (!loc) warnings.push("strict location set but input.location is empty");
  }
  return { ok: errors.length === 0, reason: errors[0], errors, warnings };
}

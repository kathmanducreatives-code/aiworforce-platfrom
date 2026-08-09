// PHASE 0A — JWT-SHAPED SECRETS MUST NOT REACH THE LEDGER.
//
// The existing redaction covers Apify tokens, sk-* keys, Bearer values,
// token-bearing URLs and secret-shaped keys. The gap: a JWT under a key the
// pattern list does not recognise — `idToken`, `sessionToken`, `cookies`,
// `supabaseAccessToken` — or under an entirely unremarkable key such as
// `auth_context`, survives into `request_input`.
//
// That matters more than a generic secret would: a Supabase JWT is a live
// credential carrying workspace scope, and `request_input` is the one column
// deliberately designed to be readable so a malformed provider input can be
// reproduced.
//
// The negative half is equally load-bearing. Over-matching dotted strings would
// redact `example.com` and `version.1.2` out of provider inputs and destroy the
// reproducibility the column exists for.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  redactProviderInput, buildStartedRow, REDACTED,
} from "../../../supabase/functions/_shared/executionLedger.ts";

// A structurally real JWT: three base64url segments, header starts `eyJ`.
const JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" +
  ".eyJzdWIiOiIxMjM0NTY3ODkwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSJ9" +
  ".dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk";

const serialize = (v: unknown) => JSON.stringify(redactProviderInput(v));

// ═══ KEY-BASED REDACTION ══════════════════════════════════════════════════

Deno.test("redaction: JWT-bearing key names are redacted", () => {
  for (const key of [
    "jwt", "JWT", "idToken", "id_token", "sessionToken", "session-token",
    "cookies", "cookie", "supabaseAccessToken", "supabase_access_token",
    "refreshToken", "accessToken", "authorization", "apiKey", "token",
  ]) {
    const out = serialize({ [key]: JWT, keep: "visible" });
    assert(!out.includes("eyJhbGci"), `secret survived under key "${key}": ${out}`);
    assert(out.includes(REDACTED), `key "${key}" should have produced a redaction marker`);
    assert(out.includes("visible"), "unrelated fields must survive");
  }
});

Deno.test("redaction: nested and arrayed secret keys are covered", () => {
  const out = serialize({
    provider: { session: { sessionToken: JWT } },
    list: [{ idToken: JWT }, { cookies: JWT }],
  });
  assert(!out.includes("eyJhbGci"), out);
});

// ═══ VALUE-BASED REDACTION ════════════════════════════════════════════════

Deno.test("redaction: a bare JWT is redacted under ANY key name", () => {
  // The point of value-based detection: the key gives no warning at all.
  for (const key of ["auth_context", "ctx", "note", "payload", "x"]) {
    const out = serialize({ [key]: JWT });
    assert(!out.includes("eyJhbGci"), `bare JWT survived under "${key}": ${out}`);
    assert(out.includes(REDACTED));
  }
});

Deno.test("redaction: a bare JWT nested in an array is redacted", () => {
  const out = serialize({ items: ["safe", JWT, { deep: JWT }] });
  assert(!out.includes("eyJhbGci"), out);
  assert(out.includes("safe"), "non-secret array members must survive");
});

// ═══ NEGATIVE: NO OVER-MATCHING ═══════════════════════════════════════════

Deno.test("redaction: ordinary dotted strings are NOT redacted", () => {
  const benign = {
    domain: "example.com",
    subdomain: "app.example.co.uk",
    version: "version.1.2",
    semver: "1.2.3",
    path: "some.nested.path",
    actor: "memo23/y-combinator-scraper",
    url: "https://www.linkedin.com/jobs/view/123",
    query: "b2b saas companies hiring sales",
    file: "report.final.pdf",
    ip: "192.168.0.1",
    // Three segments, but far too short to be a JWT.
    code: "ab.cd.ef",
  };
  const out = redactProviderInput(benign) as Record<string, string>;
  for (const [k, v] of Object.entries(benign)) {
    assertEquals(out[k], v, `"${k}" was redacted but is not a secret`);
  }
  assert(!JSON.stringify(out).includes(REDACTED),
    "no benign value may be redacted — this column exists to be reproducible");
});

Deno.test("redaction: a key merely CONTAINING 'id' is not treated as a token", () => {
  const benign = {
    id: "abc", company_id: "xyz", dataset_id: "ds_1", run_id: "run_1",
    identity: "founder", candidate_id: "c1",
  };
  const out = redactProviderInput(benign) as Record<string, string>;
  for (const [k, v] of Object.entries(benign)) {
    assertEquals(out[k], v, `"${k}" must not be redacted`);
  }
});

// ═══ EXISTING BEHAVIOUR PRESERVED ═════════════════════════════════════════

Deno.test("redaction: previously covered secrets still redacted", () => {
  const out = serialize({
    token: "apify_api_SUPERSECRET",
    apiKey: "sk-live-1234567890",
    Authorization: "Bearer abc.def.ghi",
    password: "hunter2",
    url: "https://api.apify.com/v2/acts/x/runs?token=apify_api_LEAKED&limit=5",
    bare: "apify_api_BARETOKEN",
  });
  for (const s of [
    "SUPERSECRET", "sk-live-1234567890", "abc.def.ghi", "hunter2",
    "LEAKED", "BARETOKEN",
  ]) {
    assert(!out.includes(s), `previously-covered secret regressed: ${s}`);
  }
  assert(out.includes("api.apify.com"), "the endpoint must stay legible");
});

// ═══ APPLIED BY THE LIFECYCLE ═════════════════════════════════════════════

Deno.test("redaction: a JWT cannot reach a persisted row", () => {
  const row = buildStartedRow({
    workspace_id: "w", stage: "company_discovery", reason: "initial_discovery",
    provider_id: "apify", logical_call_key: "k",
    request_input: { supabaseAccessToken: JWT, auth_context: JWT, maxItems: 25 },
  });
  const persisted = JSON.stringify(row.request_input);
  assert(!persisted.includes("eyJhbGci"), persisted);
  assertEquals((row.request_input as Record<string, unknown>).maxItems, 25,
    "reproducible fields must survive redaction");
});

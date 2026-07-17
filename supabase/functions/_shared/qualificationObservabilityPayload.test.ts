import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildQualificationObservability, type CandidateDiagnosticInput } from "./qualificationObservability.ts";

// A deliberately "hostile" input carrying PII, secrets, control chars, raw payload
// keys, and malformed URLs — mirroring what run-agent could pass from provider raw.
const hostile: CandidateDiagnosticInput[] = [
  {
    normalized_candidate_id: "nc_1",
    name: "Founder X\u0000\u0007 <script>",
    title: "CEO — reach me at ceo@acme.com or +1 (415) 555-9090",
    company: "Acme Bearer sk_live_ABCDEF token=eyJhbGciOi",
    source_url: "https://user:secretpass@www.linkedin.com/in/founderx?utm_source=x#frag",
    provider_verified: true, actor_key: "apify_people_search", actor_id: "harvestapi/linkedin-profile-search", artifact_type: "person_candidate",
    source_gate_decision: "needs_verification", tier: "rejected", deterministic_score: 20.7,
    qualification_decision: "reject", qualification_reason: "tier_rejected",
    matched_icp: [], evidence_present: ["linkedin person profile"], evidence_missing: ["a company-level buying signal"],
    evidence_violations: [], persisted: false, sent_to_downstream_aria: false,
    // stray raw-ish keys that must never pass through
    ...( { raw: { email: "leak@x.com", phone: "+1 415 555 0000" }, authorization: "Bearer abc" } as any),
  },
];

// (14) Credentials/tokens/headers/PII/raw never appear in the serialized payload.
Deno.test("payload sweep: no email/phone/token/authorization/raw leaks", () => {
  const obs = buildQualificationObservability({
    funnel: { raw_count: 1, normalized_count: 1, source_gate_accepted: 1, source_gate_rejected: 0, hard_gate_rejected: 0, qualification_accepted: 0, qualification_staged: 1, qualification_rejected: 0, persisted_count: 0, downstream_aria_count: 0 },
    candidates: hostile, requested_limit: 5,
  });
  const json = JSON.stringify(obs);
  assert(!/ceo@acme\.com|leak@x\.com/.test(json), "email leaked");
  assert(!/\+1[\s(]*415|555-9090|555 0000/.test(json), "phone leaked");
  assert(!/sk_live_|eyJhbGciOi|Bearer |authorization/i.test(json), "secret/header leaked");
  assert(!/"raw"|"email"|"phone"/.test(json), "raw/pii keys leaked");
  // The source_url with userinfo is dropped entirely (not exposed sans-credentials either way it is normalized without creds).
  assert(!/secretpass/.test(json), "url userinfo leaked");
  // Control chars stripped.
  assert(!/[\u0000-\u001F\u007F]/.test(json), "control chars leaked");
});

// (18)/(19) Staged/rejected diagnostics are never marked persisted (nothing that
// would drive a lead insert), and flags are truthful.
Deno.test("payload: rejected diagnostics are never persisted", () => {
  const obs = buildQualificationObservability({
    funnel: { raw_count: 1, normalized_count: 1, source_gate_accepted: 1, source_gate_rejected: 0, hard_gate_rejected: 0, qualification_accepted: 0, qualification_staged: 1, qualification_rejected: 0, persisted_count: 0, downstream_aria_count: 0 },
    candidates: hostile, requested_limit: 5,
  });
  assertEquals(obs.funnel.persisted_count, 0);
  for (const c of obs.candidates) {
    if (c.qualification_decision !== "accept") assertEquals(c.persisted, false);
  }
});

// (16)/(17) Funnel status semantics: 0 persisted ↔ no_results; >0 persisted ↔ partial/success.
Deno.test("payload: persisted_count distinguishes no_results from partial", () => {
  const zero = buildQualificationObservability({
    funnel: { raw_count: 5, normalized_count: 5, source_gate_accepted: 5, source_gate_rejected: 0, hard_gate_rejected: 0, qualification_accepted: 0, qualification_staged: 5, qualification_rejected: 0, persisted_count: 0, downstream_aria_count: 0 },
    candidates: [], requested_limit: 5,
  });
  assertEquals(zero.funnel.persisted_count, 0);          // → no_results
  assert(zero.funnel.staged_count > 0);
  const partial = buildQualificationObservability({
    funnel: { raw_count: 5, normalized_count: 5, source_gate_accepted: 5, source_gate_rejected: 0, hard_gate_rejected: 0, qualification_accepted: 2, qualification_staged: 3, qualification_rejected: 0, persisted_count: 2, downstream_aria_count: 5 },
    candidates: [], requested_limit: 5,
  });
  assert(partial.funnel.persisted_count > 0);            // → partial_results
  assert(partial.funnel.staged_count > 0);
  assertEquals(partial.funnel.reconciles, true);
});

// (20) Backward compatibility: observability is a self-contained object; building
// it requires no existing fields and returns a stable, JSON-serializable shape.
Deno.test("payload: self-contained and JSON round-trips", () => {
  const obs = buildQualificationObservability({
    funnel: { raw_count: 0, normalized_count: 0, source_gate_accepted: 0, source_gate_rejected: 0, hard_gate_rejected: 0, qualification_accepted: 0, qualification_rejected: 0, persisted_count: 0, downstream_aria_count: 0 },
    candidates: [],
  });
  const round = JSON.parse(JSON.stringify(obs));
  assertEquals(round.funnel.reconciles, true);
  assertEquals(round.candidates.length, 0);
  assertEquals(round.truncated, 0);
});

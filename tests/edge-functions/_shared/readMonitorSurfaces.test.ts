// THE TWO SURFACES PHASE D ADDS, AND THE GUARANTEES THEY CARRY.
//
//   read     answers from held evidence and CANNOT reach a provider
//   monitor  records an intention and buys nothing at that moment
//
// Pure except where a fake client stands in for the database. No network,
// no model, no provider.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  planRead, executeRead, renderReadAnswer, READ_SURFACE_VERSION,
} from "../../../supabase/functions/_shared/readSurface.ts";
import {
  planMonitor, executeMonitor, MONITOR_SURFACE_VERSION,
} from "../../../supabase/functions/_shared/monitorSurface.ts";
import {
  REQUEST_V1_VERSION, type RequestV1, type RequestPart, type RequestEntity,
} from "../../../supabase/functions/_shared/requestV1.ts";
import {
  REFERENT_BINDING_VERSION,
} from "../../../supabase/functions/_shared/referentBinding.ts";
import {
  resolveCompanyIdentity,
} from "../../../supabase/functions/_shared/companyIdentity.ts";

const req = (parts: RequestPart[]): RequestV1 => ({
  version: REQUEST_V1_VERSION, utterance: "u", objective: parts[0].objective,
  parts, ambiguity: [],
  authority: { may_spend: false, max_cost_units: null, requires_confirmation: true },
  provenance: {}, confidence: 0.9,
});
const readPart = (entity: RequestEntity, over: Partial<RequestPart> = {}): RequestPart => ({
  id: "p1", objective: "read", subject: { entity },
  output: { shape: entity === "signal" ? "events" : "records", count: null }, ...over,
});

// ══ 1. READ CANNOT REACH A PROVIDER ════════════════════════════════════════

Deno.test("the read surface imports nothing that could invoke a provider", async () => {
  // The guarantee is structural, not a flag. Nothing here can be invoked even
  // by mistake, which is why `read` is a separate objective at all.
  const SRC = await Deno.readTextFile(
    new URL("../../../supabase/functions/_shared/readSurface.ts", import.meta.url));
  const imports = SRC.split("\n").filter((l) => /^import\s/.test(l)).join("\n");
  for (const forbidden of [
    "toolRegistry", "leadCapabilityEngine", "apify", "creditAuthorization",
    "executionLedger", "gptProvider", "hiringActorInputs",
  ]) {
    assertEquals(imports.includes(forbidden), false,
      `readSurface must not import ${forbidden}`);
  }
});

Deno.test("entities map to targets, and an unknown entity refuses", () => {
  assertEquals(planRead(req([readPart("signal")])).target, "signals");
  assertEquals(planRead(req([readPart("company")])).target, "companies");
  assertEquals(planRead(req([readPart("person")])).target, "companies");
  assertEquals(planRead(req([readPart("conversation")])).target, "runs");
  const none = planRead(req([readPart("content")]));
  assertEquals(none.target, null);
  assert(none.unsupported!.startsWith("no_read_surface_for_entity"));
});

Deno.test("a read is bounded even when the user asks for everything", () => {
  // A chat answer is a summary, not an export.
  const p = planRead(req([readPart("signal", {
    output: { shape: "events", count: 5000 } })]));
  assertEquals(p.limit, 50);
});

Deno.test("a stated recency is honoured; an unstated one is not invented", () => {
  assertEquals(planRead(req([readPart("signal")])).since_days, null);
  const withDays = planRead(req([readPart("signal", {
    requirements: [{ event: "hiring", subject: "company", phrase: "this week",
      recency_days: 7 }] })]));
  assertEquals(withDays.since_days, 7);
});

Deno.test("a company read answers with BOTH leads and watched subjects", async () => {
  // Measured, not assumed: Chat Brain returns `entity: company` for "how many
  // leads do I have" AND "which companies am I watching". Guessing a table
  // from wording is the keyword matching this migration removes.
  const tables: string[] = [];
  const db = {
    from: (t: string) => {
      tables.push(t);
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "limit", "gte"]) {
        chain[m] = () => chain;
      }
      chain.then = undefined;
      return Object.assign(
        Promise.resolve({ data: t === "lead_candidates" ? [{ id: "1" }] : [{ label: "Vercel" }] }),
        chain);
    },
  };
  const r = await executeRead(db as never, planRead(req([readPart("company")])), "ws");
  assert(r);
  assert(tables.includes("lead_candidates") && tables.includes("monitoring_subjects"));
});

Deno.test("an empty workspace gets a real answer, not an error", () => {
  // "I found nothing" is a true answer about held evidence. Dressing it as a
  // failure sends the user hunting a bug instead of running a search.
  const plan = planRead(req([readPart("signal")]));
  const msg = renderReadAnswer(plan, { target: "signals", counts: {}, items: [], empty: true });
  assert(/don't have any signals/i.test(msg), msg);
});

Deno.test("the answer states only what the rows contain", () => {
  const plan = planRead(req([readPart("signal")]));
  const msg = renderReadAnswer(plan, {
    target: "signals",
    counts: { total: 3, hiring: 2, funding: 1 },
    items: [
      { subject_key: "vercel", signal_type: "hiring" },
      { subject_key: "linear", signal_type: "funding" },
    ],
    empty: false,
  });
  assert(msg.includes("3 signals"), msg);
  assert(msg.includes("vercel") && msg.includes("linear"));
  assertEquals(READ_SURFACE_VERSION, "read-surface-v1");
});

// ══ 2. MONITOR RECORDS, IT DOES NOT BUY ════════════════════════════════════

const monitorPart = (over: Partial<RequestPart> = {}): RequestPart => ({
  id: "p1", objective: "monitor", subject: { entity: "company" },
  output: { shape: "records", count: null }, ...over,
});

Deno.test("a monitor with no nameable subject is REFUSED, not guessed", () => {
  // A subject for the wrong company spends every cadence period, unattended,
  // forever. It is the worst shape of the wrong-entity mistake.
  const p = planMonitor(req([monitorPart()]));
  assertEquals(p.subject, null);
  assertEquals(p.refusal, "no_subject");
});

Deno.test("the BINDING is the identity; the user's words are the label", () => {
  // Phase E moved where the identity comes from, and the move is the point.
  //
  // This asserted that `resolved_key` was the identity — and `resolved_key`
  // arrives from the MODEL, copied verbatim by `parseRequestStrict` off
  // whatever it returned. So the model decided which real company this
  // workspace pays to watch, every cadence period, unattended, forever. That is
  // precisely the authority the binding sidecar exists to take away from it.
  //
  // The binding is produced by `resolveReferents` from a record the system
  // itself wrote, and its identity comes from `resolveCompanyIdentity` — the
  // same function the rest of the pipeline uses.
  const p = planMonitor(
    req([monitorPart({
      subject: {
        entity: "company",
        references: [{ kind: "prior_result", value: "them" }],
      },
    })]),
    [{
      version: REFERENT_BINDING_VERSION,
      part_id: "p1", entity_type: "company",
      entity_key: "domain:vercel.com", label: "Vercel",
      identity: resolveCompanyIdentity({
        name: "Vercel", domain: "vercel.com",
        linkedin_url: "https://www.linkedin.com/company/vercel",
      }),
      source: { message_id: "m1", result_index: 0, kind: "prior_result" },
      status: "verified_match",
    }],
  );
  assertEquals(p.subject!.identifier, "vercel.com");
  assertEquals(p.subject!.label, "Vercel");
});

Deno.test("a forged resolved_key never becomes a monitoring subject", () => {
  // The same claim from the attacker's side. A subject is a recurring, unattended
  // spend; a model that could name one could point it at any company it liked.
  const p = planMonitor(req([monitorPart({
    subject: { entity: "company", references: [{ kind: "prior_result", value: "Vercel",
      resolved_key: "https://www.linkedin.com/company/attacker" }] },
  })]));
  assertEquals(p.subject!.identifier, "Vercel");
  // Nothing the model wrote reached the row.
  assertEquals(/attacker/.test(JSON.stringify(p)), false);
});

Deno.test("only real signal events are recorded on a subject", () => {
  const p = planMonitor(req([monitorPart({
    subject: { entity: "company", references: [{ kind: "named", value: "Vercel" }] },
    requirements: [
      { event: "hiring", subject: "company", phrase: "hiring" },
      { event: "vibes" as never, subject: "company", phrase: "vibes" },
    ],
  })]));
  assertEquals(p.signals, ["hiring"]);
});

Deno.test("watching the same company twice does not create two subjects", async () => {
  // A duplicate row is duplicate unattended spend, every period.
  const inserts: unknown[] = [];
  const db = {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({
        maybeSingle: () => Promise.resolve({ data: { id: "existing", enabled: true } }) }) }) }),
      insert: (r: unknown) => { inserts.push(r); return Promise.resolve({ error: null }); },
    }),
  };
  const plan = planMonitor(req([monitorPart({
    subject: { entity: "company", references: [{ kind: "named", value: "Vercel" }] } })]));
  const out = await executeMonitor(db as never, plan, "ws");
  assertEquals(out.already_watching, true);
  assertEquals(out.created, false);
  assertEquals(inserts.length, 0, "nothing is written for a subject already watched");
});

Deno.test("a new subject is created enabled, and does NOT set its own cadence", async () => {
  // The column default is workspace policy. One chat sentence must not change
  // how often money is spent unattended.
  let written: Record<string, unknown> | null = null;
  const db = {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({
        maybeSingle: () => Promise.resolve({ data: null }) }) }) }),
      insert: (r: Record<string, unknown>) => { written = r; return Promise.resolve({ error: null }); },
    }),
  };
  const plan = planMonitor(req([monitorPart({
    subject: { entity: "company", references: [{ kind: "named", value: "Vercel" }] } })]));
  const out = await executeMonitor(db as never, plan, "ws");
  assertEquals(out.created, true);
  assertEquals(written!.enabled, true);
  assertEquals("cadence_minutes" in written!, false,
    "cadence is workspace policy, not a chat decision");
  assertEquals(MONITOR_SURFACE_VERSION, "monitor-surface-v1");
});

Deno.test("the monitor surface starts no scan", async () => {
  const SRC = await Deno.readTextFile(
    new URL("../../../supabase/functions/_shared/monitorSurface.ts", import.meta.url));
  const imports = SRC.split("\n").filter((l) => /^import\s/.test(l)).join("\n");
  for (const forbidden of ["toolRegistry", "leadCapabilityEngine", "apify", "monitoringSchedule"]) {
    assertEquals(imports.includes(forbidden), false, `must not import ${forbidden}`);
  }
  const code = SRC.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
  assertEquals(/run-monitoring|invokeScan|startScan/.test(code), false,
    "recording an intention must not start a run");
});

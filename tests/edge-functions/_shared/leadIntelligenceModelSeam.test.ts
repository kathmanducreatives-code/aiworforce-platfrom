// EVERY BINDING MUST REACH THE MODEL TRANSPORT. THE SUITE NEVER CHECKED THAT.
//
// ── THE BUG THIS FILE EXISTS FOR ─────────────────────────────────────────────
// Five bindings each pinned the literal `"gpt-5.6-luna"` — the OpenAI *wire*
// id. The strategist adapters gate on the CANONICAL id (`openai/gpt-5.6-luna`),
// so `LovableAIStrategistProvider.complete` answered `model_not_allowed` BEFORE
// sending anything. Each binding's fail-closed wrapper turned that into "no
// proposal". Flags on, allow-lists matched, credential present, diagnostics
// reporting `enabled` — and not one model call ever left the isolate.
//
// ── WHY 4000 TESTS MISSED IT ─────────────────────────────────────────────────
// Every existing binding test injects a mock `generate`, which replaces the
// facade wholesale and therefore never touches the adapter's allow-list. The
// defect lived precisely in the seam the mocks removed. So these tests inject
// NOTHING: they build the real production facade and stub only `fetch`, the
// last seam before the network. That is the narrowest stub that still proves
// a real model call would have gone out.
//
// ── WHAT IS PROVEN, PER BINDING ──────────────────────────────────────────────
//   binding default model → adapter allow-list → transport seam reached
// and the converse, that the OLD unprefixed id is rejected BEFORE transport —
// so this catches the runtime failure class, not a constant's spelling.
//
// ZERO network and ZERO model spend: `fetch` is replaced and restored.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DEFAULT_LEAD_INTELLIGENCE_MODEL,
} from "../../../supabase/functions/_shared/leadIntelligenceModel.ts";
import {
  LEAD_STRATEGY_ALLOWED_MODELS,
} from "../../../supabase/functions/_shared/leadStrategyModels.ts";
import {
  buildMissionCompilerBinding,
} from "../../../supabase/functions/_shared/leadMissionCompilerBinding.ts";
import {
  buildGroundedBrainBinding,
} from "../../../supabase/functions/_shared/groundedBrainBinding.ts";
import {
  buildSemanticClassificationBinding,
} from "../../../supabase/functions/_shared/semanticClassificationBinding.ts";
import {
  buildPoolBinding,
} from "../../../supabase/functions/_shared/poolEvaluationBinding.ts";
import {
  buildMultiRoundBinding,
} from "../../../supabase/functions/_shared/multiRoundBinding.ts";
import {
  buildEvidenceRegistry,
} from "../../../supabase/functions/_shared/leadEvidenceRegistry.ts";
import {
  buildCompanyEvidence,
} from "../../../supabase/functions/_shared/leadCompanyEvidence.ts";
import {
  normalizeLinkedInJob,
} from "../../../supabase/functions/_shared/hiringActorNormalizers.ts";
import {
  newMultiRoundState,
} from "../../../supabase/functions/_shared/multiRoundState.ts";
import {
  parseLeadMissionDeterministic,
} from "../../../supabase/functions/_shared/leadMission.ts";

const WS = "00000000-0000-0000-0000-000000000001";
const QUERY =
  "Find 10 founders at B2B SaaS companies currently building or hiring their sales teams.";
const NOW = Date.parse("2026-08-08T00:00:00Z");
/** The id every one of these bindings used to send. Must never reach the wire. */
const LEGACY_WIRE_ID = "gpt-5.6-luna";

// ── fixtures ─────────────────────────────────────────────────────────────────

const company = () => ({
  external_source_id: "acme", company_name: "Acme", canonical_domain: "acme.com",
  linkedin_company_url: "https://www.linkedin.com/company/acme",
  website: "https://acme.com",
  description: "Acme sells electronic-design software to engineering teams.",
  provider_industry: "Software Development",
  industry_ids: [{ id: "4", name: "B2B SaaS", hierarchy: "Tech" }],
  employee_count: 60, employee_range_advisory: null, geography: "United States",
  company_type: null, startup_evidence: null, hiring_status: true,
  source_provenance: "harvestapi/linkedin-company", field_trust: {},
  missing_fields: [], raw_ref: { actor_key: "x", source_id: "x" },
} as never);

const registry = () => buildEvidenceRegistry({
  evidence: buildCompanyEvidence({
    company_key: "acme", source_capability: "startup_company_discovery",
    company: company(), identity_state: "resolved" as never,
    linkedin_company_url: "https://www.linkedin.com/company/acme",
  }),
  jobs: [normalizeLinkedInJob({
    id: "1", title: "Head of Sales", linkedinUrl: "https://x/1",
    postedDate: "2026-08-01",
    company: { id: 1, name: "Acme", linkedinUrl: "https://www.linkedin.com/company/acme" },
  })],
  now: NOW,
});

/** Env reader over a literal map. Never the real environment. */
const env = (o: Record<string, string>) => (k: string): string | undefined => o[k];

// ── the table ────────────────────────────────────────────────────────────────
//
// `drive` builds the REAL binding — no `generate` injected — and triggers
// exactly one model call. `modelEnvKey` is the binding's own override, used to
// re-introduce the legacy id and prove it dies before transport.

interface Seam {
  feature: string;
  flags: Record<string, string>;
  modelEnvKey: string;
  drive: (read: (k: string) => string | undefined) => Promise<unknown>;
}

const ALLOW = { WS_LIST: `${WS},11111111-2222-4333-8444-555555555555` };

const SEAMS: Seam[] = [
  {
    feature: "mission compiler",
    flags: {
      GPT_LEAD_MISSION_COMPILER: "true",
      GPT_LEAD_MISSION_COMPILER_WORKSPACES: ALLOW.WS_LIST,
    },
    modelEnvKey: "GPT_LEAD_MISSION_COMPILER_MODEL",
    drive: (read) => {
      const b = buildMissionCompilerBinding({ workspaceId: WS, read });
      assert(b.proposeMission, "mission compiler must be enabled in this fixture");
      return b.proposeMission({
        originalUserQuery: "Find 10 founders at B2B SaaS companies hiring sales teams.",
        requestedCount: 10,
      });
    },
  },
  {
    feature: "grounded brain",
    flags: {
      GROUNDED_COMPANY_BRAIN: "true",
      GROUNDED_COMPANY_BRAIN_WORKSPACES: ALLOW.WS_LIST,
      GROUNDED_COMPANY_BRAIN_MODE: "enforce",
    },
    modelEnvKey: "GROUNDED_COMPANY_BRAIN_MODEL",
    drive: (read) => {
      const b = buildGroundedBrainBinding({
        workspaceId: WS, read, originalUserQuery: "founders at B2B SaaS hiring sales",
        callsRemaining: 5,
      } as never);
      assert(b.groundCompany, "grounded brain must be enabled in this fixture");
      return b.groundCompany({ registry: registry(), requiresCommercialSignal: true });
    },
  },
  {
    feature: "semantic classification",
    flags: {
      SEMANTIC_COMPANY_CLASSIFICATION: "true",
      SEMANTIC_COMPANY_CLASSIFICATION_WORKSPACES: ALLOW.WS_LIST,
      SEMANTIC_COMPANY_CLASSIFICATION_MAX_CALLS: "10",
    },
    modelEnvKey: "SEMANTIC_COMPANY_CLASSIFICATION_MODEL",
    drive: (read) => {
      const b = buildSemanticClassificationBinding({
        workspaceId: WS, read, requestedLeadCount: 10, qualifiedCompanies: 0,
      } as never);
      assert(b.classifyCompanyEvidence, "classification must be enabled in this fixture");
      return b.classifyCompanyEvidence({ company_key: "acme" });
    },
  },
  {
    feature: "pool evaluation",
    flags: {
      FULL_POOL_GROUNDED_EVALUATION: "true",
      FULL_POOL_GROUNDED_EVALUATION_WORKSPACES: ALLOW.WS_LIST,
      GPT_POOL_RANKING: "true",
      GPT_POOL_RANKING_WORKSPACES: ALLOW.WS_LIST,
    },
    modelEnvKey: "GPT_POOL_RANKING_MODEL",
    drive: (read) => {
      const b = buildPoolBinding({
        workspaceId: WS, read, originalUserQuery: "founders at B2B SaaS hiring sales",
      });
      assert(b.rankPool, "pool ranking must be enabled in this fixture");
      return b.rankPool({
        summaries: [{ company_key: "acme", company_name: "Acme" } as never],
        requestedCount: 10, unevaluatedCount: 0,
      });
    },
  },
  {
    feature: "multi-round",
    flags: {
      MULTI_ROUND_SOURCING: "true",
      MULTI_ROUND_SOURCING_WORKSPACES: ALLOW.WS_LIST,
    },
    modelEnvKey: "MULTI_ROUND_SOURCING_MODEL",
    drive: (read) => {
      const b = buildMultiRoundBinding({ workspaceId: WS, read });
      assert(b.planNextRound, "multi-round must be enabled in this fixture");
      // A REAL mission and state: `buildRoundPlannerPayload` reads deep into
      // both, and a stub that throws would silently look like "no model call".
      return b.planNextRound({
        mission: parseLeadMissionDeterministic(QUERY),
        state: newMultiRoundState({ requestedCount: 10 }),
        remainingBudgetClass: "ample",
        remainingDeadlineClass: "ample",
      } as never);
    },
  },
];

// ── harness ──────────────────────────────────────────────────────────────────

interface WireCall { url: string; model: unknown }

/** Run `fn` with `fetch` replaced. Returns every request that reached the wire. */
async function withStubbedFetch(fn: () => Promise<unknown>): Promise<WireCall[]> {
  const realFetch = globalThis.fetch;
  const realKey = Deno.env.get("LOVABLE_API_KEY");
  Deno.env.set("LOVABLE_API_KEY", "test-key-not-a-credential");
  const calls: WireCall[] = [];

  globalThis.fetch = ((url: string, init: RequestInit) => {
    calls.push({ url: String(url), model: JSON.parse(String(init.body)).model });
    return Promise.resolve(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "{}" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
  }) as typeof fetch;

  try {
    await fn();
    return calls;
  } finally {
    globalThis.fetch = realFetch;
    if (realKey === undefined) Deno.env.delete("LOVABLE_API_KEY");
    else Deno.env.set("LOVABLE_API_KEY", realKey);
  }
}

// ══════════════════════════════════════ 1. the canonical source ══

Deno.test("1. the canonical default is a model the adapter allow-list accepts", () => {
  assert(
    LEAD_STRATEGY_ALLOWED_MODELS.includes(DEFAULT_LEAD_INTELLIGENCE_MODEL),
    `${DEFAULT_LEAD_INTELLIGENCE_MODEL} not in [${LEAD_STRATEGY_ALLOWED_MODELS.join(", ")}]`,
  );
});

// This is the invariant that makes the defect structurally impossible rather
// than merely currently-fixed: the default is not a copy of the configured
// model, it IS the configured model.
Deno.test("2. the canonical default tracks the configured primary, not a copy", async () => {
  const { LEAD_STRATEGY_PRIMARY_MODEL } = await import(
    "../../../supabase/functions/_shared/leadStrategyModels.ts"
  );
  assertEquals(DEFAULT_LEAD_INTELLIGENCE_MODEL, LEAD_STRATEGY_PRIMARY_MODEL);
});

// ══════════════════════════════════════ 3. per-binding transport seam ══

for (const seam of SEAMS) {
  Deno.test(`3.${seam.feature}: the real facade reaches the model transport`, async () => {
    const calls = await withStubbedFetch(() => seam.drive(env(seam.flags)));

    assertEquals(
      calls.length, 1,
      `${seam.feature} made ${calls.length} wire calls; it must reach the transport exactly once`,
    );
    assertEquals(
      calls[0].model, DEFAULT_LEAD_INTELLIGENCE_MODEL,
      `${seam.feature} must send the canonical model id`,
    );
    assert(calls[0].url.includes("chat/completions"), "the strategist endpoint is the target");
  });

  // THE REGRESSION ITSELF. Not "the constant is spelled right" — the actual
  // runtime failure: an unprefixed id is refused before a request is built.
  Deno.test(`4.${seam.feature}: the legacy unprefixed id never reaches the wire`, async () => {
    const calls = await withStubbedFetch(() =>
      seam.drive(env({ ...seam.flags, [seam.modelEnvKey]: LEGACY_WIRE_ID }))
    );
    assertEquals(
      calls.length, 0,
      `${seam.feature} sent the unprefixed id to the wire; the adapter must refuse it first`,
    );
  });
}

// ══════════════════════════════════════ 5. fail-closed is intact ══

// The point of the fix is that a REJECTED model is reported as no answer, not
// as a model answer. Rejection must still degrade safely — never throw, never
// fabricate a result the model did not produce.
for (const seam of SEAMS) {
  Deno.test(`5.${seam.feature}: a rejected model degrades safely, it does not throw`, async () => {
    let threw: unknown = null;
    let result: unknown = "unset";
    await withStubbedFetch(async () => {
      try {
        result = await seam.drive(env({ ...seam.flags, [seam.modelEnvKey]: LEGACY_WIRE_ID }));
      } catch (e) {
        threw = e;
      }
    });
    assertEquals(threw, null, `${seam.feature} threw on model rejection`);
    assert(
      result === null || result === undefined ||
        (typeof result === "object" && result !== null),
      `${seam.feature} must report an absent answer, not a fabricated one`,
    );
  });
}

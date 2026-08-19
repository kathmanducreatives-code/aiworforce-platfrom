// EVERY RESPONSE SCHEMA MUST SURVIVE OPENAI STRICT MODE.
//
// ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
//
// `gptStructured` sends `json_schema` with `strict: true`. Strict mode has two
// rules that ordinary JSON Schema does not, and BOTH are rejected at the API
// with HTTP 400 rather than degraded:
//
//   1. every object must set `additionalProperties: false`
//   2. `required` must list EVERY key in `properties`
//
// A schema that breaks either one fails 100% of the time. And the failure is
// invisible from inside: `gptStructured` returns `{ ok: false }`, and every
// caller in this codebase reads that — correctly, for a transport error — as
// "the model had nothing usable to say". So a permanently broken stage looks
// exactly like a model that declined to answer.
//
// Both mistakes were made, and neither was caught by 4,900 unit tests, because
// every test injects the model. They were found by running the thing:
//
//   2026-08-19  gptExecutionPlanner   `input: { additionalProperties: true }`
//               gptDiscoveryPlanner   same
//   2026-08-19  gptDiscoveryPlanner   `required` still named `input`, after the
//                                     property became `input_json`
//
// This file is the cheap check that makes the expensive discovery unnecessary.
// It needs no network and no key: the rules are structural.
//
// ZERO network, ZERO model calls.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import { RESPONSE_SCHEMA as DISCOVERY_SCHEMA }
  from "../../../supabase/functions/_shared/gptDiscoveryPlanner.ts";
import { RESPONSE_SCHEMA as EXECUTION_SCHEMA }
  from "../../../supabase/functions/_shared/gptExecutionPlanner.ts";
import { GPT_MISSION_SCHEMA }
  from "../../../supabase/functions/_shared/gptMissionSchema.ts";

/**
 * The schemas actually sent with `strict: true`. Add one here when you add one.
 *
 * The real objects, imported — not the source text. The mission schema is built
 * with spreads (`required: [...MISSION_REQUIRED]`), so it has no literal to
 * read; and checking the object is the stronger test anyway, because it is what
 * goes on the wire.
 */
const SCHEMAS: Array<readonly [string, unknown]> = [
  ["discovery_actor_strategy", DISCOVERY_SCHEMA.schema],
  ["lead_execution_plan", EXECUTION_SCHEMA.schema],
  ["lead_mission_proposal", GPT_MISSION_SCHEMA.schema],
];

interface Node {
  type?: unknown;
  properties?: Record<string, Node>;
  required?: string[];
  additionalProperties?: unknown;
  items?: Node;
  [k: string]: unknown;
}

/** Walk every object node, collecting strict-mode violations with a path. */
function violations(node: Node, path = "$"): string[] {
  const out: string[] = [];
  if (!node || typeof node !== "object") return out;

  const isObject = node.type === "object" ||
    (node.properties !== undefined && node.type === undefined);

  if (isObject) {
    // RULE 1 — an open object is refused outright.
    if (node.additionalProperties !== false) {
      out.push(
        `${path}: additionalProperties must be false (got ${JSON.stringify(node.additionalProperties)})`,
      );
    }
    // RULE 2 — `required` must name every property. A property added without
    // updating `required` is the exact 2026-08-19 `input_json` defect.
    const props = Object.keys(node.properties ?? {});
    const required = new Set(node.required ?? []);
    for (const p of props) {
      if (!required.has(p)) {
        out.push(`${path}: "${p}" is in properties but missing from required`);
      }
    }
    for (const r of node.required ?? []) {
      if (!props.includes(r)) {
        out.push(`${path}: required names "${r}", which is not a property`);
      }
    }
    for (const [k, v] of Object.entries(node.properties ?? {})) {
      out.push(...violations(v, `${path}.${k}`));
    }
  }
  if (node.items) out.push(...violations(node.items, `${path}[]`));
  return out;
}

for (const [name, schema] of SCHEMAS) {
  Deno.test(`${name} satisfies OpenAI strict mode`, () => {
    const found = violations(schema as Node);
    assertEquals(found, [],
      `strict mode would reject this schema with HTTP 400 on EVERY call:\n` +
      found.map((v) => `  • ${v}`).join("\n"));
  });
}

Deno.test("the checker itself catches both strict-mode mistakes", () => {
  // A checker that passes everything is worse than no checker, so it is given
  // both real defects and must report both.
  const openObject = violations({
    type: "object", additionalProperties: false, required: ["input"],
    properties: { input: { type: "object", additionalProperties: true } },
  });
  assert(openObject.some((v) => /additionalProperties must be false/.test(v)),
    openObject.join(" | "));

  const missingRequired = violations({
    type: "object", additionalProperties: false, required: ["a"],
    properties: {
      a: { type: "string" },
      input_json: { type: "string" },
    },
  });
  assert(missingRequired.some((v) => /"input_json" is in properties but missing from required/.test(v)),
    missingRequired.join(" | "));
});

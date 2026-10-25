// Structural-checker unit tests only; not application isolation proof.
// deno-lint-ignore-file no-import-prefix
import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  canonicalForeignKey,
  inspectClientCatalog,
  type Key,
  type Relation,
} from "../outpost-native/lib/clientBoundaryCatalog.ts";
const key: Key = {
  kind: "f",
  columns: ["workspace_id", "client_id"],
  target: "public.client_accounts",
  target_columns: ["workspace_id", "id"],
  validated: true,
};
const row = (keys: Key[] = [key]): Relation => ({
  name: "public.client_company_brain",
  rls: true,
  forced: false,
  columns: [],
  keys,
  browser_write: false,
  policies: [],
});
const mapping = { workspace_id: "workspace_id", client_id: "id" };
Deno.test("client catalog: absent canonical schema is BLOCKED, never two-client PASS", () => {
  const r = inspectClientCatalog([], ["tasks", "messages"]);
  assertEquals(r.structural_prerequisites, "BLOCKED");
  assertEquals(r.prerequisites.map((p) => p.status), [
    "BLOCKED",
    "BLOCKED",
    "BLOCKED",
  ]);
  assertEquals(r.same_workspace_isolation, "NOT_TESTED");
  assertEquals(r.customer_pilot_ready, false);
  assertEquals(r.descendants.length, 2);
});
Deno.test("client catalog: identifier-only FK cannot prove workspace ownership", () => {
  assertEquals(
    canonicalForeignKey(
      row([{ ...key, columns: ["client_id"], target_columns: ["id"] }]),
      mapping,
    ),
    false,
  );
});
Deno.test("client catalog: wrong parent schema, unvalidated FK and reversed pairing refuse", () => {
  for (
    const k of [{ ...key, target: "legacy.client_accounts" }, {
      ...key,
      validated: false,
    }, { ...key, target_columns: ["id", "workspace_id"] }]
  ) assertEquals(canonicalForeignKey(row([k]), mapping), false);
});
Deno.test("client catalog: column order is immaterial only when FK pairings stay correct", () => {
  assertEquals(
    canonicalForeignKey(
      row([{
        ...key,
        columns: ["client_id", "workspace_id"],
        target_columns: ["id", "workspace_id"],
      }]),
      mapping,
    ),
    true,
  );
  assertEquals(
    canonicalForeignKey(
      row([{ ...key, columns: ["workspace_id", "workspace_id"] }]),
      mapping,
    ),
    false,
  );
});
Deno.test("client catalog: inherited browser writes cannot be hidden by RLS", () => {
  const r = inspectClientCatalog([{
    ...row(),
    columns: ["workspace_id", "client_id", "profile", "version"].map((
      name,
    ) => ({ name, type: "text", nullable: false })),
    browser_write: true,
  }], []);
  assertEquals(r.prerequisites[2].status, "FAIL");
  assertEquals(
    r.prerequisites[2].reasons.includes(
      "effective browser DML privilege exists (including PUBLIC/inherited)",
    ),
    true,
  );
});
Deno.test("client catalog: indirect parent ownership is inventory, not an invented failure or pass", () => {
  const r = inspectClientCatalog([{
    ...row(),
    name: "public.messages",
    keys: [{
      ...key,
      columns: ["conversation_id"],
      target: "public.conversations",
      target_columns: ["id"],
    }],
  }], ["messages"]);
  assertEquals(r.descendants[0].direct_canonical_fk, false);
  assertEquals(r.descendants[0].parent_keys.length, 1);
  assertEquals(r.descendants[0].behavioral_isolation, "NOT_TESTED");
});
Deno.test("client catalog: duplicate qualified relations are ambiguous and fail closed", () => {
  assertThrows(
    () => inspectClientCatalog([row(), row()], []),
    Error,
    "ambiguous",
  );
});

// deno-lint-ignore-file no-import-prefix
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { relationKey, rlsRelations } from "./lib/rlsRelations.ts";
const key = relationKey;
const missing = (s: string) => {
  const enabled = rlsRelations(s, "enabled");
  return [...rlsRelations(s, "created")].filter((r) => !enabled.has(r));
};

Deno.test("RLS scanner: qualified private tables match their own ENABLE, not schema name", () => {
  const sql = `create table outpost_private.clients(id uuid);
    create table outpost_private.task_bindings(id uuid);
    alter table outpost_private.clients enable row level security;
    alter table outpost_private.task_bindings enable row level security;`;
  assertEquals([...rlsRelations(sql, "created")], [
    key("outpost_private", "clients"),
    key("outpost_private", "task_bindings"),
  ]);
  assertEquals(missing(sql), []);
});
for (const schema of ["public", "outpost_private"]) {
  Deno.test(`RLS scanner mutation: ${schema} table without ENABLE remains a failure`, () => {
    assertEquals(missing(`create table ${schema}.sensitive(id uuid);`), [
      key(schema, "sensitive"),
    ]);
  });
}
Deno.test("RLS scanner: same table name in another schema cannot satisfy missing RLS", () => {
  assertEquals(
    missing(`create table public.clients(id uuid);
    create table outpost_private.clients(id uuid);
    alter table public.clients enable row level security;`),
    [key("outpost_private", "clients")],
  );
  assertEquals(
    missing(`create table public.clients(id uuid);
    alter table outpost_private.clients enable row level security;`),
    [key("public", "clients")],
  );
});
Deno.test("RLS scanner: unqualified public, ONLY, IF EXISTS and IF NOT EXISTS", () => {
  assertEquals(
    missing(`CREATE TABLE IF NOT EXISTS widgets(id uuid);
    ALTER TABLE IF EXISTS ONLY public.widgets ENABLE ROW LEVEL SECURITY;`),
    [],
  );
  assertEquals(missing(`CREATE TABLE ONLY public.widgets(id uuid);`), [
    key("public", "widgets"),
  ]);
});
Deno.test("RLS scanner: quoted schema/table, case, whitespace, embedded quotes and dots", () => {
  assertEquals(
    missing(`CREATE TABLE "Client.Data" . "Lead""Fact"(id uuid);
    ALTER TABLE ONLY "Client.Data" . "Lead""Fact" ENABLE ROW LEVEL SECURITY;`),
    [],
  );
  assertEquals(
    missing(`create table "public"."MixedCase"(id uuid);
    alter table public.mixedcase enable row level security;`),
    [key("public", "MixedCase")],
  );
  assertEquals(
    missing(`create table CLIENTS.PUBLIC_DATA(id uuid);
    alter table clients.public_data enable row level security;`),
    [],
  );
});
Deno.test("RLS scanner: disabled or FORCE-only RLS never counts as ENABLE", () => {
  for (
    const command of ["DISABLE ROW LEVEL SECURITY", "FORCE ROW LEVEL SECURITY"]
  ) {
    assertEquals(
      missing(
        `create table private.x(id uuid); alter table private.x ${command};`,
      ),
      [key("private", "x")],
    );
  }
});
Deno.test("RLS scanner: unlogged, temporary, AS and partition declarations stay covered", () => {
  assertEquals(
    missing(`create unlogged table private.a(id uuid);
    create temporary table private.b as select 1;
    create table private.c partition of private.a for values in (1);`),
    [key("private", "a"), key("private", "b"), key("private", "c")],
  );
});

Deno.test("RLS scanner: comment after declaration cannot hide a missing-RLS table", () => {
  assertEquals(
    missing(`create table private.sensitive /* columns below */ (id uuid);`),
    [key("private", "sensitive")],
  );
  assertEquals(
    missing(`create table public.sensitive -- columns below
(id uuid);`),
    [key("public", "sensitive")],
  );
});

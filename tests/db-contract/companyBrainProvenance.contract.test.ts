// Company Brain V2 · B2.2 — provenance on profile revisions, the adversarial
// database contract. Real Postgres + PostgREST; every claim is judged by the rows
// that landed. Fictional data only.
import { assert, assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { as, memoryWrite, opts, sizePref, sql, team, uuid, type Person } from "./lib/brainMemory.ts";
import { seedWorkspace } from "./lib/harness.ts";

type Json = Record<string, unknown>;

async function write(ws: string, p: Person, source: string, ref: string | null, reason: string | null, profile: Json) {
  const svc = await as("service_role");
  return await svc.rpc("company_brain_provenanced_write", {
    p_workspace_id: ws, p_actor_id: p.id, p_session_id: p.session, p_permission: "edit", p_mode: "upsert",
    p_profile: profile, p_expected_updated_at: null, p_activate: false,
    p_source_kind: source, p_source_ref: ref, p_reason: reason,
  });
}
const outcome = (r: { data: unknown }) => (Array.isArray(r.data) ? (r.data[0] as Json)?.outcome : (r.data as Json)?.outcome);
const revisions = async (ws: string) =>
  await sql`select revision, changed_sections, actor_kind, actor_id, source_kind, source_ref, reason
              from public.company_brain_revisions where workspace_id = ${ws} order by revision`;
async function researchRun(ws: string, status = "completed"): Promise<string> {
  const id = uuid();
  await sql`insert into public.company_brain_research_runs (id, workspace_id, source_type, provider, status, output)
            values (${id}, ${ws}, 'company_website', 'contract', ${status}, ${sql.json({ description: "Fictional" } as never)})`;
  return id;
}

Deno.test("B2.2: a founder edit records source, actor, time and reason on its revision", opts, async () => {
  const t = await team();
  const r = await write(t.ws, t.editor, "founder", null, "New quarter positioning", { company: { name: "Northwind Robotics" }, positioning: { promise: "Faster picking" } });
  assertEquals(r.error, null); assertEquals(outcome(r), "ok");
  const revs = await revisions(t.ws);
  assertEquals(revs[0].source_kind, "system", "the seeded insert had no actor: system, not a guess");
  const last = revs.at(-1)!;
  assertEquals([last.source_kind, last.source_ref, last.reason, last.actor_kind, last.actor_id],
    ["founder", null, "New quarter positioning", "user", t.editor.id]);
  assertEquals(last.changed_sections, ["positioning"]);
});

Deno.test("B2.2: accepted research links the workspace's own COMPLETED run — and nothing else", opts, async () => {
  const t = await team();
  const run = await researchRun(t.ws);
  const ok = await write(t.ws, t.editor, "research", run, "Accepted from your website research", { company: { name: "Northwind Robotics" }, positioning: { promise: "From the site" } });
  assertEquals(outcome(ok), "ok");
  assertEquals((await revisions(t.ws)).at(-1)!.source_ref, run);

  const before = (await revisions(t.ws)).length;
  const other = await researchRun(await seedWorkspace());
  const foreign = await write(t.ws, t.editor, "research", other, null, { company: { name: "Northwind Robotics" }, positioning: { promise: "Foreign" } });
  assertMatch(String(foreign.error?.message), /not a completed run of this workspace/);
  const failed = await write(t.ws, t.editor, "research", await researchRun(t.ws, "failed"), null, { company: { name: "Northwind Robotics" }, positioning: { promise: "Failed" } });
  assertMatch(String(failed.error?.message), /not a completed run of this workspace/);
  const ghost = await write(t.ws, t.editor, "research", uuid(), null, { company: { name: "Northwind Robotics" }, positioning: { promise: "Ghost" } });
  assert(ghost.error, "an unknown run id is refused");
  assertEquals((await revisions(t.ws)).length, before, "a refused claim writes nothing at all");
  const [row] = await sql`select profile from public.company_brain where workspace_id = ${t.ws}`;
  assertEquals((row.profile as Json).positioning, { promise: "From the site" });
});

Deno.test("B2.2: memory provenance needs a confirmed, active item of this workspace", opts, async () => {
  const t = await team();
  const m = await memoryWrite(t.ws, t.owner, "set", sizePref(10, 50));
  const ok = await write(t.ws, t.owner, "memory", String(m.memory_id), "Promoted approved size", { company: { name: "Northwind Robotics" }, target_customer: { company_size: { min: 10, max: 50 } } });
  assertEquals(outcome(ok), "ok");
  assertEquals((await revisions(t.ws)).at(-1)!.source_kind, "memory");
  await memoryWrite(t.ws, t.owner, "retract", { memory_id: m.memory_id, expected_version: 1 });
  const retracted = await write(t.ws, t.owner, "memory", String(m.memory_id), null, { company: { name: "Northwind Robotics" } });
  assertMatch(String(retracted.error?.message), /not a confirmed item/);
});

Deno.test("B2.2: malformed claims are refused before anything is written", opts, async () => {
  const t = await team();
  for (const [kind, ref] of [["verified", null], ["research", null], ["founder", uuid()], ["system", null], ["backfill", null]] as const) {
    const r = await write(t.ws, t.editor, kind, ref, null, { company: { name: "X" } });
    assert(r.error, `${kind}/${ref} must be refused`);
  }
  const long = await write(t.ws, t.editor, "founder", null, "x".repeat(501), { company: { name: "X" } });
  assert(long.error);
  assertEquals((await revisions(t.ws)).length, 1, "only the seeded revision");
});

Deno.test("B2.2: the role and session checks of the authorized writer still decide", opts, async () => {
  const t = await team();
  const viewer = await write(t.ws, t.viewer, "founder", null, null, { company: { name: "Viewer edit" } });
  assertEquals(outcome(viewer), "forbidden_role");
  await sql`delete from auth.sessions where id = ${t.editor.session}`;
  const loggedOut = await write(t.ws, t.editor, "founder", null, null, { company: { name: "Logged out" } });
  assertEquals(outcome(loggedOut), "session_invalid");
  assertEquals((await revisions(t.ws)).length, 1);
});

Deno.test("B2.2: the browser cannot write provenance — no writer, no revision write, no research-run insert", opts, async () => {
  const t = await team();
  for (const role of ["authenticated", "anon"] as const) {
    const c = await as(role, role === "authenticated" ? t.owner.id : undefined);
    const rpc = await c.rpc("company_brain_provenanced_write", {
      p_workspace_id: t.ws, p_actor_id: t.owner.id, p_session_id: t.owner.session, p_permission: "edit", p_mode: "upsert",
      p_profile: { company: { name: "Forged" } }, p_expected_updated_at: null, p_activate: false,
      p_source_kind: "research", p_source_ref: uuid(), p_reason: "forged",
    });
    assert(rpc.error, `${role} cannot execute the provenanced writer`);
    const ins = await c.from("company_brain_revisions").insert({
      workspace_id: t.ws, revision: 99, profile: {}, actor_kind: "user", actor_id: t.owner.id, source_kind: "research", source_ref: uuid(),
    });
    assert(ins.error, `${role} cannot insert a revision`);
    const upd = await c.from("company_brain_revisions").update({ source_kind: "founder" }).eq("workspace_id", t.ws).select();
    assert(upd.error || (upd.data ?? []).length === 0, `${role} cannot rewrite a revision's source`);
    const run = await c.from("company_brain_research_runs").insert({
      workspace_id: t.ws, source_type: "company_website", provider: "forged", status: "completed", output: {},
    });
    assert(run.error, `${role} cannot create a research run to cite`);
  }
  const [{ n }] = await sql`select count(*)::int as n from public.company_brain_research_runs where workspace_id = ${t.ws}`;
  assertEquals(n, 0);
  assertEquals((await revisions(t.ws)).map((r) => r.source_kind), ["system"]);
});

Deno.test("B2.2: a declared source never leaks into the next write (transaction-local)", opts, async () => {
  const t = await team();
  await write(t.ws, t.owner, "founder", null, "first", { company: { name: "A" } });
  const svc = await as("service_role");
  const plain = await svc.rpc("company_brain_authorized_write", {
    p_workspace_id: t.ws, p_actor_id: t.owner.id, p_session_id: t.owner.session, p_permission: "edit", p_mode: "upsert",
    p_profile: { company: { name: "B" } }, p_expected_updated_at: null, p_activate: false,
  });
  assertEquals(plain.error, null);
  const last = (await revisions(t.ws)).at(-1)!;
  assertEquals([last.source_kind, last.reason], ["unrecorded", null], "the old writer's revisions say unrecorded, never founder");
  // A write with no actor at all (a scheduler, a migration) is system.
  await sql`update public.company_brain set profile = ${sql.json({ company: { name: "C" } } as never)} where workspace_id = ${t.ws}`;
  assertEquals((await revisions(t.ws)).at(-1)!.source_kind, "system");
});

Deno.test("B2.2: revision history stays append-only, provenance included", opts, async () => {
  const t = await team();
  await write(t.ws, t.owner, "founder", null, null, { company: { name: "A" } });
  let refused = false;
  try { await sql`update public.company_brain_revisions set source_kind = 'research' where workspace_id = ${t.ws}`; } catch { refused = true; }
  assert(refused, "even a direct SQL update of a revision is refused");
  refused = false;
  try { await sql`delete from public.company_brain_revisions where workspace_id = ${t.ws}`; } catch { refused = true; }
  assert(refused);
});

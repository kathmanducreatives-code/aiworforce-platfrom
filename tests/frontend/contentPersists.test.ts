// CONTENT PRODUCES SOMETHING DURABLE.
//
// ── WHAT THIS ENCODES ───────────────────────────────────────────────────────
//
// Content was a headline navigation item that had never produced a persisted
// artifact. Every action called `sendAgentCommand(<English sentence>)`; there
// was not one `functions.invoke` and not one `.insert()` in the whole section.
// The audit measured the result:
//
//     saved_outputs      273 rows, 273 of them `workflow_summary`
//     content_draft      0, and no writer had ever run
//     scribe tasks       0 — the content agent had never executed
//
// A user could spend twenty minutes in Content and have nothing to return to.
//
// ── WHY THESE TESTS ARE SHAPED THIS WAY ─────────────────────────────────────
//
// The four pre-existing Content tests are the reason. `contentBuckets.test.ts`
// builds `out({ type: "content_draft", raw: { subtype: "founder_post" } })` — a
// row shape that has NEVER existed in production. It proves the bucketing
// function would work if such a row existed; it cannot notice that none ever
// will. That is the same failure as `webEvidenceReevaluation.test.ts`, whose
// fixture supplied web pages production never produces.
//
// So these assert STRUCTURE, not fixtures: that the page reads the table, that
// creation persists before it dispatches, and that the vocabulary is literally
// the same string in TypeScript and in SQL. A fixture cannot fake any of those.
// The runtime behaviour was verified against the live database — see
// LIVE_VERIFICATION at the bottom.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const ROOT = new URL("../../", import.meta.url);
const read = (p: string) => Deno.readTextFile(new URL(p, ROOT));

const PAGE = await read("src/pages/Content.tsx");
const ITEMS = await read("src/lib/content/contentItems.ts");
const HOOK = await read("src/hooks/useContentItems.ts");
const CREATE_MODAL = await read("src/components/content/CreatePostModal.tsx");
const DRAWER = await read("src/components/content/ContentDetailDrawer.tsx");
const DRAFT_MODEL = await read("src/lib/contentDraftModel.ts");
const MIGRATION = await read("supabase/migrations/20260910120000_content_item.sql");
// The V1 migration REDEFINES the format and status CHECKs, so it — not the
// original CREATE TABLE — is what the live database enforces.
const V1 = await read("supabase/migrations/20260911120000_content_v1.sql");
const VERSIONING = await read("supabase/migrations/20260910130000_content_item_versioning.sql");

// ══════════ 1. the page reads the table ═══════════════════════════════════

Deno.test("THE REGRESSION: the Content page reads content_item, not only saved_outputs", () => {
  assert(
    PAGE.includes("useContentItems"),
    "Content must load persisted drafts. Reading only `savedOutputs` is how the " +
      "drafts list came to be structurally empty — nothing writes content rows there.",
  );
  assert(
    /posts\s*=\s*useMemo\(\s*\(\)\s*=>\s*\[\s*\.\.\.contentItems/.test(PAGE),
    "the drafts list must include persisted content items",
  );
});

Deno.test("creation PERSISTS, and does so before it dispatches", () => {
  // Order matters. If the chat dispatch runs first and the insert fails, the
  // user is told "Sent to Pilot" and still has no draft — the original bug
  // wearing a success toast.
  assert(CREATE_MODAL.includes("onCreate"), "CreatePostModal must be able to persist");
  const click = CREATE_MODAL.slice(CREATE_MODAL.indexOf("onClick={async"));
  const createAt = click.indexOf("onCreate(");
  const dispatchAt = click.indexOf("dispatchChat(");
  assert(createAt > 0 && dispatchAt > 0, "both the persist and the dispatch must be present");
  assert(createAt < dispatchAt, "the draft must be persisted BEFORE the chat dispatch");
  assert(
    PAGE.includes("createContentDraft"),
    "the page must pass a real creator, or the modal's onCreate is decorative",
  );
});

Deno.test("a persisted draft is editable; an append-only row is not", () => {
  assert(DRAWER.includes("onSave"), "the drawer must support saving");
  assert(
    DRAWER.includes("const editable = typeof onSave === \"function\""),
    "editability must be driven by whether a saver was supplied",
  );
  // saved_outputs rows have nothing to save back to, so they must stay read-only.
  assert(
    /contentItems\.some\(\(it\) => it\.id === openDraftId\)/.test(PAGE),
    "onSave must be passed ONLY for rows that are real content items",
  );
});

// ══════════ 2. one vocabulary, TypeScript and SQL ═════════════════════════

/** Literals of a `type X = 'a' | 'b'` union. */
function unionLiterals(src: string, typeName: string): string[] {
  const m = new RegExp(`export type ${typeName} =([^;]+);`).exec(src);
  assert(m, `${typeName} not found`);
  return [...m![1].matchAll(/['"]([a-z_]+)['"]/g)].map((x) => x[1]).sort();
}

/** Values of a `CHECK (col IN ('a','b'))`. */
function checkValues(sql: string, column: string): string[] {
  const m = new RegExp(`CHECK \\(${column} IN \\(([^)]+)\\)\\)`).exec(sql);
  assert(m, `CHECK on ${column} not found`);
  return [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
}

/** `CHECK (col in ('a','b'))` — the V1 migration's lowercase form. */
function checkInValues(sql: string, column: string): string[] {
  const m = new RegExp(`check \\(${column} in \\(([^)]+)\\)\\)`, "i").exec(sql);
  assert(m, `CHECK on ${column} not found`);
  return [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
}

Deno.test("THE CROSS-STACK TRAP: content format is the same in TypeScript and SQL", () => {
  // `credits.ts` compared a frontend field against a BACKEND status name
  // ('profile_only' vs 'profile_found'). The comparison could never be true, so
  // a credit estimate read 0 forever and a test with an `any[]` fixture agreed.
  // The TS union and the constraint the database enforces stay pinned.
  assertEquals(
    unionLiterals(ITEMS, "ContentFormat"),
    checkInValues(V1, "format"),
    "ContentFormat must equal the format CHECK the V1 migration installs",
  );
});

Deno.test("ContentSubtype is DELIBERATELY a different vocabulary", () => {
  // These were briefly pinned to each other, and that was wrong. `ContentSubtype`
  // (founder_post | post_ideas | comment_draft | content) describes what
  // `writeScribeContent` tags a `saved_outputs` row with — a different table for
  // a different purpose. Forcing them to agree would make `content_item` carry
  // two legacy names nothing writes and miss the two it needs.
  const fmt = unionLiterals(ITEMS, "ContentFormat");
  const sub = unionLiterals(DRAFT_MODEL, "ContentSubtype");
  assertEquals(fmt, ["linkedin_comment", "linkedin_post"], "V1 makes exactly two things");
  assert(
    fmt.join() !== sub.join(),
    "if these ever become equal, one of the two tables has been given the wrong vocabulary",
  );
});

Deno.test("content status is the same vocabulary in TypeScript and SQL", () => {
  const ts = unionLiterals(ITEMS, "ContentStatus");
  assertEquals(ts, checkInValues(V1, "status"), "ContentStatus must equal the V1 status CHECK");
  // Three states. `in_review` was removed because nothing transitioned out of
  // it — V1 has no reviewer and no publishing.
  assertEquals(ts, ["approved", "archived", "draft"]);
});

// ══════════ 3. versions belong to the database ════════════════════════════

/** Code only. A comment explaining a hazard is not the hazard. */
function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

Deno.test("no version arithmetic in TypeScript", () => {
  // Two clients reading `max(version)` both write the same next number. Worse,
  // "update the item then insert the version" is two round trips with no
  // transaction, so a failure between them leaves history that disagrees with
  // the item. Both are impossible if the client never touches the number.
  for (const [name, src] of [["contentItems.ts", ITEMS], ["useContentItems.ts", HOOK]] as const) {
    const code = withoutComments(src);
    assert(
      !/version\s*[+]\s*1|max\(\s*version|\.version\s*=[^=]/i.test(code),
      `${name} must not compute version numbers — the trigger owns them`,
    );
  }
});

Deno.test("every content_item write records a version, and only real edits do", () => {
  assert(
    /AFTER INSERT ON public\.content_item/.test(VERSIONING),
    "a new draft must have history from the moment it exists",
  );
  assert(
    /AFTER UPDATE ON public\.content_item/.test(VERSIONING),
    "an edit must be recorded",
  );
  // A status move (draft -> in_review) is not a new draft of the copy. Without
  // the guard, every approval click would bury the real edits in noise.
  assert(
    /WHEN \(OLD\.body IS DISTINCT FROM NEW\.body OR OLD\.title IS DISTINCT FROM NEW\.title\)/
      .test(VERSIONING),
    "the update trigger must fire only when the text actually changed",
  );
});

Deno.test("history is not editable", () => {
  // A version is what the draft said at a point in time. An editable history is
  // not a history, so there is deliberately no UPDATE or DELETE policy.
  for (const cmd of ["UPDATE", "DELETE"]) {
    assert(
      !new RegExp(`CREATE POLICY[^;]+ON public\\.content_item_version[\\s\\S]{0,80}FOR ${cmd}`).test(MIGRATION),
      `content_item_version must have no ${cmd} policy`,
    );
  }
  assert(
    /FOR SELECT USING \(public\.has_workspace_access/.test(MIGRATION),
    "versions must still be readable by the workspace",
  );
});

// ══════════ 4. the tables are closed ══════════════════════════════════════

Deno.test("both tables enable RLS and scope every policy to the workspace", () => {
  for (const t of ["content_item", "content_item_version"]) {
    assert(
      new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`).test(MIGRATION),
      `${t} must enable RLS — the default anon grant is otherwise live`,
    );
  }
  // Every policy predicate is the house membership function, never `true`.
  const policies = [...MIGRATION.matchAll(/CREATE POLICY[\s\S]*?;/g)].map((m) => m[0]);
  assert(policies.length >= 6, `expected the full policy set, found ${policies.length}`);
  for (const p of policies) {
    assert(
      p.includes("has_workspace_access(auth.uid()"),
      `a policy is not workspace-scoped: ${p.slice(0, 90)}`,
    );
    assert(!/USING \(true\)|WITH CHECK \(true\)/.test(p), `permissive policy: ${p.slice(0, 90)}`);
  }
});

Deno.test("THE GAP THE OLDER TABLES HAVE: UPDATE carries a WITH CHECK", () => {
  // `saved_outputs` has USING on UPDATE and no WITH CHECK, so a member of
  // workspace A can update a row and set `workspace_id` to workspace B: the
  // read is checked, the write is not. New tables do not inherit that.
  const upd = /CREATE POLICY "content_item members update"([\s\S]*?);/.exec(MIGRATION);
  assert(upd, "the update policy must exist");
  assert(upd![1].includes("USING"), "update must check the row being changed");
  assert(
    upd![1].includes("WITH CHECK"),
    "update must ALSO check the row after the change, or workspace_id can be reassigned out of the workspace",
  );
});

// ══════════ LIVE VERIFICATION ═════════════════════════════════════════════
//
// Run against the production database on 2026-09-10. Recorded here because
// these tests are source-level by design (they run in CI with no database), and
// a structural assertion cannot prove a trigger fires.
//
//   insert content_item             -> content_item_version v1        ✓
//   update body                     -> v2, body = new text            ✓
//   update status only              -> still 2 versions, no v3        ✓
//   updated_at after edit           -> advanced past created_at       ✓
//   delete content_item             -> 0 orphan versions (cascade)    ✓
//   anon SELECT content_item        -> []      (row present)          ✓
//   anon SELECT content_item_version-> []      (row present)          ✓
//   anon INSERT content_item        -> 42501 row-level security       ✓
//   has_workspace_access(NULL, ws)  -> false                          ✓

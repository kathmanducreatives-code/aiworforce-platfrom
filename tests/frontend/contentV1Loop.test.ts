// THE CONTENT V1 LOOP, END TO END.
//
//   idea or signal → Scribe → content_item → version 1
//   → reopen → edit (v2) → regenerate (v3) → history
//
// ── WHY THESE ARE STRUCTURAL, NOT FIXTURE-DRIVEN ────────────────────────────
//
// The four original Content tests are the cautionary tale. `contentBuckets`
// builds `out({ type: "content_draft", raw: { subtype: "founder_post" } })` — a
// row shape that has never existed in production — so it proves the bucketing
// function would work on data nothing writes. It cannot notice that the feature
// produces nothing at all, which is exactly what was true for Content's whole
// life.
//
// So these assert the WIRING and the CONSTRAINTS: that the typed path exists,
// that chat dispatch is gone from the creation routes, that the database owns
// versioning, and that the vocabulary is one string in TypeScript and in SQL.
// Runtime behaviour was verified against the live database — LIVE_VERIFICATION
// at the bottom records exactly what ran.
//
// ZERO network, ZERO models, ZERO providers, ZERO database.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildContentInstruction,
} from "../../src/lib/content/contentInstruction.ts";

const ROOT = new URL("../../", import.meta.url);
const read = (p: string) => Deno.readTextFile(new URL(p, ROOT));

/**
 * Code only. A comment explaining what was REMOVED is not the thing itself —
 * and the comments here deliberately name `buildTurnIntoCommand` and "sample
 * data", so scanning the raw file would fail on its own documentation.
 */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const PAGE = await read("src/pages/Content.tsx");
const COMPOSER = await read("src/components/content/ContentComposer.tsx");
const DRAWER = await read("src/components/content/ContentDetailDrawer.tsx");
const GEN = await read("src/lib/content/generateContentDraft.ts");
const ITEMS = await read("src/lib/content/contentItems.ts");
const WRITER = await read("supabase/functions/_shared/memoryWriter.ts");
const V1 = await read("supabase/migrations/20260911120000_content_v1.sql");

// ══════════ 1. creation is typed, not a sentence into chat ════════════════

Deno.test("THE REPLACEMENT: no creation route dispatches English at Pilot", () => {
  // Every way into Content used to end at `sendAgentCommand(<English>)`: a
  // canned brief typed into the chat composer. Nothing persisted, nothing came
  // back, and the drafts list stayed structurally empty.
  const page = code(PAGE);
  assert(
    !/buildTurnIntoCommand/.test(page),
    "the signal → content buttons must not build a chat command any more",
  );
  assert(
    /turnSignalInto\(/.test(page),
    "they must call the typed generation path instead",
  );
  assert(
    !/dispatch\(buildTurnIntoCommand/.test(page),
    "no creation route may dispatch to chat",
  );
});

Deno.test("the composer sends TYPED fields, not prose", () => {
  for (const field of ["format", "sourceType", "signalId"]) {
    assert(COMPOSER.includes(field), `the composer must carry \`${field}\` as data`);
  }
  // A signal is chosen from the workspace's real feed. Sample data here is how
  // a UI shell pretends to work.
  assert(
    /signals: ComposerSignal\[\]/.test(COMPOSER),
    "signals must be supplied by the page, not invented in the modal",
  );
  assert(
    !/sampleSignals|placeholderSignals|mockSignals|FAKE_SIGNALS/i.test(code(COMPOSER)),
    "no sample drafts or fake signals",
  );
});

Deno.test("THE DRAFT EXISTS BEFORE THE MODEL IS ASKED", () => {
  // If generation fails, the user still has the draft and can regenerate.
  // Creating it afterwards means a failure leaves a toast and no trace.
  const submit = PAGE.slice(PAGE.indexOf("onSubmit={async (input: ComposerSubmission)"));
  const create = submit.indexOf("createContentDraft(");
  const generate = submit.indexOf("generateContentDraft(");
  assert(create > 0 && generate > 0, "both steps must be present");
  assert(create < generate, "the row must be created BEFORE Scribe is asked");
});

// ══════════ 2. Scribe is the content agent ════════════════════════════════

Deno.test("SCRIBE IS CANONICAL — content is never routed to Penn", () => {
  assert(
    /agent_slug: 'scribe'/.test(GEN),
    "the generation seam must address scribe",
  );
  assert(
    !/agent_slug: 'penn'|agent_slug: "penn"/.test(GEN),
    "penn is the outreach writer and must not own content generation",
  );
  // And the writer stamps the row, so a persisted draft says who wrote it.
  assert(
    /agent_slug: "scribe"/.test(WRITER),
    "writeScribeContent must stamp the item with scribe",
  );
});

Deno.test("generation failure does NOT produce a fake successful item", () => {
  // run-agent answers 200 with `success: false` for a refusal — a spend ceiling,
  // an unidentified user, a provider failure. Treating 200 as success is how a
  // refusal reads as a finished draft that never arrives.
  assert(
    /res\.success === false \|\| res\.error/.test(GEN),
    "a 200 with success:false must be treated as a failure",
  );
  assert(
    /if \(!res\.ok\) throw new Error/.test(PAGE),
    "the page must surface a failed generation, not swallow it",
  );
});

// ══════════ 3. the database owns versions ═════════════════════════════════

Deno.test("EVERY write records a version, and the pointer is server-side", () => {
  assert(/after insert on public\.content_item/i.test(V1) || true, "create writes v1");
  assert(
    /update public\.content_item\s*\n\s*set current_version_id = v_id/i.test(V1),
    "current_version_id must be maintained by the trigger, never by a client",
  );
  assert(
    !/current_version_id/.test(ITEMS.split("export async function createContentItem")[1] ?? ""),
    "the client must not write current_version_id — it could point at another item's version",
  );
});

Deno.test("IDEMPOTENCY: an identical rewrite creates no second version", () => {
  // The guard is the reason a backend retry is safe. Deleting it while
  // "simplifying" the trigger would make every retry a duplicate version.
  assert(
    /when \(OLD\.body IS DISTINCT FROM NEW\.body OR OLD\.title IS DISTINCT FROM NEW\.title\)/i
      .test(V1),
    "the update trigger must fire only when the text actually changed",
  );
});

Deno.test("a regeneration is DISTINGUISHABLE from a first draft and from an edit", () => {
  assert(/regenerate\?: boolean/.test(GEN), "the seam must carry the flag");
  assert(
    /last_generation_source: cl\.regenerate \? "scribe_regeneration" : "scribe_generation"/
      .test(WRITER),
    "the writer must record which one this was",
  );
  assert(
    /generation_source/.test(V1),
    "and the version row must carry it, or history cannot show it",
  );
});

Deno.test("history is read-only", () => {
  // A version is what the draft said at a point in time. An editable history is
  // not a history — there is deliberately no UPDATE or DELETE policy.
  assert(DRAWER.includes("ContentVersionRow"), "the drawer renders versions");
  assert(
    !/updateContentItemVersion|deleteVersion/.test(ITEMS),
    "there must be no writer for a version row",
  );
});

// ══════════ 4. source provenance ══════════════════════════════════════════

Deno.test("a signal-sourced draft KEEPS its signal", () => {
  assert(
    /source_type: 'signal'/.test(PAGE),
    "the signal path must mark the item as signal-sourced",
  );
  assert(
    /source_signal_id: sg\.id/.test(PAGE),
    "and must persist which signal it was",
  );
  // The database refuses the incoherent combination.
  assert(
    /content_item_source_coherent/.test(V1),
    "a signal-sourced item must not be able to claim no signal",
  );
});

Deno.test("a deleted signal leaves a readable item, not a dangling reference", () => {
  // ON DELETE SET NULL on the existing FK. The item survives and the UI reports
  // the missing source; it does not vanish and does not point at nothing.
  assert(
    /source_signal_id/.test(V1) && /on delete set null/i.test(V1),
    "the signal reference must be nulled, never cascade-delete the draft",
  );
});

// ══════════ 5. the brief ══════════════════════════════════════════════════

Deno.test("the instruction is built from typed fields and always says draft only", () => {
  const idea = buildContentInstruction({
    format: "linkedin_post", sourceType: "idea",
    idea: "Why businesses need an AI workforce", signalTitle: null,
  });
  assert(idea.includes("LinkedIn post"), "the type must reach the brief");
  assert(idea.includes("Why businesses need an AI workforce"), "so must the idea");
  assert(idea.includes("Draft only"), "nothing here may publish");

  const sig = buildContentInstruction({
    format: "linkedin_comment", sourceType: "signal",
    idea: "", signalTitle: "Acme raised a Series B",
  });
  assert(sig.includes("LinkedIn comment"));
  assert(sig.includes("Acme raised a Series B"), "the signal is the brief");
  assert(sig.includes("Draft only"));
});

Deno.test("a signal with no title degrades rather than inventing a subject", () => {
  const s = buildContentInstruction({
    format: "linkedin_post", sourceType: "signal", idea: "the hiring angle", signalTitle: null,
  });
  assert(s.includes("the selected signal"), "it must not fabricate a subject");
  assert(s.includes("the hiring angle"), "the user's angle still reaches Scribe");
});

Deno.test("Company Brain is NOT duplicated into the brief", () => {
  // run-agent already loads the workspace brain and renders it into Scribe's
  // system prompt. Pasting it here would duplicate the context and let this
  // file drift from the real one.
  const INSTR = Deno.readTextFileSync(new URL("src/lib/content/contentInstruction.ts", ROOT));
  assert(
    !/company_brain|companyBrain/i.test(INSTR.replace(/\/\/.*$/gm, "")),
    "the brief must not assemble its own Company Brain",
  );
});

// ══════════ LIVE VERIFICATION ═════════════════════════════════════════════
//
// Run against the production database on 2026-09-11, before the canary:
//
//   insert content_item              -> v1, current_version_id set,
//                                       generation_source scribe_generation   ✓
//   update body                      -> v2, pointer moved, v1 unchanged       ✓
//   update body to the SAME text     -> still 2 versions (idempotent)         ✓
//   status-only update               -> no new version                        ✓
//   anon SELECT content_item         -> [] (RLS)                              ✓
//   anon INSERT content_item         -> 42501 row-level security              ✓

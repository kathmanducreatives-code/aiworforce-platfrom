// CONTENT STUDIO — the mounted page, what it shows, and what its actions may
// and may not touch.
//
// The model is exercised as behaviour (it is pure). The page and the writers
// are read as source: that the Studio is MOUNTED (the drawer it replaced is
// gone), that every action goes through `contentService`, and that the
// invariants the Studio promises — an edit is a version, regenerating text
// keeps the image, regenerating the image keeps the text, history is never
// rewritten — are properties of the code that runs, not of the UI copy.
//
// ZERO network, ZERO database, ZERO models.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  briefFieldsOf, deriveHook, describeContentSource, relationshipLabel, studioActions, type StudioItem,
} from "../../src/lib/content/contentStudioModel.ts";
import { signalContentSource, feedSignalSubject } from "../../src/lib/signalIdeaActions.ts";

const ROOT = new URL("../../", import.meta.url);
const read = (p: string) => Deno.readTextFile(new URL(p, ROOT));
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").split("\n")
  .map((l) => (l.trim().startsWith("//") ? "" : l.replace(/\s\/\/.*$/, ""))).join("\n");

const base: StudioItem = {
  id: "i1", status: "draft", format: "linkedin_post", title: "T", body: "", source: "content_surface",
  source_type: "idea", source_signal_id: null, current_version_id: null, metadata: {},
};

// ══════════ 1. source, truthfully ══════════════════════════════════════════

Deno.test("source: idea, canonical signal, legacy signal, engagement post", () => {
  assertEquals(describeContentSource({ ...base, metadata: { topic: "why AI workforces" } }).kind, "idea");

  const sig = describeContentSource({
    ...base, source_type: "signal", source_signal_id: "sig-1",
    metadata: { brief_input: { signalTitle: "Outreach release", signalSubject: { relationship: "competitor", name: "Outreach" } } },
  });
  assertEquals([sig.kind, sig.linked, sig.about], ["signal", true, "Outreach release"]);
  assertEquals(relationshipLabel(sig.subject), "Competitor · Outreach");

  const legacy = describeContentSource({ ...base, metadata: { legacy_signal: { id: "l1", title: "Old signal", store: "signals" } } });
  assertEquals([legacy.kind, legacy.linked, legacy.about], ["legacy_signal", false, "Old signal"]);
  assertEquals(legacy.subject?.relationship, "external", "a legacy signal is someone else's news even without its id");

  const post = describeContentSource({ ...base, format: "linkedin_comment", metadata: { engagement_post: { post_url: "https://x", author: "Alice" } } });
  assertEquals([post.kind, post.url, post.label], ["engagement_post", "https://x", "Comment on Alice's LinkedIn post"]);
});

Deno.test("brief fields read back exactly as saved; the hook is the draft's first line", () => {
  const f = briefFieldsOf({ ...base, metadata: { brief_input: { fields: { audience: "seed founders", cta: "reply" } } } });
  assertEquals(f, { audience: "seed founders", objective: "", angle: "", cta: "reply" });
  assertEquals(deriveHook("\n\n  I watched a founder burn 45 minutes.\nMore."), "I watched a founder burn 45 minutes.");
  assertEquals(deriveHook(""), null);
});

// ══════════ 2. what the actions allow ═══════════════════════════════════════

Deno.test("regeneration never overwrites an unsaved edit or an unsaved brief", () => {
  const a = studioActions({ status: "draft", body: "copy", dirtyBody: true, dirtyBrief: false, assetCount: 0, busy: false });
  assertEquals(a.writeText.enabled, false);
  assert(a.writeText.reason?.includes("Save or discard"));
  const b = studioActions({ status: "draft", body: "copy", dirtyBody: false, dirtyBrief: true, assetCount: 0, busy: false });
  assertEquals(b.writeText.enabled, false);
  assert(b.writeText.reason?.includes("Save the brief first"));
  assertEquals(b.save.enabled, true);
});

Deno.test("an image needs copy; the second one is a regeneration; archived drafts are read-only", () => {
  assertEquals(studioActions({ status: "draft", body: "", dirtyBody: false, dirtyBrief: false, assetCount: 0, busy: false }).image.enabled, false);
  const one = studioActions({ status: "draft", body: "copy", dirtyBody: false, dirtyBrief: false, assetCount: 1, busy: false });
  assertEquals([one.image.enabled, one.image.label], [true, "Regenerate image"]);
  assertEquals(one.writeText.label, "Regenerate text");
  const arch = studioActions({ status: "archived", body: "copy", dirtyBody: false, dirtyBrief: false, assetCount: 1, busy: false });
  assertEquals([arch.writeText.enabled, arch.image.enabled, arch.archive.enabled, arch.restore.enabled], [false, false, false, true]);
  assertEquals(studioActions({ status: "approved", body: "c", dirtyBody: false, dirtyBrief: false, assetCount: 0, busy: false }).approve.enabled, false);
});

// ══════════ 3. the mounted page ═════════════════════════════════════════════

Deno.test("the MOUNTED page is Sources | Studio | Scribe/History, and the old surfaces are gone", async () => {
  const page = code(await read("src/pages/Content.tsx"));
  for (const c of ["<ContentSourcesPanel", "<ContentStudioEditor", "<ScribePanel", "<SourcePreview", "<ContentComposer"]) {
    assert(page.includes(c), `${c} is rendered by the routed page`);
  }
  // History is contextual to the open draft (Scribe panel), not a top-level page.
  assert(!/id: 'history', label: 'History'/.test(page), "no top-level History view");
  for (const gone of ["ContentDetailDrawer", "MiraCopilot", "ManualContentSource", "ForYouView", "TrendsView", "PlanView"]) {
    assert(!page.includes(gone), `${gone} is not mounted`);
  }
  const app = await read("src/App.tsx");
  assert(app.includes('lazy(() => import("./pages/Content"))') && app.includes('path="/content"'), "and that page is the routed one");
  for (const f of ["ContentDetailDrawer", "MiraCopilot", "ManualContentSource"]) {
    let exists = true;
    try { await Deno.stat(new URL(`src/components/content/${f}.tsx`, ROOT)); } catch { exists = false; }
    assert(!exists, `${f}: no orphan left behind`);
  }
});

Deno.test("every Studio action goes through the Content service — the page writes nothing itself", async () => {
  const page = code(await read("src/pages/Content.tsx"));
  const i = page.indexOf("const studioHandlers");
  const handlers = page.slice(i, page.indexOf("} : null;", i));
  for (const call of [
    "saveContentBrief(studioItem, fields)", "saveContentEdit(studioItem.id, { body })",
    "regenerateContentText(workspaceId, studioItem)", "draftContentText(workspaceId, studioItem)",
    "generateContentImage(workspaceId, studioItem.id)", "approveContent(studioItem.id)",
    "archiveContent(studioItem.id)", "restoreContent(studioItem.id)",
  ]) assert(handlers.includes(call), call);
  assert(!/supabase\s*\.from\(/.test(handlers) && !/functions\.invoke\(/.test(handlers));
  // Scribe's revisions take the same service path.
  assert(page.includes("reviseContentText(workspaceId, studioItem, revision)"));
  // Archived drafts stay reachable: archiving leaves the working set, not the record.
  const sources = code(await read("src/components/content/ContentSourcesPanel.tsx"));
  assert(sources.includes('showArchived || it.status !== "archived"'));
});

Deno.test("signal drafts from the page carry ownership; the composer no longer passes a raw feed id", async () => {
  const page = code(await read("src/pages/Content.tsx"));
  const turn = page.slice(page.indexOf("const turnSignalInto"), page.indexOf("}, [workspaceId, createContentDraft"));
  assert(turn.includes("signalSubject: source.subject") && turn.includes("brief_input: briefInput"));
  const submit = page.slice(page.indexOf("onSubmit={async (input: ComposerSubmission)"));
  assert(submit.includes("signalContentSource(picked)"));
  assert(!/source_signal_id:\s*input\.signalId/.test(submit), "a legacy feed id in the FK column violated it");
  // The feed projection's relationship fields decide, via the shared rule.
  const canonical = { id: "e", title: "Outreach release", store: "signal_events" as const, signal_type: "competitor", raw: { subject_type: "competitor", subject_key: "outreach" }, competitor_name: "outreach" };
  assertEquals(signalContentSource(canonical).subject.relationship, "competitor");
  assertEquals(feedSignalSubject({ signal_type: "sales_hiring", account_name: "DiligenceVault", raw: { subject_type: "company" } }),
    { relationship: "external_company", name: "DiligenceVault" });
});

// ══════════ 4. the invariants the Studio promises ═══════════════════════════

Deno.test("EDIT CREATES A NEW VERSION — recorded as a person's, on every edit path", async () => {
  const svc = code(await read("src/lib/content/contentService.ts"));
  const save = svc.slice(svc.indexOf("export async function saveContentEdit"));
  assert(save.includes("last_generation_source: 'manual_edit'"));
  // The hook the old editor used stamped hand edits with Scribe's provenance.
  const hook = code(await read("src/hooks/useContentItems.ts"));
  assert(hook.includes("? { ...patch, last_generation_source: 'manual_edit' }"));
  const v1 = await read("supabase/migrations/20260911120000_content_v1.sql");
  assert(/when \(OLD\.body IS DISTINCT FROM NEW\.body OR OLD\.title IS DISTINCT FROM NEW\.title\)/i.test(v1),
    "a copy change writes a version; a status or brief change does not");
});

Deno.test("TEXT REGENERATION KEEPS THE IMAGE — nothing on the text path touches the asset pointer", async () => {
  const writer = code(await read("supabase/functions/_shared/memoryWriter.ts"));
  const fill = writer.slice(writer.indexOf("async function fillContentItem"), writer.indexOf("async function writeEngagementCommentItems"));
  assert(fill.includes(".update({") && !fill.includes("current_asset_id"));
  const svc = code(await read("src/lib/content/contentService.ts"));
  const text = svc.slice(svc.indexOf("async function writeContentText"), svc.indexOf("async function signalForItem"));
  assert(!text.includes("generate-content-image") && !text.includes("current_asset_id"));
});

Deno.test("IMAGE REGENERATION KEEPS THE TEXT — and never overwrites an earlier image", async () => {
  const fn = code(await read("supabase/functions/generate-content-image/index.ts"));
  const itemUpdates = fn.split('.from("content_item")').slice(1).map((s) => s.slice(0, s.indexOf(";")));
  const writes = itemUpdates.filter((s) => s.includes(".update("));
  assertEquals(writes.length, 1, "exactly one write to content_item");
  assert(writes[0].includes("current_asset_id: assetId") && !/body|title/.test(writes[0]), "it moves the pointer, never the copy");
  assert(fn.includes("${workspaceId}/${row.id}/${assetId}.png") && fn.includes("upsert: false"),
    "one storage object per asset, never overwritten");
});

Deno.test("OLD VERSIONS AND ASSETS STAY INTACT — clients cannot update or delete either", async () => {
  const item = await read("supabase/migrations/20260910120000_content_item.sql");
  const versionPolicies = item.split("\n").filter((l) => /CREATE POLICY/i.test(l) && /content_item_version/.test(l));
  assert(versionPolicies.length > 0 && versionPolicies.every((l) => /members (read|insert)/.test(l)),
    "versions: read and insert only");
  const asset = await read("supabase/migrations/20260911140000_content_asset.sql");
  const assetPolicies = asset.split("\n").filter((l) => /create policy/i.test(l) && /content_asset members/.test(l));
  assert(assetPolicies.every((l) => /members (read|insert)/.test(l)), "assets: read and insert only");
  const items = code(await read("src/lib/content/contentItems.ts"));
  assert(!/content_item_version'\)\s*\.(update|delete)/.test(items) && !/content_asset'\)\s*\.(update|delete)/.test(items));
});

Deno.test("regeneration rebuilds the brief with ownership re-read from the SIGNAL row", async () => {
  const svc = code(await read("src/lib/content/contentService.ts"));
  const cur = svc.slice(svc.indexOf("export async function currentBrief"), svc.indexOf("export async function saveContentBrief"));
  assert(cur.includes("signalForItem(item.source_signal_id)") && cur.includes("signalSubject: sig.subject"),
    "a draft written before attribution existed is corrected on its next regeneration");
  const sig = svc.slice(svc.indexOf("async function signalForItem"), svc.indexOf("export function briefInputFor"));
  assert(sig.includes(".select('id, signal_type, subject_type, subject_key, normalized_value')"));
});

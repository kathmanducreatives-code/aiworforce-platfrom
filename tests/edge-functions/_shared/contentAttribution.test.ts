// AGENTORY IS THE AUTHOR; THE SIGNAL'S SUBJECT IS SOMEONE ELSE.
//
// Production, 2026-09-11: a draft from the competitor signal "Outreach February
// 2026 Product Release: AI That Executes" opened "We just shipped…". These
// tests pin the structural fix: the brief states WHO IS WRITING (us, per the
// Company Brain) and WHO IT HAPPENED TO (from the source row's relationship
// fields), for every path that makes Content from a signal.
//
// ZERO network, ZERO models.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildContentInstruction, signalSubjectFrom,
} from "../../../supabase/functions/_shared/contentInstruction.ts";
import { canonicalSubject } from "../../../supabase/functions/_shared/signalContentHandoff.ts";
import { createCanonicalContentItem, type ContentDb } from "../../../supabase/functions/_shared/contentOperations.ts";

// ══════════ 1. who it happened to — from relationship fields, never prose ══

Deno.test("the production rows resolve to their real relationship", () => {
  // signal_events 91641830 — exactly as stored.
  assertEquals(canonicalSubject({
    id: "91641830", signal_type: "competitor_activity", subject_type: "competitor", subject_key: "outreach",
    normalized_value: { title: "Outreach February 2026 Product Release: AI That Executes", company_name: null },
  }), { relationship: "competitor", name: "Outreach" });
  // signal_events 567e7e6e — a market trend.
  assertEquals(signalSubjectFrom({ subject_type: "market", subject_key: "workflow-trends", signal_type: "market_problem_discussion" }),
    { relationship: "market", name: null });
  // signal_events b0b7ab92 — a named company that is hiring.
  assertEquals(signalSubjectFrom({ subject_type: "company", subject_key: "diligencevault-com", signal_type: "sales_hiring", company_name: "DiligenceVault" }),
    { relationship: "external_company", name: "DiligenceVault" });
  // signals ac3b2d0d — a legacy competitor row carries only its type.
  assertEquals(signalSubjectFrom({ signal_type: "competitor" }), { relationship: "competitor", name: null });
  // Nothing known: someone other than us — never us.
  assertEquals(signalSubjectFrom({}), { relationship: "external", name: null });
});

Deno.test("a subject KEY passed as a name is rendered as a name", () => {
  // Live canary: the feed projection passes `subject_key` through as
  // competitor_name, and the brief read "outreach — a competitor of ours".
  assertEquals(signalSubjectFrom({ subject_type: "competitor", subject_key: "outreach", competitor_name: "outreach" }),
    { relationship: "competitor", name: "Outreach" });
  assertEquals(signalSubjectFrom({ subject_type: "competitor", subject_key: "outreach", competitor_name: "Outreach.io" }).name, "Outreach.io");
});

Deno.test("the title never decides ownership — only the row's fields do", () => {
  // A title that reads like OUR announcement is still a competitor's when the
  // row says so; and a competitor-sounding title decides nothing on its own.
  const s = signalSubjectFrom({ subject_type: "competitor", subject_key: "outreach" });
  assertEquals(s.relationship, "competitor");
  const src = Deno.readTextFileSync(new URL("../../../supabase/functions/_shared/contentInstruction.ts", import.meta.url));
  const fn = src.slice(src.indexOf("export function signalSubjectFrom"), src.indexOf("/** The ownership lines"));
  assert(!/title/.test(fn.split("{").slice(2).join("{")), "signalSubjectFrom must not read a title");
});

// ══════════ 2. the brief states both roles ══════════════════════════════════

const OUTREACH = { relationship: "competitor" as const, name: "Outreach" };

Deno.test("a competitor signal brief: we are the author, it is THEIR news", () => {
  const brief = buildContentInstruction({
    format: "linkedin_post", sourceType: "signal", idea: "",
    signalTitle: "Outreach February 2026 Product Release: AI That Executes", signalSubject: OUTREACH,
  });
  assert(brief.includes("WHO IS WRITING: us — the company described in the Company Brain"));
  assert(brief.includes('What happened: "Outreach February 2026 Product Release: AI That Executes"'));
  assert(brief.includes("Who it happened to: Outreach — a competitor of ours, not us."));
  assert(brief.includes("This is Outreach's news, not ours."));
  assert(brief.includes('"we shipped", "our release"'), "the brief forbids claiming their launch");
  assert(brief.includes("Draft only."));
});

Deno.test("a signal with no known subject is still NOT ours", () => {
  const brief = buildContentInstruction({ format: "linkedin_post", sourceType: "signal", idea: "", signalTitle: "Something happened" });
  assert(brief.includes("Who it happened to: Someone other than us."));
  assert(brief.includes("not ours"));
});

Deno.test("a LEGACY signal (stored as idea, no FK) keeps its ownership block", () => {
  const brief = buildContentInstruction({
    format: "linkedin_post", sourceType: "idea", idea: "",
    signalTitle: "Outreach February 2026 Product Release: AI That Executes",
    signalSubject: { relationship: "competitor", name: null },
  });
  assert(brief.includes("THE SOURCE — what happened, and who it happened to:"));
  assert(brief.includes("A competitor — a competitor of ours, not us."));
});

Deno.test("a market signal is nobody's release; a company signal is theirs", () => {
  const m = buildContentInstruction({ format: "linkedin_post", sourceType: "signal", idea: "", signalTitle: "AI SDR adoption", signalSubject: { relationship: "market", name: null } });
  assert(m.includes("market-wide trend, and not our news"));
  const c = buildContentInstruction({ format: "linkedin_post", sourceType: "signal", idea: "", signalTitle: "Sales Hiring", signalSubject: { relationship: "external_company", name: "DiligenceVault" } });
  assert(c.includes("DiligenceVault — not us.") && c.includes("DiligenceVault's news, not ours"));
});

Deno.test("an idea is ours: author stated, no source block; the brief fields travel", () => {
  const brief = buildContentInstruction({
    format: "linkedin_post", sourceType: "idea", idea: "why AI workforces beat point tools", signalTitle: null,
    fields: { audience: "seed founders", objective: "book demos", angle: "cost of context switching", cta: "reply 'workforce'" },
  });
  assert(brief.startsWith("Scribe, write a LinkedIn post about: why AI workforces beat point tools. Draft only."));
  assert(brief.includes("WHO IS WRITING: us"));
  assert(!brief.includes("THE SOURCE"));
  for (const l of ["Angle: cost of context switching", "Audience: seed founders", "Objective: book demos", "Call to action: reply 'workforce'"]) {
    assert(brief.includes(l), l);
  }
});

// ══════════ 3. the server creator keeps the typed input ═════════════════════

Deno.test("Pilot's creator persists the attributed brief AND its typed input", async () => {
  let inserted: Record<string, unknown> | null = null;
  const db = {
    from: () => ({
      insert: (v: Record<string, unknown>) => {
        inserted = v;
        return { select: () => ({ single: async () => ({ data: { id: "item-1", ...v }, error: null }) }) };
      },
    }),
  } as unknown as ContentDb;
  const r = await createCanonicalContentItem(db, {
    objective: "create", workspace_id: "ws", format: "linkedin_post", source_type: "signal",
    source_signal_id: "sig-1", source_signal_title: "Outreach February 2026 Product Release", signal_subject: OUTREACH,
    idea: "", created_by: null,
  });
  assert(r.ok);
  const meta = (inserted as unknown as { metadata: Record<string, unknown> }).metadata;
  assert(String(meta.brief).includes("Outreach — a competitor of ours, not us."));
  assertEquals((meta.brief_input as Record<string, unknown>).signalSubject, OUTREACH);
});

Deno.test("a legacy signal through Pilot: provenance, ownership, no FK", async () => {
  let inserted: Record<string, unknown> | null = null;
  const db = {
    from: () => ({
      insert: (v: Record<string, unknown>) => {
        inserted = v;
        return { select: () => ({ single: async () => ({ data: { id: "item-2", ...v }, error: null }) }) };
      },
    }),
  } as unknown as ContentDb;
  const r = await createCanonicalContentItem(db, {
    objective: "create", workspace_id: "ws", format: "linkedin_post", source_type: "idea",
    source_signal_id: null, legacy_signal: { id: "legacy-1", title: "Outreach Product Release Notes" },
    signal_subject: { relationship: "competitor", name: null }, idea: "", created_by: null,
  });
  assert(r.ok, "a legacy signal needs no idea text to be about something");
  const row = inserted as unknown as Record<string, unknown>;
  assertEquals(row.source_signal_id, null);
  assertEquals(row.title, "Outreach Product Release Notes");
  const meta = row.metadata as Record<string, unknown>;
  assert(String(meta.brief).includes("a competitor of ours, not us"));
  assertEquals((meta.legacy_signal as Record<string, unknown>).id, "legacy-1");
});

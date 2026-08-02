// Integration tests: the tested contracts wired into persistence (enrichAndGateRows),
// the env-gated adapters, and normalizers. NO provider calls (replay-safe).

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { compileCompanyBrainContext } from "../../../supabase/functions/_shared/companyBrainCompiler.ts";
import { buildRadarIntelligenceProfile } from "../../../supabase/functions/_shared/radarIntel/radarIntelligenceProfile.ts";
import { enrichAndGateRows, type EnrichableRow } from "../../../supabase/functions/_shared/radarIntel/radarSignalEnrichment.ts";
import { postsAdapterStatus, commentsAdapterStatus, peopleAdapterStatus, normalizePostRow, normalizeCommentRow, normalizePersonRow } from "../../../supabase/functions/_shared/radarIntel/radarProviderAdapters.ts";
import { buildSourceDiagnostics } from "../../../supabase/functions/_shared/radarIntel/radarDiagnostics.ts";

function intel() {
  return buildRadarIntelligenceProfile(compileCompanyBrainContext({
    workspace_id: "wsA",
    profile: {
      company: { category: "AI SaaS", description: "signal-based pipeline for B2B SaaS founders" },
      icp: { industries: ["B2B SaaS"], buyer_roles: ["Founder", "RevOps", "VP Sales"], company_size: "10-150 employees", geography: "United States", disqualifiers: ["staffing agency", "nonprofit"] },
      competitors: { known: ["Alta"] },
    },
    signal_preferences: { linkedin_topics: ["AI GTM agents"] },
  }));
}

function hiringRow(over: { company?: string; role?: string; url?: string | null; industries?: string; matched?: string[]; fresh?: number }): EnrichableRow {
  return {
    signal_type: "hiring", signal_label: "Active hiring: Active hiring", title: `${over.company ?? "Acme"} hiring`, source_url: over.url ?? "https://acme.com/jobs/1",
    raw: { source_details: { company: over.company ?? "Acme", job_title: over.role ?? "RevOps Manager", job_url: over.url ?? "https://acme.com/jobs/1", industries: over.industries ?? "B2B SaaS" }, verification_status: "verified", matched_icp: over.matched ?? ["B2B SaaS"], freshness_score: over.fresh ?? 9, why_now: "Active posting", tags: ["Active hiring", "Active hiring"] },
  };
}

const RUN = "run-123";

// 2 & 3. hiringRoleFamily affects persistence; unrelated jobs are dropped -----
Deno.test("2/3. unrelated hiring rows are dropped, not persisted", () => {
  const rows = [hiringRow({ role: "RevOps Manager" }), hiringRow({ company: "BigCo", role: "Product Manager Intern" }), hiringRow({ company: "LabCo", role: "Director of Commercial Analytics" })];
  const out = enrichAndGateRows(rows, intel(), RUN);
  assertEquals(out.kept.length, 1);
  assertEquals(out.kept[0].raw["role_family"], "exact");
  assert(out.dropped.length === 2);
  assert((out.rejection_reasons["unrelated_role"] ?? 0) >= 2);
});

// 4. adjacent roles persist as watch (never contact) -------------------------
Deno.test("4. adjacent roles are kept but capped at watch", () => {
  const out = enrichAndGateRows([hiringRow({ role: "Account Executive" })], intel(), RUN);
  assertEquals(out.kept.length, 1);
  assertEquals(out.kept[0].raw["role_family"], "adjacent");
  assert(out.kept[0].raw["canonical_decision"] !== "contact");
});

// 5. company exclusions apply ------------------------------------------------
Deno.test("5. excluded companies (agency/nonprofit) are dropped", () => {
  const out = enrichAndGateRows([hiringRow({ company: "TalentBridge", role: "RevOps", industries: "staffing agency" })], intel(), RUN);
  assertEquals(out.kept.length, 0);
  assert((out.rejection_reasons["excluded_company"] ?? 0) === 1);
});

// hiring headline + scan_run_id + tag hygiene --------------------------------
Deno.test("enrichment sets headline, scan_run_id, and de-dupes tags", () => {
  const out = enrichAndGateRows([hiringRow({ company: "Acme", role: "RevOps Manager" })], intel(), RUN);
  const raw = out.kept[0].raw;
  assertEquals(raw["headline"], "Acme is hiring a RevOps Manager.");
  assertEquals(raw["scan_run_id"], RUN);
  assertEquals(out.kept[0].signal_label, "Active hiring"); // "Active hiring: Active hiring" collapsed
  assertEquals((raw["tags"] as string[]).length, 1);
});

// 6 & 7. missing posts/comments actors → not_configured ----------------------
Deno.test("6/7. missing posts/comments actors report not_configured, no call", () => {
  const emptyEnv = (_: string) => undefined;
  assertEquals(postsAdapterStatus(emptyEnv, true).configured, false);
  assertEquals(postsAdapterStatus(emptyEnv, true).actor, null); // never invented
  assertEquals(commentsAdapterStatus(emptyEnv, true).configured, false);
  // Present env + token → configured, actor read from env (not hardcoded).
  const withEnv = (n: string) => (n === "RADAR_APIFY_LINKEDIN_POSTS_ACTOR" ? "acme~posts-actor" : undefined);
  const st = postsAdapterStatus(withEnv, true);
  assertEquals(st.configured, true);
  assertEquals(st.actor, "acme~posts-actor");
});

// 8. missing people actor blocks contact and fabricates no person ------------
Deno.test("8. no people actor → no decision_maker → outreach blocked, no fabricated person", () => {
  assertEquals(peopleAdapterStatus((_: string) => undefined, true).configured, false);
  // A verified hiring row with no decision maker cannot draft outreach.
  const out = enrichAndGateRows([hiringRow({ role: "RevOps Manager" })], intel(), RUN);
  assertEquals(out.kept[0].raw["can_draft_outreach"], false);
  assert(String(out.kept[0].raw["recommended_action"]).length > 0);
});

// 9. post metrics never fabricated ------------------------------------------
Deno.test("9. normalizePostRow leaves engagement null when the actor gave none", () => {
  const p = normalizePostRow({ authorName: "Jane", text: "AI GTM playbook", postUrl: "https://linkedin.com/posts/1" });
  assertEquals(p.reactions, null);
  assertEquals(p.comments, null);
  assertEquals(p.reposts, null);
  assertEquals(normalizePostRow({ numLikes: 42, numComments: 5 }).reactions, 42);
});

// 10. comments preserve parent evidence -------------------------------------
Deno.test("10. normalizeCommentRow preserves parent-post evidence", () => {
  const c = normalizeCommentRow({ commenterName: "Sam", commentText: "How did you build this?", parentPostUrl: "https://linkedin.com/posts/9", parentPostText: "our agent playbook" });
  assertEquals(c.parent_post_url, "https://linkedin.com/posts/9");
  assertEquals(c.parent_post_text, "our agent playbook");
});

// 11. person-only rows excluded from verified -------------------------------
Deno.test("11. person-only rows are flagged excluded_from_verified, decision needs_review", () => {
  const personRow: EnrichableRow = { signal_type: "people_profile", title: "Jane Doe", source_url: null, raw: { is_person_only: true } };
  const out = enrichAndGateRows([personRow], intel(), RUN);
  assertEquals(out.kept[0].raw["excluded_from_verified"], true);
  assertEquals(out.kept[0].raw["canonical_decision"], "needs_review");
  assertEquals(out.kept[0].raw["can_draft_outreach"], false);
});

// 16. canonical decision controls outreach ----------------------------------
Deno.test("16. needs_review rows cannot draft outreach", () => {
  // No evidence url + no company → needs_review.
  const weak: EnrichableRow = { signal_type: "competitor", title: "x", source_url: null, raw: { source_details: {}, verification_status: "needs_verification" } };
  const out = enrichAndGateRows([weak], intel(), RUN);
  assertEquals(out.kept[0].raw["canonical_decision"], "needs_review");
  assertEquals(out.kept[0].raw["can_draft_outreach"], false);
});

// 17. diagnostics returned for every attempted source -----------------------
Deno.test("17. a diagnostic can be built per source with honest readiness", () => {
  const d = buildSourceDiagnostics({ source: "linkedin_post", configured: false, execution_status: "skipped_not_configured" });
  assertEquals(d.readiness, "not_configured");
  assertEquals(d.source, "linkedin_post");
});

// 21. no provider calls in this suite ---------------------------------------
Deno.test("21. enrichment + adapter-status modules are pure (no fetch on these paths)", async () => {
  const enrichSrc = await Deno.readTextFile(new URL("../../../supabase/functions/_shared/radarIntel/radarSignalEnrichment.ts", import.meta.url));
  assert(!/\bfetch\s*\(/.test(enrichSrc), "enrichment must not call fetch");
  // adapters has a runApifyActor fetch, but it is only reachable when configured.
  const adaptersSrc = await Deno.readTextFile(new URL("../../../supabase/functions/_shared/radarIntel/radarProviderAdapters.ts", import.meta.url));
  assert(/adapter not configured/.test(adaptersSrc), "fetch path must guard on configuration");
});

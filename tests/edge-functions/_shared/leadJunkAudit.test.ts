import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { auditLeadBatch, classifyLeadForAudit, isHumanProtected, type AuditLeadRow } from "../../../supabase/functions/_shared/leadJunkAudit.ts";

Deno.test("audit: a row with real source proof + domain is kept", () => {
  const row: AuditLeadRow = { id: "1", company_name: "JustAI", website: "https://justai.com", domain: "justai.com", source_url: "https://linkedin.com/jobs/view/justai", raw: { match_tier: "strict" } };
  assertEquals(classifyLeadForAudit(row).verdict, "keep");
});

Deno.test("audit: no source proof → archive candidate", () => {
  const row: AuditLeadRow = { id: "2", company_name: "Ghost", raw: {} };
  const r = classifyLeadForAudit(row);
  assertEquals(r.verdict, "archive_candidate");
  assert(r.reasons.some((x) => /no verifiable source proof/i.test(x)));
});

Deno.test("audit: shortener website with no domain → archive candidate", () => {
  const row: AuditLeadRow = { id: "3", company_name: "Ajax", website: "https://bit.ly/ajax", source_url: "https://linkedin.com/jobs/view/ajax", raw: { website_shortener_dropped: true } };
  const r = classifyLeadForAudit(row);
  assertEquals(r.verdict, "archive_candidate");
  assert(r.reasons.some((x) => /shortener/i.test(x)));
});

Deno.test("audit: recruiter proxy row → archive candidate", () => {
  const row: AuditLeadRow = { id: "4", company_name: "Stelvio", source_url: "https://linkedin.com/jobs/view/stelvio", raw: { recruiter_proxy: true, match_tier: "reject" } };
  const r = classifyLeadForAudit(row);
  assertEquals(r.verdict, "archive_candidate");
  assert(r.reasons.some((x) => /recruiter\/staffing proxy/i.test(x)));
});

Deno.test("audit: PROTECTED — approved/contacted/enriched rows are NEVER archived", () => {
  // Even a junk-looking row (no proof) is protected once a human acts on it.
  const approved: AuditLeadRow = { id: "5", company_name: "X", status: "approved", raw: {} };
  assert(isHumanProtected(approved));
  assertEquals(classifyLeadForAudit(approved).verdict, "keep");
  assert(classifyLeadForAudit(approved).protected);

  const contacted: AuditLeadRow = { id: "6", company_name: "Y", contact_status: "contacted", raw: {} };
  assertEquals(classifyLeadForAudit(contacted).verdict, "keep");

  const draftApproved: AuditLeadRow = { id: "7", company_name: "Z", draft_status: "approved", raw: {} };
  assertEquals(classifyLeadForAudit(draftApproved).verdict, "keep");
});

Deno.test("audit: batch summary counts keep/archive/protected + collects ids (read-only)", () => {
  const rows: AuditLeadRow[] = [
    { id: "keep1", source_url: "https://linkedin.com/jobs/view/a", domain: "a.com", company_name: "A", raw: {} },
    { id: "junk1", company_name: "B", raw: {} },                                  // no proof
    { id: "junk2", company_name: "C", source_url: "https://x/c", raw: { recruiter_proxy: true } },
    { id: "prot1", company_name: "D", status: "sent", raw: {} },                  // protected
  ];
  const s = auditLeadBatch(rows);
  assertEquals(s.reviewed, 4);
  assertEquals(s.archive_candidates, 2);
  assertEquals(s.protected, 1);
  assertEquals(s.keep, 2);                          // keep1 + prot1
  assertEquals(s.archive_ids.sort(), ["junk1", "junk2"]);
  assert(Object.keys(s.reason_counts).length > 0);
});

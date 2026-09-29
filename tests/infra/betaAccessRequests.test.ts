// BETA ACCESS REQUESTS: A MEMBER FILES, ONLY THE OPERATOR DECIDES.
//
// Spend fails closed and credits are a beta grant (docs/launch/budget-safety.md).
// `beta_access_requests` is how a workspace asks. The browser may file a pending
// request as itself and read its own workspace's requests — nothing else; the
// decision (status, credits) is written by the service role through
// scripts/beta/review-requests.ts. Source-level, like the other RLS tests here,
// so it fails on the pull request; the isolation suite attacks the table on a
// real stack (it enumerates every workspace_id table). PURE.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseReviewArgs, requestGrantKey } from "../../scripts/beta/review-requests.ts";

const SQL = Deno.readTextFileSync(new URL("../../supabase/migrations/20260929140000_beta_access_requests.sql", import.meta.url));
const code = SQL.replace(/--.*$/gm, "");
const ID = "3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b";

Deno.test("RLS is on, anon has nothing, and a browser can never edit or delete a request", () => {
  assert(/alter table public\.beta_access_requests enable row level security;/.test(code));
  assert(/revoke all on table public\.beta_access_requests from anon;/.test(code));
  assert(/revoke update, delete, truncate on table public\.beta_access_requests from authenticated;/.test(code));
  const policies = [...code.matchAll(/create policy "[^"]+" on public\.beta_access_requests\s+for (\w+)/g)].map((m) => m[1]);
  assertEquals(policies.sort(), ["insert", "select"], "no update or delete policy exists");
});

Deno.test("reads and filings are scoped by the house membership helper", () => {
  const read = /for select using \(public\.has_workspace_access\(auth\.uid\(\), workspace_id\)\)/;
  assert(read.test(code));
  const insert = code.slice(code.indexOf("for insert with check"));
  assert(insert.includes("public.has_workspace_access(auth.uid(), workspace_id)"));
  assert(insert.includes("requested_by = auth.uid()"), "filed as the caller, not on someone's behalf");
  for (const pinned of ["status = 'pending'", "credits_granted is null", "decided_at is null", "decision_note is null"]) {
    assert(insert.includes(pinned), `a browser cannot file a pre-decided request (${pinned})`);
  }
});

Deno.test("one open request per workspace, and a decision is always complete", () => {
  assert(/create unique index if not exists beta_access_requests_one_pending\s+on public\.beta_access_requests \(workspace_id\) where status = 'pending';/.test(code));
  assert(code.includes("(status = 'approved' and decided_at is not null and credits_granted is not null)"));
  assert(code.includes("(status = 'pending' and decided_at is null and credits_granted is null)"));
  assert(/workspace_id\s+uuid not null references public\.workspaces\(id\) on delete cascade/.test(code));
});

Deno.test("OPERATOR REVIEW: commands validate before any network call; one request is one grant key", () => {
  assertEquals(parseReviewArgs(["list"]).cmd, { kind: "list", status: "pending" });
  assertEquals(parseReviewArgs(["list", "--status", "all"]).cmd, { kind: "list", status: "all" });
  assert(parseReviewArgs(["list", "--status", "maybe"]).errors.length > 0);
  assertEquals(parseReviewArgs(["approve", ID, "--credits", "50"]).cmd,
    { kind: "approve", id: ID, credits: 50, note: null, dryRun: false });
  assert(parseReviewArgs(["approve", ID]).errors.some((e) => e.includes("--credits")), "approve names an amount");
  assert(parseReviewArgs(["approve", ID, "--credits", "5000"]).errors.some((e) => e.includes("refused")));
  assert(parseReviewArgs(["approve", "nope", "--credits", "5"]).errors.some((e) => e.includes("uuid")));
  assertEquals(parseReviewArgs(["decline", ID, "--note", "not a fit yet"]).cmd, { kind: "decline", id: ID, note: "not a fit yet" });
  assert(parseReviewArgs(["delete", ID]).errors.length > 0, "only list, approve and decline exist");
  assertEquals(requestGrantKey(ID), `beta-request:${ID}`);
});

Deno.test("OPERATOR REVIEW: approve grants BEFORE it records, and records only a pending request", () => {
  const src = Deno.readTextFileSync(new URL("../../scripts/beta/review-requests.ts", import.meta.url));
  const main = src.slice(src.indexOf("async function main()"));
  const grant = main.indexOf("await grantCredits(env, {");
  const mark = main.indexOf('await decide(env, req.id, { status: "approved"');
  assert(grant > 0 && mark > grant, "a crash between the two leaves a pending request, repaired by re-running");
  assert(src.includes("beta_access_requests?id=eq.${id}&status=eq.pending"), "the decision write is conditional on pending");
  assertFalse(/status: "approved"[^}]*credits_granted: g\./.test(src), "the recorded amount is the operator's, not a replay's");
});

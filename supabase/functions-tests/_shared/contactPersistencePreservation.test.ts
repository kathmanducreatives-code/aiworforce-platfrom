// PROOF (not assumption) that a verified contact account association cannot be
// nulled or silently reassigned by a later contact write.
//
// A recording fake Supabase client captures every payload writeContactWith-
// VerifiedAccount issues. The invariants asserted:
//   * account_id is NEVER present in the identity insert/upsert payload;
//   * account_id is only ever set by a SEPARATE guarded update, and only when
//     the resolver decision is `verified`;
//   * the guard is `account_id.is.null,account_id.eq.<id>` (never nulls, never
//     A→B reassigns);
//   * unverified / needs_review / rejected / reassignment leave account_id
//     completely untouched (no update issued at all).
//
// No network, database, provider or model.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { writeContactWithVerifiedAccount, type ContactPersistenceDb } from "../../functions/_shared/attachContactAccount.ts";

const WS = "ws-1";
const ACC_A = "acc-A";
const ACC_B = "acc-B";

interface Recorder {
  upserts: Array<{ row: Record<string, unknown>; onConflict: string }>;
  inserts: Array<Record<string, unknown>>;
  contactUpdates: Array<{ row: Record<string, unknown>; guard: string | null }>;
  leadLinks: Array<{ row: Record<string, unknown> }>;
}

/** Build a fake DB. `lead`/`account`/`existingContact` drive the reads. */
function makeDb(opts: {
  lead?: Record<string, unknown> | null;
  account?: Record<string, unknown> | null;
  existingContact?: Record<string, unknown> | null;
  newContactId?: string;
}): { db: ContactPersistenceDb; rec: Recorder } {
  const rec: Recorder = { upserts: [], inserts: [], contactUpdates: [], leadLinks: [] };
  const newId = opts.newContactId ?? "new-contact-id";

  const db = {
    from(table: string) {
      return {
        // ---- reads (chained .eq) ----
        select(_cols: string) {
          const chain = {
            _table: table,
            eq(_c: string, _v: string) { return chain; },
            async maybeSingle() {
              if (table === "lead_candidates") return { data: opts.lead ?? null };
              if (table === "accounts") return { data: opts.account ?? null };
              if (table === "contacts") return { data: opts.existingContact ?? null };
              return { data: null };
            },
          };
          return chain;
        },
        // ---- writes ----
        upsert(row: Record<string, unknown>, o: { onConflict: string }) {
          rec.upserts.push({ row, onConflict: o.onConflict });
          return { select: (_c: string) => ({ maybeSingle: async () => ({ data: { id: newId } }) }) };
        },
        insert(row: Record<string, unknown>) {
          rec.inserts.push(row);
          return { select: (_c: string) => ({ maybeSingle: async () => ({ data: { id: newId } }) }) };
        },
        update(row: Record<string, unknown>) {
          return {
            eq(_c: string, _v: string) {
              // lead_candidates.contact_id link has no .or; contacts guarded update does.
              const thenable = {
                then(cb: (v: { error: null }) => unknown) {
                  if (table === "lead_candidates") rec.leadLinks.push({ row });
                  else rec.contactUpdates.push({ row, guard: null });
                  return Promise.resolve(cb({ error: null }));
                },
                or(f: string) {
                  rec.contactUpdates.push({ row, guard: f });
                  return Promise.resolve({ error: null });
                },
              };
              return thenable;
            },
          };
        },
      };
    },
  } as unknown as ContactPersistenceDb;

  return { db, rec };
}

const LEAD = { id: "l1", workspace_id: WS, account_id: ACC_A };
const ACCOUNT = { id: ACC_A, workspace_id: WS, name: "Harmonic", domain: "harmonic.security", linkedin_url: null, raw: {} };

function write(provenance: Record<string, unknown>, existingContact: Record<string, unknown> | null = null, account = ACCOUNT, lead = LEAD) {
  const { db, rec } = makeDb({ lead, account, existingContact });
  return { rec, promise: writeContactWithVerifiedAccount({
    db, mode: "upsert", onConflict: "workspace_id,linkedin_url",
    identity: { workspace_id: WS, full_name: "Kenneth", title: "CRO", linkedin_url: "https://linkedin.com/in/ken" },
    rawBase: { via: "decision_maker_discovery", ...provenance },
    resolve: { workspaceId: WS, leadCandidateId: "l1", contactLinkedInUrl: "https://linkedin.com/in/ken", provenance, companyScopedSearch: true },
    linkLeadCandidateId: "l1",
  }) };
}

const VERIFIED = { verification_status: "verified" };
const UNVERIFIED = { verification_status: "likely" };

// 0. account_id is NEVER in the identity payload -------------------------------
Deno.test("identity upsert payload never contains account_id (verified)", async () => {
  const { rec, promise } = write(VERIFIED);
  const res = await promise;
  assertEquals(rec.upserts.length, 1);
  assert(!("account_id" in rec.upserts[0].row), "account_id must NOT be in the upsert payload");
  assertEquals(res.accountIdWritten, ACC_A);
});

// 1. verified writes account_id via a GUARDED update ---------------------------
Deno.test("1/4. verified sets account_id via guarded update (null-or-same)", async () => {
  const { rec } = { ...await (async () => { const w = write(VERIFIED); await w.promise; return w; })() };
  assertEquals(rec.contactUpdates.length, 1);
  assertEquals(rec.contactUpdates[0].row.account_id, ACC_A);
  assertEquals(rec.contactUpdates[0].guard, `account_id.is.null,account_id.eq.${ACC_A}`);
});

// 2. existing verified A survives a WEAK rediscovery pointing at another account
Deno.test("2. existing A + weak evidence for B → A preserved, B never written", async () => {
  const leadB = { id: "l1", workspace_id: WS, account_id: ACC_B };
  const accountB = { id: ACC_B, workspace_id: WS, name: "Brain Co.", domain: "brain.co", linkedin_url: null, raw: {} };
  const w = write(UNVERIFIED, { id: "c1", account_id: ACC_A }, accountB, leadB);
  const res = await w.promise;
  assertEquals(res.accountIdWritten, ACC_A, "the existing association is preserved");
  assert(res.accountIdWritten !== ACC_B, "the new (weak) account B is never written");
  // Any update that fires targets A with the null-or-same guard — never nulls, never B.
  for (const u of w.rec.contactUpdates) {
    assertEquals(u.row.account_id, ACC_A);
    assertEquals(u.guard, `account_id.is.null,account_id.eq.${ACC_A}`);
  }
});

// 3. needs_review (no employer signal, no existing) → no account update ---------
Deno.test("3. needs_review (fresh contact, no signal) leaves account_id untouched", async () => {
  const w = write({}, null);
  const res = await w.promise;
  assertEquals(res.decision, "needs_review");
  assertEquals(w.rec.contactUpdates.length, 0);
  assert(!("account_id" in w.rec.upserts[0].row));
});

// 4. rejected (wrong verified employer) → no account update ---------------------
Deno.test("4. rejected (verified wrong employer) leaves account_id untouched", async () => {
  // Account domain harmonic.security; contact provenance says verified employer
  // is a different domain → resolver rejects.
  const w = write({ verification_status: "verified", employer_domain: "rival.com" }, { id: "c1", account_id: ACC_A });
  const res = await w.promise;
  assertEquals(res.decision, "rejected");
  assertEquals(w.rec.contactUpdates.length, 0);
});

// 5. new UNVERIFIED contact never gets account_id ------------------------------
Deno.test("5. new unverified contact: no account_id written anywhere", async () => {
  const w = write(UNVERIFIED, null);
  const res = await w.promise;
  assertEquals(res.accountIdWritten, null);
  assertEquals(w.rec.contactUpdates.length, 0);
  assert(!("account_id" in w.rec.upserts[0].row));
});

// 6. no silent reassignment: existing A + verified evidence for B --------------
Deno.test("6. existing A + strong verified evidence for B → reassignment_required, no write", async () => {
  const leadB = { id: "l1", workspace_id: WS, account_id: ACC_B };
  const accountB = { id: ACC_B, workspace_id: WS, name: "Brain Co.", domain: "brain.co", linkedin_url: null, raw: {} };
  const w = write({ verification_status: "verified" }, { id: "c1", account_id: ACC_A }, accountB, leadB);
  const res = await w.promise;
  assertEquals(res.decision, "reassignment_required");
  assertEquals(res.accountIdWritten, null);
  assertEquals(w.rec.contactUpdates.length, 0, "A→B is never written automatically");
});

// 7. same verified account refreshes (guarded update, preserves) ---------------
Deno.test("7. existing A + verified A → guarded update to A (idempotent, preserves)", async () => {
  const w = write({ verification_status: "verified" }, { id: "c1", account_id: ACC_A });
  const res = await w.promise;
  assertEquals(res.accountIdWritten, ACC_A);
  assertEquals(w.rec.contactUpdates[0].guard, `account_id.is.null,account_id.eq.${ACC_A}`);
});

// 8. lead_candidate is linked to the written contact ---------------------------
Deno.test("8. lead_candidate.contact_id links to the written contact", async () => {
  const w = write(VERIFIED);
  await w.promise;
  assertEquals(w.rec.leadLinks.length, 1);
  assertEquals(w.rec.leadLinks[0].row.contact_id, "new-contact-id");
});

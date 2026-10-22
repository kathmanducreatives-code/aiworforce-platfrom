# P8 manual browser acceptance — synthetic loopback only

No production route imports this harness. No real Supabase, provider, model key,
database, customer record or send path is used. The backend calls the actual P3,
P1 binding, P5, P4/P6, P7 modules with strict synthetic storage/Auth/model seams.
The seeded task is a test fixture: P3 does not persist/import/create a task.

From the repository root, use two terminals:

```sh
deno run --allow-read --allow-env --allow-net=127.0.0.1:8788 tests/pilot-browser/server.ts
node node_modules/vite/bin/vite.js --config tests/pilot-browser/vite.config.ts
```

Open **http://127.0.0.1:5178**. Do not bind publicly. No `.env` keys are needed;
the fixture only reads its synthetic environment map. Deno has no remote network
permission. Remote module dependencies must already be cached. Requests to the
test server need a fixed fixture header and loopback Host/Origin; these are test
controls, **not production authentication/session security**.

1. Client A: keep the supplied synthetic CSV. Click preview/prepare, expand import
   receipt, load review. Duplicate source rows collapse to one preview record.
   Confirm `PRIVATE_A_pipeline_support` and supplied negative quotation.
2. Expand source context: the original page includes the negative sentence and
   old facility announcement. No buying intent is declared verified.
3. Add an unverified note; save. Confirm revision increments and export disabled.
4. Acknowledge uncertainty, then approve exact version. Explicitly download CSV.
   Download twice; files must have identical bytes and only one export event.
5. Inspect execution receipt: one mocked model attempt, one settlement, one input
   load, three events (edit, approve, prepare), zero external requests.
6. Revoke synthetic membership, then try download again: export must refuse.
7. Switch to B: A's view, notes, approval, preview and receipt disappear. Prepare
   B with the same external IDs, load review; only `PRIVATE_B_pipeline_support`.
   Reject with a reason. Approve/export stay unavailable until a new edit/review.
8. Tamper CSV headers/ownership columns or submit a different file: refuse before
   snapshot/model. This fixture deliberately only accepts the supplied record;
   it does not pretend arbitrary input is captured from the frozen fixture.

Stop both servers when done. New fixture sessions deliberately retain separate
in-memory state until process stop; no durability/restart claim. Concurrent client
test coverage lives in `pilotP8Workflow.test.ts`; frontend delayed-response tests
remain in the P2/P3/P7 suites. The manual browser pass is not yet an automated
real-JWT/native-storage/browser matrix and does not enable customer use.

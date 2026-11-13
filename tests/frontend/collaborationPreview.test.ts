// The Phase 5 collaboration preview: fictional, labelled simulated, DEV-only, and in sync with the simulator.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const preview = JSON.parse(Deno.readTextFileSync(new URL("../../src/components/collaboration/everestPreview.json", import.meta.url)));
const app = Deno.readTextFileSync(new URL("../../src/App.tsx", import.meta.url));
const page = Deno.readTextFileSync(new URL("../../src/pages/dev/CollaborationPreview.tsx", import.meta.url));
const view = Deno.readTextFileSync(new URL("../../src/components/collaboration/CollaborationBoardView.tsx", import.meta.url));

Deno.test("preview data is flagged simulated + fictional and walks the lifecycle honestly", () => {
  assertEquals(preview.simulated, true); assertEquals(preview.fictional, true);
  assert(preview.customer.includes("(fictional)"));
  const statuses = preview.steps.map((s: { board: { items: Array<{ actions: Array<{ status: string }> }> } }) => s.board.items[0].actions.map((a) => a.status).join(","));
  assertEquals(statuses, ["not_proposed,not_proposed", "awaiting_review,awaiting_review", "approved,approved", "running,approved", "completed,completed"]);
  assert(preview.lyra_draft.status.includes("not published"));
  assert(preview.brain_proposal.status.startsWith("pending"));
  assertEquals(preview.atlas_request.guardrails.outreach, false);
  for (const u of preview.signal.sources) assert(/^https:\/\/[a-z0-9.-]+\.example\//.test(u), `fictional domain: ${u}`);
});

Deno.test("the preview is routed only in DEV and always shows the simulated banner", () => {
  assert(/const CollaborationPreview = import\.meta\.env\.DEV \?/.test(app));
  assert(/\{import\.meta\.env\.DEV && CollaborationPreview && \(/.test(app));
  assert(page.includes('data-testid="simulated-banner"'));
  assert(page.includes("not live customer intelligence"));
});

Deno.test("the board view executes nothing itself: decisions only through the host's onDecide", () => {
  assert(!/integrations\/supabase|fetch\(|functions\.invoke|\.rpc\(|\.from\(['"]/.test(view), "no data access in the view");
  assert(/^import type \{[^}]+\} from '..\/..\/..\/supabase\/functions\/_shared\/collab\/board';$/m.test(view), "shared code is imported as types only");
  assert(view.includes("onDecide"));
  assert(view.includes("!a.no_longer_recommended"), "no approve button on work the current Brain no longer supports");
});

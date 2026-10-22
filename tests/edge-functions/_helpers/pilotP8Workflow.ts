// Synthetic orchestration only. No task creation/import persistence is claimed.
import { reviewFixture } from "./pilotReviewFixture.ts";
import { CSV, MAPPING } from "./pilotSnapshotFixture.ts";
import { handlePilotImport } from "../../../supabase/functions/_shared/pilot/pilotImport.ts";
import { BriefReviewController } from "../../../src/lib/pilot/briefReviewController.ts";
import {
  inspectReview,
  reviewBrief,
} from "../../../supabase/functions/_shared/pilot/pilotReview.ts";
import { prepareReviewCsv } from "../../../supabase/functions/_shared/pilot/pilotExport.ts";

export async function p8Workflow(which: "A" | "B" = "A", csv = CSV) {
  let preview!: Record<string, unknown>;
  const x = await reviewFixture(which, "pilot_context_v2", async (f, scope) => {
    f.settings.OUTPOST_PILOT_CSV_PREVIEW_ENABLED = "true";
    f.settings.OUTPOST_PILOT_CONTEXT_ENABLED = "true";
    const response = await handlePilotImport(
      new Request("https://audit.invalid/import", {
        method: "POST",
        headers: {
          Authorization: `Bearer jwt-${which}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "preview",
          workspace_id: scope.workspace_id,
          client_binding_id: scope.client_binding_id,
          approved_existing_leads: true,
          csv,
          mapping: MAPPING,
        }),
      }),
      f.deps,
    );
    preview = await response.json();
    if (!response.ok) throw Error(String(preview.error));
    // This fixture has exactly one approved synthetic record; never pretend arbitrary
    // browser input was the captured source. Production preview->task persistence is absent.
    if (csv !== CSV) throw Error("offline_fixture_source_mismatch");
  });
  const service = {
    inspect: (s: typeof x.scope) => inspectReview(s, x.reviewDeps),
    review: (s: typeof x.scope, r: Record<string, unknown>) =>
      reviewBrief(s, r as Parameters<typeof reviewBrief>[1], x.reviewDeps),
    prepare: (s: Omit<typeof x.scope, "task_id">, r: Record<string, unknown>) =>
      prepareReviewCsv(
        s,
        r as unknown as Parameters<typeof prepareReviewCsv>[1],
        x.reviewDeps,
      ),
  };
  return {
    ...x,
    preview,
    service,
    controller: new BriefReviewController(x.scope, service),
  };
}

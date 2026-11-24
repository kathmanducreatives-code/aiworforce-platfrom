// WHICH LEADS BELONG TO A WORKBENCH PLAN.
//
// A lead belongs to the plan that CREATED it (`lead_candidates.plan_id`) — and, for the
// lead pipeline, also to the latest run that found it again: a company that is already a
// Lead is never duplicated, its row keeps its own plan_id, and the run's plan is recorded in
// the pipeline attribution (`raw.agentory_pipeline.plan_id`). Both are matched here.
//
// The id is interpolated into a PostgREST `or` filter, so only a UUID is accepted; anything
// else falls back to the plain column match. Workspace isolation is the table's RLS.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The PostgREST `or` filter for a plan's leads, or null when the id is not a UUID. */
export function leadPlanOrFilter(planId: string): string | null {
  const id = planId.trim();
  if (!UUID.test(id)) return null;
  return `plan_id.eq.${id},raw->agentory_pipeline->>plan_id.eq.${id}`;
}

// Direct Workbench lead-action request contract. Pure + dependency-free so it is
// unit-testable under Deno and shared by run-agent's routing gate.
//
// Two request modes reach run-agent:
//
//   A. ORCHESTRATED PLAN STEP — orchestrate threads a full plan step and calls
//      with the SERVICE_ROLE bearer. Requires plan_id + step_index + agent +
//      workspace_id + instruction. Unchanged by this module.
//
//   B. DIRECT LEAD ACTION — the Workbench invokes run-agent straight from the
//      browser for selected rows. It carries tool_input.lead_action and a user
//      JWT, and must NOT be forced to synthesise plan-step fields it has no
//      business inventing.
//
// Mode B is detected BEFORE the plan-step required-field gate so a direct action
// can never be rejected for missing orchestration metadata.

export type LeadActionKind =
  | "research_company" | "find_decision_makers" | "find_contact_details"
  | "generate_outreach";

export const LEAD_ACTION_KINDS: readonly LeadActionKind[] = [
  "research_company",
  "find_decision_makers",
  // Buying a way to REACH somebody is its own action, its own Actor and its own
  // price. It is deliberately not folded into `find_decision_makers`: that one
  // finds the person, and running an email lookup as a side effect of a search
  // would spend on everyone returned rather than on the one person a user chose.
  "find_contact_details",
  "generate_outreach",
] as const;

/** research/decision-maker → Hawk (Intelligence); outreach drafting → Penn. */
export const DIRECT_ACTION_AGENT: Record<LeadActionKind, string> = {
  research_company: "hawk",
  find_decision_makers: "hawk",
  generate_outreach: "penn",
};

/**
 * Instruction is derived INTERNALLY, never taken from the client. A direct action
 * is a fixed, structured operation on existing rows — free-text from the browser
 * would be an injection surface into the agent prompt for no benefit.
 */
export const DIRECT_ACTION_INSTRUCTION: Record<LeadActionKind, string> = {
  research_company: "Research company context for the selected lead(s).",
  find_decision_makers: "Find decision-makers for the selected lead(s).",
  generate_outreach: "Prepare an approval-ready outreach draft for the selected lead(s).",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function isLeadActionKind(value: unknown): value is LeadActionKind {
  return typeof value === "string" && (LEAD_ACTION_KINDS as readonly string[]).includes(value);
}

/**
 * True when the caller is attempting a direct lead action AT ALL — including an
 * unknown action name. Detecting the *attempt* (not just the valid kinds) is what
 * keeps a typo'd action from silently falling through to the plan-step gate and
 * being misreported as `missing_required_fields`, or worse, reaching Scout
 * sourcing and starting an unwanted provider search.
 */
export function isDirectLeadActionAttempt(toolInput: unknown): boolean {
  if (!toolInput || typeof toolInput !== "object") return false;
  return "lead_action" in (toolInput as Record<string, unknown>);
}

/**
 * Outreach output mode. EXPLICIT only — never inferred from component name,
 * request origin, UI text, missing fields or desired message length. An absent
 * mode resolves to the safest backward-compatible value (full_draft), so every
 * existing non-Workbench caller is unaffected.
 */
export type OutreachOutputMode = "personalized_opener" | "full_draft";

export const DEFAULT_OUTPUT_MODE: OutreachOutputMode = "full_draft";

export function resolveOutputMode(value: unknown): OutreachOutputMode {
  return value === "personalized_opener" ? "personalized_opener" : DEFAULT_OUTPUT_MODE;
}

export interface DirectLeadActionRequest {
  action: LeadActionKind;
  lead_candidate_ids: string[];
  agent_slug: string;
  instruction: string;
  /** Only meaningful for generate_outreach; ignored by the other actions. */
  output_mode: OutreachOutputMode;
}

export type DirectLeadActionValidation =
  | { ok: true; request: DirectLeadActionRequest }
  | { ok: false; status: number; error_code: string; message: string };

/**
 * Validate a direct-action request. Deliberately does NOT require plan_id,
 * step_index, or a client-supplied instruction — those belong to mode A only.
 */
export function validateDirectLeadActionRequest(body: {
  workspace_id?: unknown;
  tool_input?: unknown;
}): DirectLeadActionValidation {
  const toolInput = (body.tool_input ?? {}) as Record<string, unknown>;
  const action = toolInput.lead_action;

  if (!isLeadActionKind(action)) {
    return {
      ok: false,
      status: 400,
      error_code: "unsupported_lead_action",
      message: "That lead action isn't supported.",
    };
  }

  if (!isUuid(body.workspace_id)) {
    return {
      ok: false,
      status: 400,
      error_code: "invalid_workspace_id",
      message: "No active workspace — reload and try again.",
    };
  }

  const rawIds = toolInput.lead_candidate_ids;
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    return {
      ok: false,
      status: 400,
      error_code: "lead_action_requires_lead_candidate_ids",
      message: "Select one or more Workbench rows first.",
    };
  }

  // Reject the whole batch on a malformed id rather than silently dropping it —
  // a partially-applied action the caller didn't ask for is worse than a refusal.
  const ids = [...new Set(rawIds)];
  if (!ids.every(isUuid)) {
    return {
      ok: false,
      status: 400,
      error_code: "invalid_lead_candidate_id",
      message: "One or more selected rows are invalid — refresh the Workbench.",
    };
  }

  return {
    ok: true,
    request: {
      action,
      lead_candidate_ids: ids as string[],
      agent_slug: DIRECT_ACTION_AGENT[action],
      output_mode: resolveOutputMode(toolInput.output_mode),
      instruction: DIRECT_ACTION_INSTRUCTION[action],
    },
  };
}

/**
 * ROOT CAUSE of the production "0/4 succeeded" incident.
 *
 * `tasks.user_id` is NOT NULL with no default. orchestrate always threads an
 * explicit body.user_id, so mode A was fine — but the Workbench direct-action
 * body never carried one, so run-agent inserted `user_id: null`, the insert hit
 * the not-null constraint, and the function returned 500 task_insert_failed.
 * That produced zero tasks, zero tool_calls, zero activity rows and zero
 * provider runs, which the frontend flattened to "Edge Function returned a
 * non-2xx status code".
 *
 * The authenticated user is already resolved by the workspace guard; reuse it
 * instead of discarding it. Returns null only when there is genuinely no user
 * (service-role calls that also omitted user_id), so the caller can refuse
 * rather than attempt a doomed insert.
 *
 * ATTRIBUTION TRUST BOUNDARY
 *
 * `body.user_id` is caller-controlled. It may only be honoured when the request
 * arrives on the SERVICE_ROLE bearer — i.e. from orchestrate, which has already
 * gated the user and is acting on their behalf. A browser request carries a user
 * JWT, so its attribution must come from that verified token and nothing else;
 * otherwise any workspace member could file tasks, activity rows and approvals
 * under another person's id.
 *
 * `bearerIsServiceRole` MUST be derived by comparing the actual Authorization
 * bearer against the service-role key. Never pass a value taken from the request
 * body — a caller claiming to be a system caller is just a caller.
 */
export function resolveTaskUserId(args: {
  bearerIsServiceRole: boolean;
  bodyUserId?: unknown;
  authenticatedUserId?: string | null;
}): string | null {
  if (args.bearerIsServiceRole) {
    // System/orchestrated work: explicit attribution wins, falling back to any
    // user the bearer itself resolved to.
    if (isUuid(args.bodyUserId)) return args.bodyUserId;
    return isUuid(args.authenticatedUserId) ? args.authenticatedUserId : null;
  }

  // Browser request: the verified JWT user is the ONLY acceptable attribution.
  // body.user_id is ignored entirely rather than merely deprioritised.
  return isUuid(args.authenticatedUserId) ? args.authenticatedUserId : null;
}

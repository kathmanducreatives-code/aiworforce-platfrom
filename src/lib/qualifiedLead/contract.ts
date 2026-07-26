// THE QUALIFIED-LEAD CONTRACT, AS THE PRODUCT SURFACES SEE IT.
//
// The 2026-07-26 manual run rendered "5 results" for a request that asked for
// five CONTACT-ready leads, and showed SDR/BDR/AE for a Sales-Operations search.
// Both defects came from the same place: the card reconstructed the request from
// the generated workflow TITLE and its own input bag.
//
// Everything here reads the STRUCTURED contract Pilot emitted. Nothing is
// re-parsed from prose, and nothing is inferred from a title.
//
// Pure — no React, no network. Mirrors
// supabase/functions/_shared/qualifiedLeadRouting.ts (proved equal in tests).

export type CountEntity = 'contact_ready_lead' | 'account_opportunity' | 'account';
export type QuotaPolicy = 'contact_only' | 'account_only';
export type WorkflowKind = 'qualified_lead_sourcing' | 'account_opportunity_sourcing';

export interface QualifiedLeadContract {
  workflow_kind: 'qualified_lead_sourcing';
  execution_mode: 'company_first';
  target_entity: 'company_and_person';
  signal_type?: string;
  job_family: string | null;
  job_titles: string[];
  company_vertical: string | null;
  company_stage: string | null;
  geography: string[];
  requested_person_roles: string[];
  current_employer_required: boolean;
  requested_lead_count: number;
  count_entity: 'contact_ready_lead';
  quota_policy: 'contact_only';
  original_instruction?: string;
}

/** The confirmation payload Pilot sends. Only the fields the preview reads. */
export interface WorkflowConfirmationPayloadLike {
  workflow_id?: string;
  workflow_name?: string;
  workflow_kind?: string;
  execution_mode?: string;
  execution_mode_label?: string;
  original_instruction?: string;
  goal?: string;
  output?: string;
  inputs?: Record<string, unknown>;
  qualified_lead_contract?: QualifiedLeadContract | null;
  lead_intent?: Record<string, unknown>;
}

/** Present and internally consistent, or the surface falls back to legacy copy. */
export function isQualifiedLeadPayload(
  p: WorkflowConfirmationPayloadLike | null | undefined,
): p is WorkflowConfirmationPayloadLike & { qualified_lead_contract: QualifiedLeadContract } {
  const c = p?.qualified_lead_contract;
  return !!c
    && c.workflow_kind === 'qualified_lead_sourcing'
    && c.execution_mode === 'company_first'
    && c.count_entity === 'contact_ready_lead'
    && c.quota_policy === 'contact_only'
    && Array.isArray(c.job_titles)
    && Array.isArray(c.requested_person_roles);
}

// ------------------------------------------------------------ display labels --

const VERTICAL_LABEL: Record<string, string> = {
  b2b_saas: 'B2B SaaS',
  manufacturing: 'Manufacturing',
  cybersecurity: 'Cybersecurity',
  agency_services: 'Agencies / integrators',
  other: 'Target vertical',
};

/** Short form used inside the title ("SaaS startups"), not the constraint chip. */
const VERTICAL_TITLE_WORD: Record<string, string> = {
  b2b_saas: 'SaaS',
  manufacturing: 'manufacturing',
  cybersecurity: 'security',
  agency_services: 'agency',
};

const STAGE_LABEL: Record<string, string> = {
  startup_or_small_team: 'Startup / small team',
  growth_stage: 'Growth-stage',
  enterprise: 'Enterprise',
};

const STAGE_TITLE_WORD: Record<string, string> = {
  startup_or_small_team: 'startups',
  growth_stage: 'scale-ups',
  enterprise: 'enterprises',
};

/** "Founder" → "founders"; already-plural and irregular inputs are left alone. */
function pluralizeRole(role: string): string {
  const r = role.trim();
  if (!r) return r;
  if (/s$/i.test(r)) return r.toLowerCase();
  return `${r.toLowerCase()}s`;
}

export interface WorkflowPreview {
  title: string;
  /** "5 CONTACT-ready leads" — never "5 results" and never "5 accounts". */
  target: string;
  hiringRoles: string[];
  decisionMakers: string[];
  companyConstraints: string[];
  executionMode: string;
  output: string;
  /** Everything a caller needs to assert the count is not read as accounts. */
  countEntity: CountEntity;
  requestedLeadCount: number;
}

/**
 * Build the preview from the CONTRACT.
 *
 * The title is composed from contract fields — decision-maker role, vertical,
 * stage and the first canonical job title — so it cannot drift from what will
 * actually execute. `payload.workflow_name` is deliberately never consulted.
 */
export function buildWorkflowPreview(contract: QualifiedLeadContract): WorkflowPreview {
  const roleWord = contract.requested_person_roles.length
    ? pluralizeRole(contract.requested_person_roles[0])
    : 'decision-makers';
  const verticalWord = contract.company_vertical
    ? VERTICAL_TITLE_WORD[contract.company_vertical] ?? null
    : null;
  const stageWord = contract.company_stage
    ? STAGE_TITLE_WORD[contract.company_stage] ?? 'companies'
    : 'companies';
  const companyPhrase = verticalWord ? `${verticalWord} ${stageWord}` : stageWord;
  const primaryTitle = contract.job_titles[0] ?? 'target roles';

  const constraints: string[] = [];
  if (contract.company_vertical) constraints.push(VERTICAL_LABEL[contract.company_vertical] ?? contract.company_vertical);
  if (contract.company_stage) constraints.push(STAGE_LABEL[contract.company_stage] ?? contract.company_stage);
  for (const g of contract.geography) if (g) constraints.push(g);

  return {
    title: `Find ${roleWord} at ${companyPhrase} hiring ${primaryTitle}`,
    target: `${contract.requested_lead_count} CONTACT-ready ${contract.requested_lead_count === 1 ? 'lead' : 'leads'}`,
    hiringRoles: [...contract.job_titles],
    decisionMakers: [...contract.requested_person_roles],
    companyConstraints: constraints,
    executionMode: 'Company-first qualified lead sourcing',
    output: 'Qualified company + verified decision-maker leads in Workbench',
    countEntity: contract.count_entity,
    requestedLeadCount: contract.requested_lead_count,
  };
}

/**
 * Titles that must NEVER appear in a Sales-Operations preview. Quota-carrying
 * sales roles are a different discipline; showing them is the exact corruption
 * this whole route fix exists to prevent.
 */
export const FORBIDDEN_PREVIEW_TERMS = [
  'SDR', 'BDR', 'Account Executive', 'Founding SDR', 'Founding AE',
  'Fast mode', 'account opportunities',
] as const;

/** Every string a preview would render, for blast-radius assertions. */
export function previewStrings(p: WorkflowPreview): string[] {
  return [p.title, p.target, p.executionMode, p.output, ...p.hiringRoles, ...p.decisionMakers, ...p.companyConstraints];
}

// -------------------------------------------------------- Start Workflow -----

export interface StartWorkflowPayload {
  /** The ORIGINAL user request — authoritative over any generated title. */
  text: string;
  metadata: Record<string, unknown>;
}

/**
 * The exact body Start Workflow dispatches.
 *
 * `text` is the original instruction, NOT "Run workflow: <title>. Count: 5.".
 * That reconstruction is what let a qualified-lead request arrive at orchestrate
 * looking like an account scan with an unparseable count.
 */
export function buildStartWorkflowPayload(
  payload: WorkflowConfirmationPayloadLike,
  inputs: Record<string, unknown>,
): StartWorkflowPayload {
  const contract = isQualifiedLeadPayload(payload) ? payload.qualified_lead_contract : null;
  const original = payload.original_instruction ?? payload.goal ?? payload.workflow_name ?? '';

  const base: Record<string, unknown> = {
    confirmed: true,
    workflow_id: payload.workflow_id,
    workflow_inputs: inputs,
    original_instruction: original,
    lead_intent: payload.lead_intent,
    workflow_category: (payload.lead_intent as { workflow_type?: string } | undefined)?.workflow_type,
    source_type: (payload.lead_intent as { source_type?: string } | undefined)?.source_type,
  };

  if (!contract) {
    return {
      text: original,
      metadata: {
        ...base,
        workflow_kind: payload.workflow_kind ?? 'account_opportunity_sourcing',
        execution_mode: payload.execution_mode ?? 'fast',
        count_entity: (payload.inputs?.count_entity as CountEntity) ?? 'account',
      },
    };
  }

  return {
    text: original,
    metadata: {
      ...base,
      workflow_kind: contract.workflow_kind,
      execution_mode: contract.execution_mode,
      qualified_lead_contract: contract,
      requested_lead_count: contract.requested_lead_count,
      quota_policy: contract.quota_policy,
      count_entity: contract.count_entity,
      job_family: contract.job_family,
      job_titles: contract.job_titles,
      requested_person_roles: contract.requested_person_roles,
      // The company-first runtime needs the jobs actor, never a people search.
      selected_actor_key: 'apify_jobs',
    },
  };
}

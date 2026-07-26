// Continue sourcing → run-agent, resuming the SAME task from its checkpoint.
//
// The body carries `resume_task_id`, which run-agent uses instead of inserting a
// new task row. A refused continuation returns 409 with a reason and changes
// nothing, so the existing checkpoint stays intact and the user can retry.

import { supabase } from '@/integrations/supabase/client';
import type { CompanyFirstResponse } from './continuation.ts';
import type { QuotaBackendFields } from './quotaProgress.ts';
import type { ContinuationRequest } from './continuation.ts';

export type ContinuationResponse = CompanyFirstResponse & QuotaBackendFields;

export interface ContinueSourcingArgs {
  request: ContinuationRequest;
  workspaceId: string;
  planId?: string | null;
  agentSlug?: string;
  instruction: string;
}

export async function continueQualifiedLeadSourcing(args: ContinueSourcingArgs): Promise<ContinuationResponse> {
  const { data, error } = await supabase.functions.invoke('run-agent', {
    body: {
      // The continuation token IS the task id; run-agent verifies workspace
      // ownership and the presence of a checkpoint before reusing it.
      resume_task_id: args.request.task_id,
      continuation_token: args.request.continuation_token,
      workspace_id: args.workspaceId,
      plan_id: args.planId ?? null,
      agent_slug: args.agentSlug ?? 'scout',
      instruction: args.instruction,
      execution_mode: 'company_first',
      workflow_kind: 'qualified_lead_sourcing',
      quota_policy: 'contact_only',
      count_entity: 'contact_ready_lead',
    },
  });

  if (error) throw new Error(error.message ?? 'continuation_failed');
  const res = data as (ContinuationResponse & { error?: string; reason?: string; message?: string }) | null;
  if (!res) throw new Error('continuation_failed');
  if (res.error === 'continuation_refused') throw new Error(res.message ?? res.reason ?? 'continuation_refused');
  return res;
}

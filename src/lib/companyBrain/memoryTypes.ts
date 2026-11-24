// Company Brain memory — the row shapes the page reads (types only).
// Kept apart from memoryApi.ts so pure code and its Deno tests can use them
// without loading the browser Supabase client.
import type { MemoryItem } from '../../../supabase/functions/_shared/brainMemoryModel.ts';

export interface MemoryProposal {
  id: string;
  proposed_by_agent: string;
  kind: 'fact' | 'preference';
  category: string;
  fact_key: string;
  value_type: string;
  value: unknown;
  rationale: string;
  evidence: Array<{ source_url?: string; source_ref?: string; observed_at?: string; excerpt?: string }>;
  source_type: string;
  confidence: 'high' | 'medium' | 'low';
  status: string;
  contradicts_memory_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface MemoryHistoryRow {
  id: string;
  memory_id: string | null;
  proposal_id: string | null;
  change_kind: string;
  from_version: number | null;
  to_version: number | null;
  previous: Record<string, unknown> | null;
  current: Record<string, unknown> | null;
  actor_kind: string;
  actor_id: string | null;
  actor_agent: string | null;
  reason: string | null;
  created_at: string;
}

export interface RevisionRow {
  id: string;
  revision: number;
  changed_sections: string[];
  actor_kind: string;
  actor_id: string | null;
  written_at: string;
  redacted_at: string | null;
}

export interface MemorySnapshot {
  items: MemoryItem[];
  proposals: MemoryProposal[];
  history: MemoryHistoryRow[];
  revisions: RevisionRow[];
}

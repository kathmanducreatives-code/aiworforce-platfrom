// Company Brain V2 · B2.3 — read ORION's `memory_offer` from a chat message's metadata.
// Defensive: metadata is JSON from the database; anything malformed is ignored.
export interface ChatMemoryOffer {
  status: 'pending' | 'already_known' | 'temporary';
  summary: string;
  kind: 'fact' | 'preference' | 'decision' | null;
  proposal_id: string | null;
  conflict: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readMemoryOffer(metadata: unknown): ChatMemoryOffer | null {
  const m = metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>).memory_offer : null;
  if (!m || typeof m !== 'object') return null;
  const o = m as Record<string, unknown>;
  const status = o.status;
  if (status !== 'pending' && status !== 'already_known' && status !== 'temporary') return null;
  if (typeof o.summary !== 'string' || !o.summary.trim()) return null;
  const proposal_id = typeof o.proposal_id === 'string' && UUID.test(o.proposal_id) ? o.proposal_id : null;
  if (status === 'pending' && !proposal_id) return null;
  const kind = o.kind === 'fact' || o.kind === 'preference' || o.kind === 'decision' ? o.kind : null;
  return { status, summary: o.summary.trim(), kind, proposal_id, conflict: typeof o.conflict === 'string' ? o.conflict : null };
}

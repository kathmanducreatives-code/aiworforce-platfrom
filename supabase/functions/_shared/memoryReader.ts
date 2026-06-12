// Phase 2: Persistent Signal Memory — reader.
// Loads a compact, prompt-sized snapshot of recent GTM memory for a given
// conversation/workspace so Pilot's classifier and planner can act on
// follow-up messages like "draft outreach to the top 5".

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface ConversationMemory {
  lead_candidates: Array<{
    id: string;
    plan_id: string | null;
    lead_type: string | null;
    status: string | null;
    fit_score: number | null;
    priority: string | null;
    reason: string | null;
    account: { id: string; name: string; domain: string | null; stage: string | null; industry: string | null } | null;
    contact: { id: string; full_name: string | null; title: string | null; linkedin_url: string | null } | null;
  }>;
  accounts: Array<{ id: string; name: string; domain: string | null; stage: string | null; industry: string | null }>;
  contacts: Array<{ id: string; full_name: string | null; title: string | null; linkedin_url: string | null }>;
  outreach_drafts: Array<{ id: string; channel: string | null; subject: string | null; body_preview: string; status: string }>;
  saved_outputs: Array<{ id: string; type: string | null; title: string | null; body_preview: string }>;
  last_plan_id: string | null;
  has_any_memory: boolean;
}

const EMPTY: ConversationMemory = {
  lead_candidates: [],
  accounts: [],
  contacts: [],
  outreach_drafts: [],
  saved_outputs: [],
  last_plan_id: null,
  has_any_memory: false,
};

export async function loadConversationMemory(args: {
  admin: SupabaseClient;
  workspace_id: string;
  conversation_id?: string | null;
  limit?: number;
}): Promise<ConversationMemory> {
  const { admin, workspace_id, conversation_id } = args;
  if (!workspace_id) return EMPTY;

  try {
    // 1) lead_candidates for this conversation (fallback to workspace recent if none)
    let lcQuery = admin
      .from("lead_candidates")
      .select("id, plan_id, lead_type, status, fit_score, priority, reason, account_id, contact_id, accounts(id,name,domain,stage,industry), contacts(id,full_name,title,linkedin_url)")
      .eq("workspace_id", workspace_id)
      .order("fit_score", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(args.limit ?? 50);
    if (conversation_id) lcQuery = lcQuery.eq("conversation_id", conversation_id);
    const { data: lcRows } = await lcQuery;

    const lead_candidates = (lcRows ?? []).map((r: any) => ({
      id: r.id,
      plan_id: r.plan_id ?? null,
      lead_type: r.lead_type ?? null,
      status: r.status ?? null,
      fit_score: r.fit_score ?? null,
      priority: r.priority ?? null,
      reason: r.reason ?? null,
      account: r.accounts
        ? { id: r.accounts.id, name: r.accounts.name, domain: r.accounts.domain ?? null, stage: r.accounts.stage ?? null, industry: r.accounts.industry ?? null }
        : null,
      contact: r.contacts
        ? { id: r.contacts.id, full_name: r.contacts.full_name ?? null, title: r.contacts.title ?? null, linkedin_url: r.contacts.linkedin_url ?? null }
        : null,
    }));

    const last_plan_id = lead_candidates.find((l) => !!l.plan_id)?.plan_id ?? null;

    // 2) accounts/contacts from last plan
    const [accountsRes, contactsRes] = await Promise.all([
      last_plan_id
        ? admin
            .from("accounts")
            .select("id, name, domain, stage, industry")
            .eq("workspace_id", workspace_id)
            .in("id", lead_candidates.map((l) => l.account?.id).filter(Boolean) as string[])
            .limit(20)
        : Promise.resolve({ data: [] as any[] }),
      last_plan_id
        ? admin
            .from("contacts")
            .select("id, full_name, title, linkedin_url")
            .eq("workspace_id", workspace_id)
            .in("id", lead_candidates.map((l) => l.contact?.id).filter(Boolean) as string[])
            .limit(20)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    // 3) outreach_drafts (recent)
    const { data: drafts } = await admin
      .from("outreach_drafts")
      .select("id, channel, subject, body, status, created_at")
      .eq("workspace_id", workspace_id)
      .order("created_at", { ascending: false })
      .limit(10);

    // 4) saved_outputs (recent, this conversation if available)
    let soQuery = admin
      .from("saved_outputs")
      .select("id, type, title, body, created_at")
      .eq("workspace_id", workspace_id)
      .order("created_at", { ascending: false })
      .limit(5);
    if (conversation_id) soQuery = soQuery.eq("conversation_id", conversation_id);
    const { data: outs } = await soQuery;

    const memory: ConversationMemory = {
      lead_candidates,
      accounts: (accountsRes.data ?? []) as any,
      contacts: (contactsRes.data ?? []) as any,
      outreach_drafts: (drafts ?? []).map((d: any) => ({
        id: d.id,
        channel: d.channel ?? null,
        subject: d.subject ?? null,
        body_preview: (d.body ?? "").toString().slice(0, 240),
        status: d.status ?? "draft",
      })),
      saved_outputs: (outs ?? []).map((o: any) => ({
        id: o.id,
        type: o.type ?? null,
        title: o.title ?? null,
        body_preview: (o.body ?? "").toString().slice(0, 280),
      })),
      last_plan_id,
      // has_any_memory drives the no-memory outreach guard, so it must reflect
      // ONLY conversation-scoped memory. lead_candidates and saved_outputs are
      // filtered by conversation_id (when provided); outreach_drafts has no
      // conversation_id column and is loaded workspace-wide, so it must NOT
      // decide fresh-vs-not — otherwise any prior draft anywhere in the
      // workspace makes every fresh conversation look like it has memory.
      has_any_memory:
        lead_candidates.length > 0 ||
        (outs?.length ?? 0) > 0,
    };

    return capSize(memory, 6 * 1024);
  } catch (e) {
    console.warn("[memoryReader] load failed:", e);
    return EMPTY;
  }
}

function capSize(m: ConversationMemory, maxBytes: number): ConversationMemory {
  let bytes = JSON.stringify(m).length;
  while (bytes > maxBytes && m.lead_candidates.length > 5) {
    m.lead_candidates.pop();
    bytes = JSON.stringify(m).length;
  }
  while (bytes > maxBytes && m.saved_outputs.length > 0) {
    m.saved_outputs.pop();
    bytes = JSON.stringify(m).length;
  }
  while (bytes > maxBytes && m.outreach_drafts.length > 0) {
    m.outreach_drafts.pop();
    bytes = JSON.stringify(m).length;
  }
  return m;
}

export function renderMemoryForPrompt(m: ConversationMemory): string {
  if (!m.has_any_memory) {
    return `<conversation_memory>\n(empty — no prior signals, leads, or drafts in this conversation.)\n</conversation_memory>`;
  }
  return `<conversation_memory>\n${JSON.stringify(m, null, 2)}\n</conversation_memory>`;
}

// Follow-up heuristic: should we route the user message against memory rather
// than starting a new sourcing/url workflow?
const FOLLOWUP_RE =
  /\b(top \d+|the (?:top|best|previous|prior|last|results?|leads?|companies|people|profiles?|ones?)|these (?:leads?|companies|people|results?)|only keep|filter|narrow|just keep|enrich (?:the )?(?:top|these|those|them)|draft outreach|write outreach|reach out|use the previous|save (?:this|these|that) lead|show me the (?:best|top))\b/i;

export function isFollowUpReference(message: string): boolean {
  return FOLLOWUP_RE.test(message);
}

export function extractTopN(message: string, fallback = 5): number {
  const m = message.match(/top\s+(\d+)/i);
  if (m) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n > 0 && n <= 50) return n;
  }
  return fallback;
}

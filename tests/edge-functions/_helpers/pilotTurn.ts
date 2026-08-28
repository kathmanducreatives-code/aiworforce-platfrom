// ONE TURN, THROUGH THE REAL HANDLER.
//
// The env is set before the module is imported so `Deno.serve` never starts
// and `createClient` points at the host the fake intercepts.

for (
  const [k, v] of Object.entries({
    PILOT_CHAT_IMPORT_ONLY: "1",
    SUPABASE_URL: "https://fake.supabase.test",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    OPENAI_API_KEY: "test-key",
    // The surfaces route through the Lovable gateway; without a key
    // `generateText` refuses before it reaches the network and every
    // conversational answer degrades to CONVERSE_UNAVAILABLE.
    LOVABLE_API_KEY: "test-gateway-key",
  })
) Deno.env.set(k, v);

export const SUPABASE_URL = "https://fake.supabase.test";
export const WORKSPACE = "11111111-1111-4111-8111-111111111111";
export const CONVERSATION = "22222222-2222-4222-8222-222222222222";

const { handlePilotChat } = await import(
  "../../../supabase/functions/pilot-chat/index.ts");

export interface TurnResult {
  status: number;
  body: Record<string, unknown>;
  /** The assistant message row the handler persisted for this turn. */
  reply: Record<string, unknown> | null;
  content: string;
  metadata: Record<string, unknown>;
}

export async function sendTurn(
  message: string, tables: Record<string, Array<Record<string, unknown>>>,
  /**
   * What the Start button sends: `action_source` and `metadata.confirmed`,
   * plus the mission the card carried. Omitted for an ordinary typed message.
   */
  action?: { action_source: string; metadata: Record<string, unknown> },
): Promise<TurnResult> {
  const before = (tables.messages ?? []).length;
  const res = await handlePilotChat(
    new Request(`${SUPABASE_URL}/functions/v1/pilot-chat`, {
      method: "POST",
      headers: { Authorization: "Bearer test-jwt", "content-type": "application/json" },
      body: JSON.stringify({
        message, workspace_id: WORKSPACE, conversation_id: CONVERSATION,
        ...(action
          ? { action_source: action.action_source, metadata: action.metadata }
          : {}),
      }),
    }),
    {},
  );
  const body = await res.json();
  // THE ROW THE HANDLER WROTE, not the one it returned. A turn that answers in
  // the response but never persists the message is the frontend bug this whole
  // audit started from, and reading the response would hide it.
  const written = (tables.messages ?? []).slice(before)
    .filter((m) => m.role === "assistant");
  const reply = written.length > 0 ? written[written.length - 1] : null;
  return {
    status: res.status,
    body,
    reply,
    content: String(reply?.content ?? ""),
    metadata: (reply?.metadata ?? {}) as Record<string, unknown>,
  };
}

/** A RequestV1 as the model returns it, with every schema key present. */
export function modelRequest(parts: Array<{
  objective: string;
  entity: string;
  references?: Array<{ kind: string; value: string; cardinality?: "one" | "all" }>;
  shape?: string;
  count?: number | null;
  completeness?: "sample" | "all";
  requirements?: Array<Record<string, unknown>>;
}>, confidence = 0.99) {
  return {
    parts: parts.map((p, i) => ({
      id: `part${i + 1}`,
      objective: p.objective,
      subject: {
        entity: p.entity,
        references: (p.references ?? []).map((r) => ({
          kind: r.kind, value: r.value, cardinality: r.cardinality ?? "one",
        })),
        filters: [],
      },
      requirements: (p.requirements ?? []).map((q) => ({
        event: q.event ?? "hiring",
        subject: q.subject ?? "company",
        phrase: q.phrase ?? "",
        recency_days: q.recency_days ?? null,
        qualifier: {
          role_terms: [], role_families: [], topic: null, region: null,
          round_type: null, direction: null,
          ...(q.qualifier as Record<string, unknown> ?? {}),
        },
      })),
      output: {
        shape: p.shape ?? "records",
        count: p.count ?? null,
        completeness: p.completeness ?? "sample",
      },
      depends_on: [],
    })),
    ambiguity: [],
    confidence,
  };
}

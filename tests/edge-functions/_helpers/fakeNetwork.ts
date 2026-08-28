// A NETWORK, SO THE HANDLER ITSELF CAN RUN.
//
// ── WHY THIS AND NOT MORE MOCKS ────────────────────────────────────────────
//
// Every defect that reached production lived INSIDE `handlePilotChat`: a
// `const` declared below the block that closed over it, a confirmation gate
// deleted from a route, a held-evidence check guarded on a condition that
// could never be true, and a `conversation` argument the type checker was
// perfectly happy to see omitted. Mocking the resolver, the router or the read
// surface would remove exactly the seams those defects lived in.
//
// So nothing inside the function is replaced. `fetch` is — supabase-js and the
// model provider both go through it — and everything above it executes for
// real: understanding, referent resolution, routing, the read plan, the query
// shaping, the renderer, the outcome and the persisted metadata.
//
// The row shapes are the ones production returned; they were copied from the
// live tables while auditing conversation 2beba9cc.

export interface Row extends Record<string, unknown> { id?: string }

/** Tables the fake serves. Anything else is a loud failure, never an empty list. */
export type Tables = Record<string, Row[]>;

export interface ModelReply {
  /** Matched against the user message the handler was called with. */
  when: (utterance: string, systemPrompt: string) => boolean;
  /** The JSON body the model returns, as an object. */
  content: unknown;
}

export interface FakeNet {
  tables: Tables;
  /** Every edge function this handler invoked, with the body it sent. */
  functionCalls: Array<{ fn: string; body: unknown }>;
  /** Every model call made, in order, with the prompt it was given. */
  modelCalls: Array<{ system: string; user: string; reply: unknown }>;
  /** Every PostgREST path requested, in order. */
  requests: string[];
  restore: () => void;
}

let seq = 0;
const uuid = () => {
  seq += 1;
  return `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
};

/** `col=op.value` → a predicate. Only the operators this handler uses. */
function matches(row: Row, key: string, raw: string): boolean {
  const [op, ...rest] = raw.split(".");
  const value = rest.join(".");
  const actual = row[key];
  switch (op) {
    case "eq": return String(actual) === value;
    case "neq": return String(actual) !== value;
    case "is": return value === "null" ? actual == null : String(actual) === value;
    case "in": {
      const list = value.replace(/^\(|\)$/g, "").split(",")
        .map((v) => v.replace(/^"|"$/g, ""));
      return list.includes(String(actual));
    }
    case "gte": return String(actual) >= value;
    case "lte": return String(actual) <= value;
    default: throw new Error(`fakeNetwork: unsupported operator ${op}`);
  }
}

function applyQuery(rows: Row[], url: URL): { rows: Row[]; total: number } {
  let out = rows.slice();
  for (const [key, raw] of url.searchParams) {
    if (["select", "order", "limit", "offset", "on_conflict"].includes(key)) continue;
    out = out.filter((r) => matches(r, key, raw));
  }
  const total = out.length;
  const order = url.searchParams.get("order");
  if (order) {
    const [col, dir] = order.split(".");
    out.sort((a, b) => {
      const av = String(a[col] ?? ""), bv = String(b[col] ?? "");
      return dir === "desc" ? bv.localeCompare(av) : av.localeCompare(bv);
    });
  }
  const limit = url.searchParams.get("limit");
  if (limit) out = out.slice(0, Number(limit));
  return { rows: out, total };
}

/**
 * Install the fake. Returns the store so a test can assert on what was written.
 *
 * `SUPABASE_URL` must already point at the host this intercepts.
 */
export function installFakeNetwork(opts: {
  supabaseUrl: string;
  tables: Tables;
  modelReplies: ModelReply[];
  userId?: string;
  /**
   * Canned responses for edge functions this handler may invoke, by name.
   *
   * Absent means "this turn must not delegate", which is what almost every
   * conversational test asserts.
   */
  functionReplies?: Record<string, unknown>;
}): FakeNet {
  const real = globalThis.fetch;
  const state: FakeNet = {
    tables: opts.tables,
    functionCalls: [],
    modelCalls: [],
    requests: [],
    restore: () => { globalThis.fetch = real; },
  };

  const ok = (body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json", ...headers },
    });

  /**
   * PostgREST returns a single OBJECT when the caller asked for one.
   *
   * supabase-js sets `Accept: application/vnd.pgrst.object+json` for `.single()`
   * and `.maybeSingle()`. Returning an array regardless made `.single()` yield
   * the array itself, so `insertedUserMessage?.id` was undefined and the
   * handler's exclusion of the current turn from its own history silently did
   * nothing — a fake that was wrong in exactly the direction that hides a bug.
   */
  const wantsObject = (init?: RequestInit, input?: string | URL | Request) => {
    const h = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined));
    return (h.get("accept") ?? "").includes("vnd.pgrst.object");
  };

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const href = typeof input === "string"
      ? input
      : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET"))
      .toUpperCase();
    const rawBody = init?.body ?? (input instanceof Request ? null : null);

    // ── THE MODEL ────────────────────────────────────────────────────────
    // Every model host this handler can reach: OpenAI for understanding, the
    // Lovable gateway and Anthropic for the surfaces. A host not listed here
    // throws rather than returning a plausible empty answer.
    if (href.includes("openai.com") || href.includes("openrouter.ai")
        || href.includes("ai.gateway.lovable.dev") || href.includes("api.anthropic.com")) {
      const payload = JSON.parse(String(rawBody ?? "{}"));
      const msgs = (payload.messages ?? []) as Array<{ role: string; content: string }>;
      const system = msgs.find((m) => m.role === "system")?.content ?? "";
      const user = msgs.filter((m) => m.role === "user").map((m) => m.content).join("\n");
      const reply = opts.modelReplies.find((r) => r.when(user, system));
      if (!reply) {
        throw new Error(
          `fakeNetwork: no model reply matched.\n--- USER ---\n${user.slice(0, 900)}`);
      }
      state.modelCalls.push({ system, user, reply: reply.content });
      const content = typeof reply.content === "string"
        ? reply.content : JSON.stringify(reply.content);
      return ok({
        choices: [{ message: { content }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        model: payload.model ?? "test",
      });
    }

    if (!href.startsWith(opts.supabaseUrl)) {
      throw new Error(`fakeNetwork: unexpected host ${href}`);
    }

    const url = new URL(href);

    // ── AUTH ─────────────────────────────────────────────────────────────
    if (url.pathname.startsWith("/auth/v1/user")) {
      return ok({ id: opts.userId ?? "user-1", aud: "authenticated" });
    }

    // ── EDGE FUNCTIONS ───────────────────────────────────────────────────
    //
    // A DELEGATION IS A TEST FAILURE UNLESS THE TEST ASKED FOR ONE. Every
    // conversational turn under audit must answer without starting work — so
    // the default still throws, and a test that is exercising Start opts in
    // and gets the request body to assert on.
    if (url.pathname.startsWith("/functions/v1/")) {
      const fn = url.pathname.replace("/functions/v1/", "");
      const reply = opts.functionReplies?.[fn];
      if (!reply) {
        throw new Error(`fakeNetwork: handler called ${url.pathname} — this turn delegated`);
      }
      const body = rawBody ? JSON.parse(String(rawBody)) : null;
      state.functionCalls.push({ fn, body });
      return ok(reply);
    }

    // ── POSTGREST ────────────────────────────────────────────────────────
    const m = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/);
    if (!m) throw new Error(`fakeNetwork: unroutable ${url.pathname}`);
    const table = m[1];
    state.requests.push(`${method} ${table}${url.search}`);
    if (!(table in state.tables)) {
      throw new Error(
        `fakeNetwork: table "${table}" not seeded — an unseeded table must fail, not read as empty`);
    }
    const rows = state.tables[table];

    if (method === "POST") {
      const parsed = JSON.parse(String(rawBody ?? "[]"));
      const incoming = (Array.isArray(parsed) ? parsed : [parsed]) as Row[];
      const created = incoming.map((r) => ({
        id: r.id ?? uuid(),
        created_at: r.created_at ?? new Date(Date.now() + rows.length).toISOString(),
        ...r,
      }));
      rows.push(...created);
      return ok(wantsObject(init, input) ? created[0] ?? null : created);
    }

    if (method === "PATCH") {
      const patch = JSON.parse(String(rawBody ?? "{}")) as Row;
      const { rows: hit } = applyQuery(rows, url);
      for (const r of hit) Object.assign(r, patch);
      return ok(wantsObject(init, input) ? hit[0] ?? null : hit);
    }

    const { rows: got, total } = applyQuery(rows, url);
    // `count: "exact"` arrives as a Prefer header and is answered in
    // content-range, exactly as PostgREST does.
    if (wantsObject(init, input)) {
      return ok(got[0] ?? null,
        { "content-range": `0-${Math.max(0, got.length - 1)}/${total}` });
    }
    return ok(got, { "content-range": `0-${Math.max(0, got.length - 1)}/${total}` });
  }) as typeof fetch;

  return state;
}

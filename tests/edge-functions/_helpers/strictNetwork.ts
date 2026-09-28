// A STRICT NETWORK FOR SECURITY TESTS.
//
// Unlike fakeNetwork.ts (which answers every token as a signed-in user, fine for
// conversation tests), this fake is built to catch authorization defects:
//
//   * Auth answers ONLY for tokens the test issued; anything else is 401.
//   * PostgREST honours every filter the handler sends (eq, neq, like, gte, lte,
//     in, is) — an unscoped query returns other workspaces' rows, so a missing
//     `.eq("workspace_id", …)` shows up as a leak instead of passing silently.
//   * RPCs are answered by functions the test supplies.
//   * Every external host is recorded, so "no provider was called" is assertable.
//   * Every request is logged in order: "no privileged step before authorization".

export type Row = Record<string, unknown>;

export interface StrictNet {
  fetch: typeof fetch;
  tables: Record<string, Row[]>;
  log: string[];
  external: Array<{ host: string; path: string; body: unknown; auth: string | null }>;
  rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>;
  env: (k: string) => string | undefined;
}

export const TEST_SUPABASE_URL = "https://proj.supabase.co";
export const TEST_ANON = "anon-public-key";
export const TEST_SERVICE = "service-role-secret";

function matches(row: Row, key: string, raw: string): boolean {
  const dot = raw.indexOf(".");
  const op = raw.slice(0, dot), value = raw.slice(dot + 1);
  const actual = row[key];
  switch (op) {
    case "eq": return String(actual) === value;
    case "neq": return String(actual) !== value;
    case "gte": return String(actual ?? "") >= value;
    case "lte": return String(actual ?? "") <= value;
    case "gt": return String(actual ?? "") > value;
    case "lt": return String(actual ?? "") < value;
    case "is": return value === "null" ? actual == null : String(actual) === value;
    case "in": return value.replace(/^\(|\)$/g, "").split(",").map((v) => v.replace(/^"|"$/g, "")).includes(String(actual));
    case "like": case "ilike": {
      const re = new RegExp("^" + value.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/[%*]/g, ".*") + "$", op === "ilike" ? "i" : "");
      return re.test(String(actual ?? ""));
    }
    default: throw new Error(`strictNetwork: unsupported operator ${op}`);
  }
}

export function installStrictNetwork(opts: {
  tables: Record<string, Row[]>;
  /** bearer token → user id */
  users: Record<string, string>;
  rpc?: Record<string, (args: Record<string, unknown>, net: StrictNet) => unknown>;
  /** external host → responder */
  externals?: Record<string, (path: string, body: unknown) => { status?: number; body: unknown }>;
  env?: Record<string, string>;
}): StrictNet {
  const net: StrictNet = {
    tables: opts.tables, log: [], external: [], rpcCalls: [],
    env: (k) => ({ SUPABASE_URL: TEST_SUPABASE_URL, SUPABASE_ANON_KEY: TEST_ANON, SUPABASE_SERVICE_ROLE_KEY: TEST_SERVICE, ...(opts.env ?? {}) })[k],
    fetch: null as unknown as typeof fetch,
  };
  const respond = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

  net.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    const u = new URL(req.url);
    const method = req.method.toUpperCase();
    const text = init?.body != null ? String(init.body instanceof URLSearchParams ? init.body.toString() : init.body)
      : (method === "GET" || method === "HEAD" ? "" : await req.text());
    const parse = () => { try { return JSON.parse(text || "null"); } catch { return text; } };

    if (!req.url.startsWith(TEST_SUPABASE_URL)) {
      const responder = opts.externals?.[u.host];
      net.external.push({ host: u.host, path: u.pathname, body: parse(), auth: req.headers.get("authorization") });
      net.log.push(`EXTERNAL ${u.host}${u.pathname}`);
      if (!responder) throw new Error(`strictNetwork: unexpected external host ${u.host}`);
      const r = responder(u.pathname, parse());
      return respond(r.body, r.status ?? 200);
    }
    net.log.push(`${method} ${u.pathname}`);

    if (u.pathname === "/auth/v1/user") {
      const tok = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
      const id = opts.users[tok];
      return id ? respond({ id, aud: "authenticated" }) : respond({ message: "invalid JWT" }, 401);
    }
    const rpc = u.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
    if (rpc) {
      const args = (parse() ?? {}) as Record<string, unknown>;
      net.rpcCalls.push({ fn: rpc[1], args });
      const h = opts.rpc?.[rpc[1]];
      if (!h) throw new Error(`strictNetwork: rpc ${rpc[1]} not provided`);
      return respond(h(args, net));
    }
    const m = u.pathname.match(/^\/rest\/v1\/([a-z_]+)$/);
    if (!m) throw new Error(`strictNetwork: unroutable ${u.pathname}`);
    const table = m[1];
    if (!(table in net.tables)) throw new Error(`strictNetwork: table "${table}" not seeded`);
    const rows = net.tables[table];
    const filtered = rows.filter((r) => [...u.searchParams].every(([k, v]) =>
      ["select", "limit", "order", "offset", "on_conflict", "columns"].includes(k) || matches(r, k, v)));
    const limit = Number(u.searchParams.get("limit") ?? "") || undefined;
    const one = (req.headers.get("accept") ?? "").includes("vnd.pgrst.object");
    const range = (n: number) => ({ "content-range": n ? `0-${n - 1}/${n}` : `*/0` });

    if (method === "HEAD") return new Response(null, { status: 200, headers: range(filtered.length) });
    if (method === "GET") {
      const out = limit ? filtered.slice(0, limit) : filtered;
      return respond(one ? (out[0] ?? null) : out, 200, range(filtered.length));
    }
    if (method === "PATCH") {
      const patch = parse() as Row;
      for (const r of filtered) Object.assign(r, patch);
      return respond(one ? (filtered[0] ?? null) : filtered);
    }
    if (method === "POST") {
      const incoming = parse();
      const list = (Array.isArray(incoming) ? incoming : [incoming]) as Row[];
      const created = list.map((r) => ({ id: r.id ?? crypto.randomUUID(), created_at: new Date().toISOString(), ...r }));
      rows.push(...created);
      return respond(one ? created[0] : created, 201);
    }
    if (method === "DELETE") {
      for (const r of filtered) rows.splice(rows.indexOf(r), 1);
      return respond(filtered);
    }
    throw new Error(`strictNetwork: unsupported ${method}`);
  }) as typeof fetch;
  return net;
}

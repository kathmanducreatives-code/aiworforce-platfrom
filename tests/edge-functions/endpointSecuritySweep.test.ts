// SERVICE-ROLE ENDPOINT SWEEP — every endpoint the sweep changed, attacked and used.
//
// Real handlers, real supabase-js, the strict network. Each block shows the
// attack the old code allowed is now refused BEFORE any privileged read, write
// or paid call, and that the legitimate use still works.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { installStrictNetwork, TEST_ANON, TEST_SERVICE, TEST_SUPABASE_URL as SB } from "./_helpers/strictNetwork.ts";

for (const f of ["JOB_FEED", "SEND_SCHEDULED_EMAILS", "EMAIL_TRACKING", "GOOGLE_CALENDAR_AUTH", "TOOL_AVAILABILITY", "FIRECRAWL_SCRAPE"]) {
  Deno.env.set(`${f}_IMPORT_ONLY`, "1");
}
const { handleJobFeed } = await import("../../supabase/functions/job-feed/index.ts");
const { handleSendScheduledEmails } = await import("../../supabase/functions/send-scheduled-emails/index.ts");
const { handleEmailTracking, isRedirectAllowed } = await import("../../supabase/functions/email-tracking/index.ts");
const { handleGoogleCalendarAuth } = await import("../../supabase/functions/google-calendar-auth/index.ts");
const { handleToolAvailability } = await import("../../supabase/functions/tool-availability/index.ts");
const {
  handleFirecrawlScrape, BROWSER_SCRAPE_DAILY_LIMIT_WORKSPACE, BROWSER_SCRAPE_DAILY_LIMIT_USER, BROWSER_SCRAPE_TAG,
} = await import("../../supabase/functions/firecrawl-scrape/index.ts");

const USER_A = "11111111-0000-4000-8000-000000000001";
const USER_B = "22222222-0000-4000-8000-000000000002";
const WS_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const WS_B = "bbbbbbbb-0000-4000-8000-00000000000b";
const USERS = { "jwt-a": USER_A, "jwt-b": USER_B };

const post = (path: string, body: unknown, token?: string) => new Request(`${SB}/functions/v1/${path}`, {
  method: "POST",
  headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});

// ── job-feed: retired ─────────────────────────────────────────────────────────

Deno.test("job-feed is retired: 410 for everyone, and it reads nothing", () => {
  const r = handleJobFeed(new Request(`${SB}/functions/v1/job-feed?user=${USER_A}&format=json`));
  assertEquals(r.status, 410);
});

// ── send-scheduled-emails: only the caller's own mail ─────────────────────────

function mailWorld() {
  const past = new Date(Date.now() - 60_000).toISOString();
  return installStrictNetwork({
    users: USERS,
    tables: {
      scheduled_emails: [
        { id: "e1000000-0000-4000-8000-000000000001", user_id: USER_A, status: "pending", send_time_utc: past, candidate_email: "a1@x.test", content: "hi" },
        { id: "e2000000-0000-4000-8000-000000000002", user_id: USER_B, status: "pending", send_time_utc: past, candidate_email: "b1@x.test", content: "hi" },
      ],
    },
    externals: { "api.resend.com": () => ({ body: { id: "re_1" } }) },
    env: { RESEND_API_KEY: "re_key" },
  });
}

Deno.test("send-scheduled-emails: anonymous, the anon key and the service key are 401 — nothing read, nothing sent", async () => {
  for (const tok of [undefined, TEST_ANON, TEST_SERVICE, "forged"]) {
    const n = mailWorld();
    const r = await handleSendScheduledEmails(post("send-scheduled-emails", {}, tok), { env: n.env, fetch: n.fetch });
    assertEquals(r.status, 401, String(tok));
    assertEquals(n.external, []);
    assert(n.log.every((l) => l === "GET /auth/v1/user"), n.log.join(","));
  }
});

Deno.test("send-scheduled-emails: user A sends only A's email; B's stays pending and is never sent", async () => {
  const n = mailWorld();
  const r = await handleSendScheduledEmails(post("send-scheduled-emails", {}, "jwt-a"), { env: n.env, fetch: n.fetch });
  assertEquals(r.status, 200);
  assertEquals((await r.json()).sent, 1);
  assertEquals(n.external.map((e) => (e.body as { to: string[] }).to[0]), ["a1@x.test"]);
  assertEquals(n.tables.scheduled_emails.map((e) => e.status), ["sent", "pending"]);
});

// ── email-tracking: verified beacon, no open redirect ─────────────────────────

function trackWorld() {
  return installStrictNetwork({
    users: {},
    tables: {
      scheduled_emails: [{ id: "e1000000-0000-4000-8000-000000000001", content: 'Read <a href="https://agentory.example/post">this</a>' }],
      email_tracking: [],
    },
  });
}
const track = (qs: string) => new Request(`${SB}/functions/v1/email-tracking?${qs}`);
const EMAIL = "e1000000-0000-4000-8000-000000000001";

Deno.test("email-tracking: a click to a URL that is not in the email is refused — no redirect, no row", async () => {
  const n = trackWorld();
  const r = await handleEmailTracking(track(`type=click&id=${EMAIL}&url=${encodeURIComponent("https://evil.example/phish")}`), { env: n.env, fetch: n.fetch });
  assertEquals(r.status, 400);
  assertEquals(r.headers.get("location"), null);
  assertEquals(n.tables.email_tracking, []);
});

Deno.test("email-tracking: a link that IS in the email redirects and is recorded once", async () => {
  const n = trackWorld();
  const r = await handleEmailTracking(track(`type=click&id=${EMAIL}&url=${encodeURIComponent("https://agentory.example/post")}`), { env: n.env, fetch: n.fetch });
  assertEquals(r.status, 302);
  assertEquals(r.headers.get("location"), "https://agentory.example/post");
  assertEquals(n.tables.email_tracking.length, 1);
});

Deno.test("email-tracking: unknown or malformed ids record nothing; opens still get the pixel", async () => {
  const n = trackWorld();
  const a = await handleEmailTracking(track(`type=open&id=not-a-uuid`), { env: n.env, fetch: n.fetch });
  const b = await handleEmailTracking(track(`type=open&id=0f0f0f0f-0000-4000-8000-000000000000`), { env: n.env, fetch: n.fetch });
  assertEquals([a.status, a.headers.get("content-type"), b.status], [200, "image/gif", 200]);
  assertEquals(n.tables.email_tracking, []);
  assertFalse(isRedirectAllowed("javascript:alert(1)", "javascript:alert(1)"));
});

// ── google-calendar-auth: the client secret is not an open oracle ─────────────

Deno.test("google-calendar-auth: anonymous → 401 and Google is never called; a user can exchange and refresh", async () => {
  const n = installStrictNetwork({
    users: USERS, tables: {},
    externals: { "oauth2.googleapis.com": () => ({ body: { access_token: "at", refresh_token: "rt", expires_in: 3600 } }) },
    env: { GOOGLE_CALENDAR_ID: "cid", GOOGLE_CALENDAR_CLIENT_SECRET: "secret" },
  });
  const deps = { env: n.env, fetch: n.fetch };
  assertEquals((await handleGoogleCalendarAuth(post("google-calendar-auth", { action: "exchange-code", code: "c" }), deps)).status, 401);
  assertEquals(n.external, []);
  assertEquals((await handleGoogleCalendarAuth(post("google-calendar-auth", { action: "exchange-code", code: "c", redirectUri: "https://app/cb" }, "jwt-a"), deps)).status, 200);
  const refreshed = await handleGoogleCalendarAuth(post("google-calendar-auth", { action: "refresh-token", refresh_token: "rt" }, "jwt-a"), deps);
  assertEquals(refreshed.status, 200, "the refresh branch reads the body once");
  assertEquals((await refreshed.json()).access_token, "at");
});

// ── tool-availability: signed-in users only ───────────────────────────────────

Deno.test("tool-availability: anonymous → 401; a signed-in user gets the probe", async () => {
  const n = installStrictNetwork({ users: USERS, tables: {} });
  assertEquals((await handleToolAvailability(post("tool-availability", {}), { env: n.env, fetch: n.fetch })).status, 401);
  assertEquals((await handleToolAvailability(post("tool-availability", {}, TEST_ANON), { env: n.env, fetch: n.fetch })).status, 401);
  assertEquals((await handleToolAvailability(post("tool-availability", {}, "jwt-b"), { env: n.env, fetch: n.fetch })).status, 200);
});

// ── firecrawl-scrape: membership, daily caps, credits always enforced ─────────

function scrapeWorld(opts: { balance?: number; used?: { ws?: number; user?: number } } = {}) {
  let balance = opts.balance ?? 5;
  const today = new Date().toISOString();
  const ledger: Array<Record<string, unknown>> = [];
  for (let i = 0; i < (opts.used?.ws ?? 0); i++) ledger.push({ id: `w${i}`, workspace_id: WS_A, company_key: `${BROWSER_SCRAPE_TAG}:someone-else`, created_at: today });
  for (let i = 0; i < (opts.used?.user ?? 0); i++) ledger.push({ id: `u${i}`, workspace_id: WS_A, company_key: `${BROWSER_SCRAPE_TAG}:${USER_A}`, created_at: today });
  const n = installStrictNetwork({
    users: USERS,
    tables: {
      workspace_members: [{ workspace_id: WS_A, user_id: USER_A, role: "owner" }, { workspace_id: WS_B, user_id: USER_B, role: "owner" }],
      credit_transactions: ledger,
    },
    rpc: {
      credits_reserve: (a, net) => {
        if (balance < Number(a.p_amount)) return { ok: false, error: "insufficient_credits", balance, needed: a.p_amount };
        balance -= Number(a.p_amount);
        const id = crypto.randomUUID();
        net.tables.credit_transactions.push({ id, workspace_id: a.p_workspace, company_key: a.p_company_key, created_at: new Date().toISOString(), status: "reserved" });
        return { ok: true, transaction_id: id, balance_after: balance };
      },
      credits_finalize: (a, net) => {
        const t = net.tables.credit_transactions.find((x) => x.id === a.p_transaction_id)!;
        t.status = a.p_status;
        return { ok: true, actual_credits: a.p_actual };
      },
    },
    externals: { "api.firecrawl.dev": () => ({ body: { success: true, data: { markdown: "# page" } } }) },
    env: { FIRECRAWL_API_KEY: "fc_key", LEAD_CREDIT_ENFORCEMENT: "observe" },
  });
  return { n, balance: () => balance };
}
const scrape = (body: unknown, token?: string) => post("firecrawl-scrape", body, token);
const OK_BODY = { url: "https://example.com/about", workspace_id: WS_A };

Deno.test("firecrawl-scrape: anonymous and the anon key → 401; Firecrawl is never called", async () => {
  const { n } = scrapeWorld();
  for (const tok of [undefined, TEST_ANON]) {
    assertEquals((await handleFirecrawlScrape(scrape(OK_BODY, tok), { env: n.env, fetch: n.fetch })).status, 401);
  }
  assertEquals(n.external, []);
  assertEquals(n.rpcCalls, []);
});

Deno.test("firecrawl-scrape: another workspace cannot be charged → 403; no workspace → 400", async () => {
  const { n } = scrapeWorld();
  assertEquals((await handleFirecrawlScrape(scrape({ ...OK_BODY, workspace_id: WS_A }, "jwt-b"), { env: n.env, fetch: n.fetch })).status, 403);
  assertEquals((await handleFirecrawlScrape(scrape({ url: OK_BODY.url }, "jwt-a"), { env: n.env, fetch: n.fetch })).status, 400);
  assertEquals(n.external, []);
  assertEquals(n.rpcCalls, []);
});

Deno.test("firecrawl-scrape: a workspace with no credits cannot spend, even though global mode is observe → 402", async () => {
  const { n } = scrapeWorld({ balance: 0 });
  const r = await handleFirecrawlScrape(scrape(OK_BODY, "jwt-a"), { env: n.env, fetch: n.fetch });
  assertEquals(r.status, 402);
  assertEquals((await r.json()).error, "insufficient_credits");
  assertEquals(n.external, []);
});

Deno.test("firecrawl-scrape: the daily caps hold, per workspace and per user → 429 before any reservation", async () => {
  for (const used of [{ ws: BROWSER_SCRAPE_DAILY_LIMIT_WORKSPACE }, { user: BROWSER_SCRAPE_DAILY_LIMIT_USER }]) {
    const { n } = scrapeWorld({ used });
    assertEquals((await handleFirecrawlScrape(scrape(OK_BODY, "jwt-a"), { env: n.env, fetch: n.fetch })).status, 429, JSON.stringify(used));
    assertEquals(n.external, []);
    assertEquals(n.rpcCalls, []);
  }
});

Deno.test("firecrawl-scrape: a member with credits scrapes once, pays one credit, and the reservation is settled", async () => {
  const { n, balance } = scrapeWorld({ balance: 3 });
  const r = await handleFirecrawlScrape(scrape(OK_BODY, "jwt-a"), { env: n.env, fetch: n.fetch });
  assertEquals(r.status, 200);
  assertEquals(n.external.length, 1);
  assertEquals(n.external[0].auth, "Bearer fc_key");
  assertEquals(balance(), 2);
  assertEquals(n.rpcCalls.map((c) => c.fn), ["credits_reserve", "credits_finalize"]);
  assertEquals(n.rpcCalls[1].args.p_status, "charged");
  const order = n.log.filter((l) => l.includes("rpc") || l.startsWith("EXTERNAL"));
  assertEquals(order, ["POST /rest/v1/rpc/credits_reserve", "EXTERNAL api.firecrawl.dev/v2/scrape", "POST /rest/v1/rpc/credits_finalize"]);
});

Deno.test("firecrawl-scrape: internal addresses are still refused before any spend", async () => {
  const { n } = scrapeWorld();
  for (const url of ["http://169.254.169.254/latest/meta-data", "http://localhost:5432", "file:///etc/passwd"]) {
    assertEquals((await handleFirecrawlScrape(scrape({ url, workspace_id: WS_A }, "jwt-a"), { env: n.env, fetch: n.fetch })).status, 400, url);
  }
  assertEquals(n.rpcCalls, []);
});

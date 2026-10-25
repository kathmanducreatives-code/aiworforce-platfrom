// CACHE-SESSION, MOUNTED (Codex #185 finding on #178): after one user signs out
// and another signs in IN THE SAME TAB, nothing of the first user's client
// Brains — client names, Brain content, the selected client, unsaved drafts —
// may be shown, cached for, or stored for the second user; and a response the
// first user's session started may not land in the second user's page.
//
//   BRAIN_E2E_DENO_FLAGS="--allow-run --allow-write" POSTGREST_BIN=… \
//     tests/db-contract/run-with-gotrue.sh tests/browser/brainCacheSession.browser.test.ts
//
// Real: GoTrue (sign-up, password sign-in, sign-out), PostgREST, Postgres with
// the held client schema, the ACTUAL generate-company-brain-draft handler, the
// app's ACTUAL provider stack and Company Brain page (tests/browser/
// brain-cache-session.tsx) served by Vite, and a headless Chrome driven over
// the DevTools protocol with real mouse events. A local gateway joins them (it
// only routes — /auth/v1 to GoTrue, /rest/v1 to PostgREST, /functions/v1 to the
// captured handler — and can hold one response to make it arrive late).
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { captured, restoreServe } from "../db-contract/lib/captureServe.ts";
import "../../supabase/functions/generate-company-brain-draft/index.ts";
import { REST_URL, mintJwt, seedWorkspace, serviceClient, sql, uuid } from "../db-contract/lib/harness.ts";

const handler = captured[0];
restoreServe();
const AUTH_URL = Deno.env.get("BRAIN_E2E_AUTH_URL");
if (!AUTH_URL) throw new Error("run through tests/db-contract/run-with-gotrue.sh (real GoTrue)");
const CHROME = Deno.env.get("CHROME_BIN") ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = Deno.env.get("BRAIN_BROWSER_OUT") ?? await Deno.makeTempDir({ prefix: "brain-cache-session-" });
const PASSWORD = "Synthetic-offline-only-58213!";
const opts = { sanitizeResources: false, sanitizeOps: false };
const port = () => 20000 + Math.floor(Math.random() * 20000);

// ── Gateway ─────────────────────────────────────────────────────────────────
const gwPort = port();
const GATEWAY = `http://127.0.0.1:${gwPort}`;
let hold: { match: (body: Record<string, unknown>) => boolean; released: Promise<void>; seen: () => void } | null = null;
const fnLog: Record<string, unknown>[] = [];
Deno.env.set("SUPABASE_URL", GATEWAY);
Deno.env.set("SUPABASE_ANON_KEY", await mintJwt("anon"));
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", await mintJwt("service_role"));
Deno.env.set("COMPANY_BRAIN_CLIENTS_ENABLED", "true");
for (const k of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "APIFY_API_TOKEN", "FIRECRAWL_API_KEY", "LOVABLE_API_KEY"]) Deno.env.delete(k);
const server = Deno.serve({ hostname: "127.0.0.1", port: gwPort, onListen() {} }, async (req) => {
  const url = new URL(req.url);
  if (url.pathname.startsWith("/functions/v1/generate-company-brain-draft")) {
    if (req.method === "OPTIONS") return handler(req);
    const text = await req.text();
    const body = (() => { try { return JSON.parse(text); } catch { return {}; } })() as Record<string, unknown>;
    fnLog.push(body);
    const h = hold;
    const run = handler(new Request(req.url, { method: req.method, headers: req.headers, body: text }));
    if (h && h.match(body)) { hold = null; h.seen(); const res = await run; await h.released; return res; }
    return run;
  }
  if (url.pathname.startsWith("/auth/v1/")) return fetch(new Request(AUTH_URL + url.pathname.slice("/auth/v1".length) + url.search, req));
  if (url.pathname.startsWith("/rest/v1/")) return fetch(new Request(REST_URL + url.pathname.slice("/rest/v1".length) + url.search, req));
  return new Response("not found", { status: 404 });
});

// ── Vite (the app's source) ─────────────────────────────────────────────────
const root = new URL("../../", import.meta.url).pathname;
const vitePort = port();
const APP = `http://127.0.0.1:${vitePort}`;
const vite = new Deno.Command("npx", {
  args: ["vite", "--config", "tests/browser/vite.config.ts"], cwd: root, stdout: "null", stderr: "null",
  env: { BRAIN_BROWSER_GATEWAY: GATEWAY, BRAIN_BROWSER_PORT: String(vitePort), VITE_SUPABASE_URL: APP,
    VITE_SUPABASE_PUBLISHABLE_KEY: await mintJwt("anon"), VITE_CLIENT_BRAINS: "true", BROWSER: "none" },
}).spawn();
for (let i = 0; i < 120; i++) {
  try { if ((await fetch(`${APP}/tests/browser/brain-cache-session.html`)).ok) break; } catch { /* starting */ }
  await new Promise((r) => setTimeout(r, 500));
}

// ── Headless Chrome over CDP ────────────────────────────────────────────────
const cdpPort = port();
const profile = await Deno.makeTempDir({ prefix: "brain-cache-chrome-" });
const chrome = new Deno.Command(CHROME, {
  args: ["--headless=new", `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, "--window-size=1280,900",
    "--no-first-run", "--disable-gpu", "--force-prefers-reduced-motion", "about:blank"],
  stdout: "null", stderr: "null",
}).spawn();
type CdpTarget = { type: string; webSocketDebuggerUrl: string };
type CdpMessage = { id?: number; method?: string; params?: { exceptionDetails?: { text?: string; exception?: { description?: string } } };
  result?: { result?: { value?: unknown }; data?: string } };
let targets: CdpTarget[] = [];
for (let i = 0; i < 60 && !targets.some((t) => t.type === "page"); i++) {
  await new Promise((r) => setTimeout(r, 300));
  try { targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json(); } catch { /* starting */ }
}
const ws = new WebSocket(targets.find((t) => t.type === "page")!.webSocketDebuggerUrl);
await new Promise((r) => ws.onopen = r);
let msgId = 0;
const pending = new Map<number, (v: CdpMessage) => void>();
const pageErrors: string[] = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data) as CdpMessage;
  if (m.id && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") pageErrors.push(String(m.params?.exceptionDetails?.exception?.description ?? m.params?.exceptionDetails?.text).slice(0, 200));
};
const send = (method: string, params: Record<string, unknown> = {}) => new Promise<CdpMessage>((res) => { const i = ++msgId; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
// The page's answer: the JSON value the expression returned.
const evaluate = async (expr: string): Promise<unknown> => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(expr: string, ms = 20000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await evaluate(expr)) return true; await sleep(200); }
  return false;
}
async function shot(name: string) {
  const r = await send("Page.captureScreenshot", { format: "png" });
  await Deno.writeFile(`${OUT}/${name}.png`, Uint8Array.from(atob(r.result?.data ?? ""), (c) => c.charCodeAt(0)));
}
/** A real mouse click at the centre of the first element matching `js` (an expression returning an Element). */
async function click(js: string): Promise<boolean> {
  const box = await evaluate(`(() => { const el = ${js}; if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`) as { x: number; y: number } | null;
  if (!box) return false;
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
    await send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1, pointerType: "mouse" });
  }
  return true;
}
await send("Page.enable"); await send("Runtime.enable");

// ── Fixture: one agency workspace, A granted a confidential client, B not ────
const CLIENT_NAME = `Confidential Client ${uuid().slice(0, 6)}`;
const SECRET = `CLIENT-SECRET-${uuid().slice(0, 8)}`;
async function signUp(): Promise<{ id: string; session: string; email: string }> {
  const email = `brain-browser-${uuid()}@synthetic.example`;
  const r = await fetch(AUTH_URL + "/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }) });
  const b = await r.json() as { access_token: string };
  assertEquals(r.status, 200);
  const claims = JSON.parse(atob(b.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as { sub: string; session_id: string };
  return { id: claims.sub, session: claims.session_id, email };
}
const ws1 = await seedWorkspace();
const A = await signUp();
const B = await signUp();
await sql`insert into public.workspace_members (workspace_id, user_id, role) values (${ws1}, ${A.id}, 'owner'), (${ws1}, ${B.id}, 'editor')`;
await sql`insert into public.company_brain (workspace_id, profile, onboarding_completed) values (${ws1}, ${sql.json({ company: { name: "Agency Co" } } as never)}, true)`;
const svc = await serviceClient();
const created = await svc.rpc("client_account_create", { p_workspace_id: ws1, p_actor_id: A.id, p_session_id: A.session, p_name: CLIENT_NAME });
const clientId = (created.data as { client_id: string }[])[0].client_id;
await svc.rpc("client_access_grant", { p_workspace_id: ws1, p_client_id: clientId, p_target_user_id: A.id, p_actor_id: A.id, p_session_id: A.session });
const wrote = await svc.rpc("client_brain_authorized_write", { p_workspace_id: ws1, p_client_id: clientId, p_actor_id: A.id, p_session_id: A.session,
  p_permission: "edit", p_intent: "interactive", p_mode: "insert", p_profile: { company: { name: CLIENT_NAME, description: SECRET }, positioning: { promise: SECRET } } });
assertEquals((wrote.data as { outcome: string }[])[0].outcome, "ok");

// ── Steps ───────────────────────────────────────────────────────────────────
const bodyHas = (s: string) => evaluate(`document.body.innerText.includes(${JSON.stringify(s)})`);
const cacheHas = (s: string) => evaluate(`JSON.stringify(window.__qc.getQueryCache().getAll().map((q) => ({ key: q.queryKey, data: q.state.data }))).includes(${JSON.stringify(s)})`);
const storageHas = (s: string) => evaluate(`(() => { for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); if (k.includes(${JSON.stringify(s)}) || (sessionStorage.getItem(k) ?? '').includes(${JSON.stringify(s)})) return true; } return false; })()`);
async function signIn(email: string) {
  assertEquals(await evaluate(`window.__signIn(${JSON.stringify(email)}, ${JSON.stringify(PASSWORD)})`), "ok");
  assert(await waitFor(`!!document.querySelector('#signed-in')`), "signed in");
}
async function signOut() {
  await evaluate(`window.__signOut().then(() => true)`);
  assert(await waitFor(`!!document.querySelector('#signed-out')`), "signed out");
}
async function pickClient(name: string) {
  assert(await waitFor(`!!document.querySelector('[aria-label="Choose which Company Brain to view"]')`), "the switcher is shown");
  assert(await click(`document.querySelector('[aria-label="Choose which Company Brain to view"]')`));
  assert(await waitFor(`[...document.querySelectorAll('[role="option"]')].some((o) => o.textContent.includes(${JSON.stringify(name)}))`, 8000), "the client is listed");
  // Radix Select ignores a pointer release that lands right after it opened;
  // choose the way a keyboard user does: focus the option, press Enter.
  assert(await evaluate(`(() => { const o = [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent.includes(${JSON.stringify(name)})); if (!o) return false; o.focus(); return true; })()`));
  for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
}

Deno.test("CACHE-SESSION mounted: A's client Brain is never shown, cached for or stored for B after A signs out and B signs in", opts, async () => {
  await send("Page.navigate", { url: `${APP}/tests/browser/brain-cache-session.html` });
  assert(await waitFor(`!!document.querySelector('#signed-out')`, 30000), "the real app page mounted");
  await signIn(A.email);
  await shot("0-A-signed-in");
  await pickClient(CLIENT_NAME);
  const sawClient = await waitFor(`document.body.innerText.includes(${JSON.stringify(SECRET)})`);
  await shot("1-A-client-brain");
  if (!sawClient) console.log("DEBUG", JSON.stringify(await evaluate(`({ text: document.body.innerText.slice(0, 600), fn: ${"window.__fn"} })`)), JSON.stringify(fnLog.slice(-4)));
  assert(sawClient, "A sees the client's Brain");
  assert(await cacheHas(SECRET), "positive control: A's client Brain is in the page's query cache");
  await signOut();
  await signIn(B.email);
  // B lands in the SAME agency workspace; wait until B's own page has settled
  // (B's user, the workspace resolved, the page rendered), whatever it shows.
  assert(await waitFor(`window.__state.user === ${JSON.stringify(B.id)} && window.__state.workspaceId === ${JSON.stringify(ws1)} && !!document.querySelector('.brain-overview-page')`, 20000), "B's page rendered");
  await sleep(2500);
  await shot("2-B-after-switch");
  const leaks = {
    page_shows_client_name: await bodyHas(CLIENT_NAME),
    page_shows_client_brain: await bodyHas(SECRET),
    cache_holds_client_name: await cacheHas(CLIENT_NAME),
    cache_holds_client_brain: await cacheHas(SECRET),
    storage_holds_client: await storageHas(clientId),
  };
  console.log(JSON.stringify({ scenario: "A_logout_B_login_same_workspace", ...leaks }));
  assertEquals(leaks, { page_shows_client_name: false, page_shows_client_brain: false, cache_holds_client_name: false,
    cache_holds_client_brain: false, storage_holds_client: false });
  assert(!(await evaluate(`!!document.querySelector('[aria-label="Choose which Company Brain to view"]')`)), "B has no client: no switcher");
  assert(fnLog.some((b) => b.action === "list_clients"), "B's list went to the server");
  await signOut();
});

Deno.test("CACHE-SESSION mounted: a response A's session started, arriving after B signed in, never reaches B's page or cache", opts, async () => {
  // Hold A's next client Brain read until B is signed in.
  let release!: () => void; const released = new Promise<void>((r) => release = r);
  let seen!: () => void; const reached = new Promise<void>((r) => seen = r);
  hold = { match: (b) => b.action === "status" && b.client_id === clientId, released, seen };
  try {
  await signIn(A.email);
  const selected = await evaluate(`(document.querySelector('[aria-label="Choose which Company Brain to view"]')?.textContent ?? '').includes(${JSON.stringify(CLIENT_NAME)})`);
  if (!selected) await pickClient(CLIENT_NAME);
  await Promise.race([reached, sleep(10000)]);
  assert(hold === null, "A's client Brain read is in flight");
  await signOut();
  await signIn(B.email);
  assert(await waitFor(`window.__state.user === ${JSON.stringify(B.id)} && !!document.querySelector('.brain-overview-page')`, 20000), "B's page rendered");
  release();
  await sleep(2500);
  await shot("3-B-after-late-response");
  const leaks = {
    page_shows_client_brain: await bodyHas(SECRET),
    page_shows_client_name: await bodyHas(CLIENT_NAME),
    cache_holds_client_brain: await cacheHas(SECRET),
  };
  console.log(JSON.stringify({ scenario: "late_response_after_principal_change", ...leaks }));
  assertEquals(leaks, { page_shows_client_brain: false, page_shows_client_name: false, cache_holds_client_brain: false });
  await signOut();
  } finally {
    // Never leave a response held: the gateway would wait for it forever.
    hold = null; release();
  }
});

Deno.test("positive controls: same user keeps working — A signs back in, picks the client again, sees it; B never could", opts, async () => {
  await signIn(A.email);
  await pickClient(CLIENT_NAME);
  assert(await waitFor(`document.body.innerText.includes(${JSON.stringify(SECRET)})`), "A sees the client's Brain again");
  await shot("4-A-again");
  await signOut();
  assertEquals(pageErrors, [], "no uncaught page errors");
});

Deno.test("teardown", opts, async () => {
  try { ws.close(); } catch { /* closed */ }
  try { chrome.kill(); await chrome.status; } catch { /* gone */ }
  try { vite.kill(); await vite.status; } catch { /* gone */ }
  await server.shutdown();
  console.log(`screenshots: ${OUT}`);
});

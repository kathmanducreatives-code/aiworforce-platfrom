// COMPANY MEMORY, MOUNTED: the real Company Brain page, signed in.
//
//   CHROME_BIN=… BRAIN_E2E_DENO_FLAGS="--allow-run --allow-write" POSTGREST_BIN=… \
//     tests/db-contract/run-with-gotrue.sh tests/browser/brainMemory.browser.test.ts
//
// Real: GoTrue (sign-up, password sign-in, sign-out), PostgREST, Postgres with
// the held memory schema, the ACTUAL company-brain-memory and
// generate-company-brain-draft handlers, the app's ACTUAL providers and
// CompanyBrainDashboard (tests/browser/brain-cache-session.tsx) served by
// Vite, and headless Chrome driven over CDP with real mouse and key events.
// The gateway only routes. Fictional data; nothing leaves loopback.
// The window is tall: the harness mounts the page without the app shell's
// scroll container, and the app's CSS locks document scrolling. (5600 since
// Company Brain V2's completion panel sits above Company memory; at 3200 the
// memory panel's buttons fell below the viewport and could not be clicked; 7600
// since B2.2 adds "Where this came from" to the open section.)
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { captured, restoreServe } from "../db-contract/lib/captureServe.ts";
import "../../supabase/functions/generate-company-brain-draft/index.ts";
import "../../supabase/functions/company-brain-memory/index.ts";
import { REST_URL, mintJwt, seedWorkspace, serviceClient, sql, uuid } from "../db-contract/lib/harness.ts";

const [draftHandler, memoryHandler] = captured;
restoreServe();
const AUTH_URL = Deno.env.get("BRAIN_E2E_AUTH_URL");
if (!AUTH_URL) throw new Error("run through tests/db-contract/run-with-gotrue.sh (real GoTrue)");
const CHROME = Deno.env.get("CHROME_BIN") ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = Deno.env.get("BRAIN_BROWSER_OUT") ?? await Deno.makeTempDir({ prefix: "brain-memory-" });
const PASSWORD = "Synthetic-offline-only-58213!";
const opts = { sanitizeResources: false, sanitizeOps: false };
const port = () => 20000 + Math.floor(Math.random() * 20000);

// ── gateway ──────────────────────────────────────────────────────────────────
const gwPort = port();
const GATEWAY = `http://127.0.0.1:${gwPort}`;
const fnLog: Array<{ fn: string; body: Record<string, unknown>; status: number }> = [];
Deno.env.set("SUPABASE_URL", GATEWAY);
Deno.env.set("SUPABASE_ANON_KEY", await mintJwt("anon"));
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", await mintJwt("service_role"));
for (const k of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "APIFY_API_TOKEN", "FIRECRAWL_API_KEY", "LOVABLE_API_KEY"]) Deno.env.delete(k);
Deno.serve({ hostname: "127.0.0.1", port: gwPort, onListen() {} }, async (req) => {
  const url = new URL(req.url);
  for (const [fn, h] of [["generate-company-brain-draft", draftHandler], ["company-brain-memory", memoryHandler]] as const) {
    if (url.pathname.startsWith(`/functions/v1/${fn}`)) {
      if (req.method === "OPTIONS") return h(req);
      const text = await req.text();
      const res = await h(new Request(req.url, { method: req.method, headers: req.headers, body: text }));
      try { fnLog.push({ fn, body: JSON.parse(text), status: res.status }); } catch { /* non-JSON */ }
      return res;
    }
  }
  if (url.pathname.startsWith("/auth/v1/")) return fetch(new Request(AUTH_URL + url.pathname.slice("/auth/v1".length) + url.search, req));
  if (url.pathname.startsWith("/rest/v1/")) return fetch(new Request(REST_URL + url.pathname.slice("/rest/v1".length) + url.search, req));
  return new Response("not found", { status: 404 });
});

// ── Vite + Chrome ────────────────────────────────────────────────────────────
const root = new URL("../../", import.meta.url).pathname;
const vitePort = port();
const APP = `http://127.0.0.1:${vitePort}`;
new Deno.Command("npx", {
  args: ["vite", "--config", "tests/browser/vite.config.ts"], cwd: root, stdout: "null", stderr: "null",
  env: { BRAIN_BROWSER_GATEWAY: GATEWAY, BRAIN_BROWSER_PORT: String(vitePort), VITE_SUPABASE_URL: APP,
    VITE_SUPABASE_PUBLISHABLE_KEY: await mintJwt("anon"), BROWSER: "none" },
}).spawn();
for (let i = 0; i < 120; i++) {
  try { if ((await fetch(`${APP}/tests/browser/brain-cache-session.html`)).ok) break; } catch { /* starting */ }
  await new Promise((r) => setTimeout(r, 500));
}
const cdpPort = port();
const profileDir = await Deno.makeTempDir({ prefix: "brain-memory-chrome-" });
new Deno.Command(CHROME, {
  args: ["--headless=new", `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profileDir}`, "--window-size=1280,7600",
    "--no-first-run", "--disable-gpu", "--no-sandbox", "--force-prefers-reduced-motion", "about:blank"],
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
const cdp = new WebSocket(targets.find((t) => t.type === "page")!.webSocketDebuggerUrl);
await new Promise((r) => cdp.onopen = r);
let msgId = 0;
const pending = new Map<number, (v: CdpMessage) => void>();
const pageErrors: string[] = [];
cdp.onmessage = (e) => {
  const m = JSON.parse(e.data) as CdpMessage;
  if (m.id && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") pageErrors.push(String(m.params?.exceptionDetails?.exception?.description ?? m.params?.exceptionDetails?.text).slice(0, 200));
};
const send = (method: string, params: Record<string, unknown> = {}) => new Promise<CdpMessage>((res) => { const i = ++msgId; pending.set(i, res); cdp.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr: string): Promise<unknown> => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(expr: string, ms = 20000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await evaluate(expr)) return true; await sleep(200); }
  return false;
}
async function shot(name: string) {
  const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  await Deno.writeFile(`${OUT}/${name}.png`, Uint8Array.from(atob(r.result?.data ?? ""), (c) => c.charCodeAt(0)));
}
async function click(js: string): Promise<boolean> {
  const box = await evaluate(`(() => { const el = ${js}; if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); const x = r.x + r.width / 2, y = r.y + r.height / 2; const hit = document.elementFromPoint(x, y); return { x, y, hit: hit === el || el.contains(hit), what: hit ? hit.tagName + '.' + String(hit.className).slice(0, 60) : null }; })()`) as { x: number; y: number; hit: boolean; what: string | null } | null;
  if (!box) return false;
  if (!box.hit) console.log("[click] covered by", box.what, "at", box.x, box.y);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
    await send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1, pointerType: "mouse" });
  }
  return true;
}
const button = (text: string, scope = "document") =>
  `[...${scope}.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === ${JSON.stringify(text)})`;
const tab = (prefix: string) => `[...document.querySelectorAll('[role="tab"]')].find((t) => (t.textContent ?? '').startsWith(${JSON.stringify(prefix)}))`;
const bodyHas = (s: string) => evaluate(`document.body.innerText.includes(${JSON.stringify(s)})`);
await send("Page.enable"); await send("Runtime.enable");

// ── fixture ──────────────────────────────────────────────────────────────────
async function signUp() {
  const email = `memory-browser-${uuid()}@synthetic.example`;
  const r = await fetch(AUTH_URL + "/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }) });
  const b = await r.json() as { access_token: string };
  assertEquals(r.status, 200);
  const c = JSON.parse(atob(b.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as { sub: string };
  return { id: c.sub, email };
}
const ws = await seedWorkspace();
const EDITOR = await signUp(); const VIEWER = await signUp();
await sql`insert into public.workspace_members (workspace_id, user_id, role) values (${ws}, ${EDITOR.id}, 'editor'), (${ws}, ${VIEWER.id}, 'viewer')`;
await sql`insert into public.company_brain (workspace_id, profile, onboarding_completed) values (${ws}, ${sql.json({
  schema_version: 2, company: { name: "Northwind Robotics", description: "Shelf-picking robots" },
  target_customer: { industries: ["Manufacturing"] }, competitors: ["Rivalco"],
} as never)}, true)`;
const svc = await serviceClient();
const sub = await svc.rpc("company_brain_proposal_submit", { p_workspace_id: ws, p_agent: "lisa", p_payload: {
  kind: "fact", category: "competitors", fact_key: "competitor:fleetbot.io", value_type: "object", value: { name: "FleetBot", domain: "fleetbot.io" },
  rationale: "FleetBot (fleetbot.io) is monitored as a competitor but is not in your Company Brain's competitor list.",
  evidence: [{ source_ref: "monitoring_subject:fleetbot.io", excerpt: "Your team set this company up to be monitored as a competitor." }],
  source_type: "agent_suggestion", confidence: "medium",
} });
assertEquals((sub.data as { outcome: string }).outcome, "created");

async function signIn(email: string) {
  assertEquals(await evaluate(`window.__signIn(${JSON.stringify(email)}, ${JSON.stringify(PASSWORD)})`), "ok");
  assert(await waitFor(`!!document.querySelector('#signed-in')`), "signed in");
}
async function signOut() {
  await evaluate(`window.__signOut().then(() => true)`);
  assert(await waitFor(`!!document.querySelector('#signed-out')`), "signed out");
}

// ── steps ────────────────────────────────────────────────────────────────────
Deno.test("an editor reviews LISA's suggestion, adds an exclusion, sees what agents receive, then retracts it", opts, async () => {
  await send("Page.navigate", { url: `${APP}/tests/browser/brain-cache-session.html` });
  assert(await waitFor(`!!document.querySelector('#signed-out')`, 30000), "the real page mounted");
  await signIn(EDITOR.email);
  assert(await waitFor(`!!document.querySelector('#brain-memory-title')`, 30000), "the Company memory panel rendered");
  assert(await waitFor(`document.body.innerText.includes('FleetBot (fleetbot.io)')`), "LISA's pending suggestion is shown");
  assert(await bodyHas("not yet trusted"));
  await shot("1-editor-review");

  // Approve the suggestion.
  assert(await click(button("Approve")), "Approve");
  assert(await waitFor(`document.body.innerText.includes('Remembered — every agent uses it from its next run.')`), "approval confirmed");
  const [approved] = await sql`select approved_by, created_by_agent, verification_status from public.company_brain_memory where workspace_id = ${ws} and category = 'competitors'`;
  assertEquals([approved.approved_by, approved.created_by_agent, approved.verification_status], [EDITOR.id, "lisa", "user_confirmed"]);

  // Add an exclusion through "Teach Agentory" (default: Add a preference → Exclude an industry).
  assert(await click(button("Teach Agentory")));
  assert(await waitFor(`!!document.querySelector('[role="dialog"] input[aria-label="Value"]')`, 5000), "dialog open");
  assert(await click(`document.querySelector('[role="dialog"] input[aria-label="Value"]')`));
  await send("Input.insertText", { text: "Gambling" });
  await shot("2-add-exclusion");
  assert(await click(button("Save", "document.querySelector('[role=\"dialog\"]')")), "Save");
  assert(await waitFor(`document.body.innerText.includes('Saved. Every agent uses it from its next run.')`), "saved");
  assert(await waitFor(`!document.querySelector('[role="dialog"]') && !document.querySelector('.fixed.inset-0.z-50')`, 5000), "the dialog closes after a successful save");
  const ex = await sql`select id, created_by, value from public.company_brain_memory where workspace_id = ${ws} and category = 'exclusions'`;
  assertEquals(ex.length, 1); assertEquals(ex[0].created_by, EDITOR.id); assertEquals(ex[0].value, { type: "industry", value: "Gambling" });

  // What the agents receive now.
  assert(await click(tab("How agents use it")));
  assert(await waitFor(`[...document.querySelectorAll('summary')].some((s) => s.textContent.includes('Lisa'))`, 8000));
  for (const name of ["Lisa", "Atlas"]) {
    assert(await click(`[...document.querySelectorAll('summary')].find((s) => s.textContent.startsWith(${JSON.stringify(name)}))`));
  }
  assert(await waitFor(`document.body.innerText.includes('FleetBot (fleetbot.io)') && document.body.innerText.includes('industries: Gambling')`, 10000),
    "the approved competitor and the exclusion reach the agents' blocks");
  await shot("3-agents");

  // Retract the exclusion.
  assert(await click(tab("Preferences")));
  assert(await waitFor(`[...document.querySelectorAll('article')].some((a) => a.innerText.includes('Gambling'))`, 5000));
  assert(await click(`[...[...document.querySelectorAll('article')].find((a) => a.innerText.includes('Gambling')).querySelectorAll('button')].find((b) => b.textContent.trim() === 'Retract')`));
  assert(await waitFor(`document.body.innerText.includes('Retracted — agents no longer use it.')`), "retracted");
  const [after] = await sql`select lifecycle_status from public.company_brain_memory where id = ${ex[0].id}`;
  assertEquals(after.lifecycle_status, "retracted");
  assert(await click(tab("History")));
  assert(await waitFor(`document.body.innerText.includes('retracted Exclude industry')`, 5000), "the history tells it");
  await shot("4-history");
  await signOut();
});

// ── Company Brain V2 · B2.3 ─────────────────────────────────────────────────
const dialog = `document.querySelector('[role="dialog"]')`;
const radio = (label: string) => `[...document.querySelectorAll('[role="radio"]')].find((r) => r.innerText.startsWith(${JSON.stringify(label)}))`;
async function typeIn(selector: string, text: string) {
  assert(await click(selector), `field ${selector}`);
  await send("Input.insertText", { text });
}
async function teach(intent: string, fill: () => Promise<void>) {
  // Right after sign-in the panel can still re-render once (its data refreshes), which drops a
  // dialog opened in that instant: click again until it is open.
  let opened = false;
  for (let i = 0; i < 4 && !opened; i++) {
    assert(await click(button("Teach Agentory")), "Teach Agentory");
    opened = await waitFor(`!!${dialog}`, 2500);
  }
  if (!opened) {
    await shot("debug-teach");
    throw new Error(`dialog did not open · ${JSON.stringify(await evaluate(`[...document.querySelectorAll('button')].filter((b) => b.textContent.includes('Teach')).map((b) => b.outerHTML.slice(0, 160))`))}`);
  }
  assert(await click(radio(intent)), intent);
  await fill();
}
const memoryRows = async (where: string) => (await sql.unsafe(`select kind, category, fact_key, value, created_by_kind, created_by_agent, approved_by, verification_status
  from public.company_brain_memory where workspace_id = '${ws}' and ${where} order by created_at`)) as Array<Record<string, unknown>>;

Deno.test("B2.3 · teach a decision, a fact and a correction; a conflicting preference is resolved on purpose", opts, async () => {
  await send("Page.navigate", { url: `${APP}/tests/browser/brain-cache-session.html` });
  assert(await waitFor(`!!document.querySelector('#signed-out') || !!document.querySelector('#signed-in')`, 30000));
  if (await evaluate(`!!document.querySelector('#signed-out')`)) await signIn(EDITOR.email);
  assert(await waitFor(`!!document.querySelector('#brain-memory-title')`, 30000));

  await teach("Record a decision", async () => {
    await typeIn(`${dialog}.querySelector('input[aria-label="Decision"]')`, "Sell annual plans only");
    await typeIn(`${dialog}.querySelector('input[aria-label="Why"]')`, "Board decision, November");
  });
  await shot("b23-1-teach-decision");
  assert(await click(button("Save", dialog)));
  assert(await waitFor(`document.body.innerText.includes('Saved. Every agent uses it from its next run.') && !${dialog}`, 8000), "decision saved");
  const [d] = await memoryRows(`kind = 'decision' and category = 'strategy_selected'`);
  assertEquals([d.value, d.created_by_kind, d.verification_status], [{ outcome: "Sell annual plans only" }, "user", "user_confirmed"]);

  await teach("Record a fact", async () => { await typeIn(`${dialog}.querySelector('input[aria-label="Fact"]')`, "We have 12 employees and no sales team yet"); });
  assert(await click(button("Save", dialog)));
  assert(await waitFor(`!${dialog}`, 8000));
  assertEquals((await memoryRows(`category = 'company_facts'`)).map((r) => r.value), ["We have 12 employees and no sales team yet"]);

  await teach("Correct something", async () => {
    await typeIn(`${dialog}.querySelector('input[aria-label="What is wrong"]')`, "We sell to enterprises");
    await typeIn(`${dialog}.querySelector('input[aria-label="What is true"]')`, "We sell to warehouses with 20-200 staff");
  });
  assert(await click(button("Save", dialog)));
  assert(await waitFor(`!${dialog}`, 8000));
  assertEquals((await memoryRows(`category = 'corrections'`)).map((r) => r.value), [{ wrong: "We sell to enterprises", right: "We sell to warehouses with 20-200 staff" }]);

  // Excluding an industry the profile TARGETS: the server asks first; nothing is saved until the person chooses.
  await teach("Add a preference", async () => { await typeIn(`${dialog}.querySelector('input[aria-label="Value"]')`, "Manufacturing"); });
  assert(await click(button("Save", dialog)));
  assert(await waitFor(`!!${dialog}?.querySelector('[data-memory-conflict]')`, 8000), "the disagreement is shown");
  assert(await evaluate(`${dialog}.innerText.includes('Manufacturing is one of your target industries')`));
  assertEquals((await memoryRows(`fact_key = 'exclusion.industry:manufacturing'`)).length, 0, "not saved before the choice");
  await shot("b23-2-conflict");
  assert(await click(button("Remember anyway", dialog)));
  assert(await waitFor(`!${dialog}`, 8000));
  assertEquals((await memoryRows(`fact_key = 'exclusion.industry:manufacturing'`)).length, 1);

  // Each card says how fresh it is and which agents use it.
  assert(await click(tab("Decisions")));
  assert(await waitFor(`[...document.querySelectorAll('article')].some((a) => a.innerText.includes('Sell annual plans only') && a.innerText.includes('Used by') && a.innerText.includes('ORION') && a.innerText.includes('Confirmed'))`, 8000));
  await shot("b23-3-decisions");
  await signOut();
});

Deno.test("B2.3 · ORION offers to remember in chat; a person edits and approves; a NEW conversation knows it", opts, async () => {
  const { offerMemoryFromTurn, memoryOfferMessage } = await import("../../supabase/functions/_shared/orionMemoryOfferRuntime.ts");
  const { loadChatBrain } = await import("../../supabase/functions/_shared/chatBrainContext.ts");
  const [{ profile }] = await sql`select profile from public.company_brain where workspace_id = ${ws}`;
  // Conversation 1, as pilot-chat writes it: the user's turn, ORION's answer, ORION's offer.
  const conv = uuid();
  await sql`insert into public.conversations (id, user_id, workspace_id, title) values (${conv}, ${EDITOR.id}, ${ws}, 'Planning')`;
  const said = "We've decided to focus on dental clinics in Portugal.";
  const [userMsg] = await sql`insert into public.messages (conversation_id, role, content, metadata) values (${conv}, 'user', ${said}, '{}'::jsonb) returning id`;
  await sql`insert into public.messages (conversation_id, role, content, agent_slug, metadata, created_at) values (${conv}, 'assistant', 'Understood. I will prioritise dental clinics in Portugal in your next brief.', 'pilot', '{}'::jsonb, now() + interval '1 second')`;
  const offer = await offerMemoryFromTurn(svc as never, { workspaceId: ws, conversationId: conv, messageId: String(userMsg.id), message: said, profile: profile as never });
  assertEquals(offer?.status, "pending");
  const posted = memoryOfferMessage(offer!);
  await sql`insert into public.messages (conversation_id, role, content, agent_slug, metadata, created_at) values (${conv}, 'assistant', ${posted.content}, 'pilot', ${sql.json(posted.metadata as never)}, now() + interval '2 seconds')`;
  // A temporary request in the same conversation is noted, not offered.
  assertEquals((await offerMemoryFromTurn(svc as never, { workspaceId: ws, conversationId: conv, messageId: null, message: "For this search, skip gambling companies", profile: profile as never }))?.status, "temporary");
  // A second, lasting statement stays pending for the dashboard.
  assertEquals((await offerMemoryFromTurn(svc as never, { workspaceId: ws, conversationId: conv, messageId: null, message: "From now on, never target gambling companies.", profile: profile as never }))?.status, "pending");

  await send("Page.navigate", { url: `${APP}/tests/browser/brain-cache-session.html?view=chat&conversation=${conv}` });
  assert(await waitFor(`!!document.querySelector('#signed-in') || !!document.querySelector('#signed-out')`, 30000));
  if (await evaluate(`!!document.querySelector('#signed-out')`)) await signIn(EDITOR.email);
  assert(await waitFor(`!!document.querySelector('[data-testid="memory-offer"]')`, 20000), "ORION's offer card");
  assert(await waitFor(`document.querySelector('[data-testid="memory-offer"]').innerText.includes('Focus on dental clinics in Portugal')`));
  await shot("b23-4-chat-offer");
  // Edit before remembering: the person's version is what is stored.
  assert(await click(button("Edit", `document.querySelector('[data-testid="memory-offer"]')`)));
  assert(await waitFor(`!!document.querySelector('[data-testid="memory-offer"] input')`, 5000));
  await evaluate(`(() => { const i = document.querySelector('[data-testid="memory-offer"] input'); i.focus(); i.select(); return true; })()`);
  await send("Input.insertText", { text: "Focus on dental clinics in Portugal and Spain" });
  assert(await click(button("Remember this version", `document.querySelector('[data-testid="memory-offer"]')`)));
  assert(await waitFor(`document.querySelector('[data-testid="memory-offer"]')?.dataset.status === 'remembered'`, 10000), "remembered");
  await shot("b23-5-chat-remembered");
  const [m] = await memoryRows(`kind = 'decision' and fact_key like 'decision.focus-on-dental%'`);
  assertEquals([m.value, m.approved_by, m.verification_status], [{ outcome: "Focus on dental clinics in Portugal and Spain" }, EDITOR.id, "user_confirmed"]);
  // A person's correction of the wording makes it theirs (corrected_from_proposal), still linked to ORION.
  assertEquals([m.created_by_kind, m.created_by_agent], ["user", "orion"]);

  // Reload: the card reads the proposal's live state.
  await send("Page.reload");
  assert(await waitFor(`document.querySelector('[data-testid="memory-offer"]')?.dataset.status === 'remembered'`, 20000), "still remembered after a reload");
  assert(await waitFor(`document.querySelector('[data-testid="memory-offer"]').innerText.includes('Focus on dental clinics in Portugal and Spain') && document.querySelector('[data-testid="memory-offer"]').innerText.includes('Remembered with your edit')`, 10000),
    "the card shows what was actually remembered, not the original wording");

  // The dashboard shows what is still waiting (the gambling exclusion), never approving from there.
  await send("Page.navigate", { url: `${APP}/tests/browser/brain-cache-session.html?view=dashboard` });
  assert(await waitFor(`!!document.querySelector('[data-testid="memory-review-strip"]')`, 20000), "pending memory on the dashboard");
  assert(await evaluate(`document.querySelector('[data-testid="memory-review-strip"]').innerText.includes('offered to remember 1 thing') && document.querySelector('[data-testid="memory-review-strip"]').innerText.includes('Gambling')`));
  await shot("b23-6-dashboard");

  // Conversation 2 (new): ORION's memory, through the canonical loader.
  const brain = await loadChatBrain(svc as never, ws, EDITOR.id);
  for (const s of ["Business decision (strategy selected): Focus on dental clinics in Portugal and Spain", "Sell annual plans only",
    "We have 12 employees", `NOT "We sell to enterprises"`, "Manufacturing"]) {
    assert(brain.memoryBlock.includes(s), `ORION knows: ${s}\n${brain.memoryBlock}`);
  }
  assert(!brain.memoryBlock.includes("Gambling"), "the still-pending offer is not used");
  assertEquals(pageErrors, []);
  await send("Page.navigate", { url: `${APP}/tests/browser/brain-cache-session.html` });
  assert(await waitFor(`!!document.querySelector('#signed-in')`, 30000));
  await signOut();
});

Deno.test("a viewer sees memory read-only, and the server refuses a viewer's write from the same page", opts, async () => {
  await signIn(VIEWER.email);
  assert(await waitFor(`!!document.querySelector('#brain-memory-title')`, 30000));
  assert(await waitFor(`document.body.innerText.includes('View only')`), "view-only notice");
  assertEquals(await evaluate(`!!(${button("Teach Agentory")})`), false);
  assertEquals(await evaluate(`!!(${button("Approve")})`), false);
  await shot("5-viewer");
  // Bypass the UI: call the function from the viewer's page with the viewer's session.
  const status = await evaluate(`(async () => {
    const { supabase } = await import('/src/integrations/supabase/client.ts');
    const { data: { session } } = await supabase.auth.getSession();
    const r = await fetch('/functions/v1/company-brain-memory', { method: 'POST',
      headers: { Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'write', workspace_id: ${JSON.stringify(ws)}, op: 'set', idempotency_key: 'viewer-bypass-0001',
        payload: { kind: 'preference', category: 'exclusions', fact_key: 'exclusion.industry:x', value_type: 'object', value: { type: 'industry', value: 'X' } } }) });
    return r.status;
  })()`);
  assertEquals(status, 403);
  assertEquals((await sql`select count(*)::int n from public.company_brain_memory where workspace_id = ${ws} and fact_key = 'exclusion.industry:x'`)[0].n, 0);
  await signOut();
  assertEquals(pageErrors, [], "no uncaught page errors");
  console.log(JSON.stringify({ screenshots: OUT, calls: fnLog.map((c) => `${c.fn}:${c.body.action}:${c.status}`) }));
});

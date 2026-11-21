// COMPANY BRAIN V2 · B2.0 — "Complete your Company Brain", MOUNTED AND SIGNED IN.
//
//   CHROME_BIN=… BRAIN_E2E_DENO_FLAGS="--allow-run --allow-write" POSTGREST_BIN=… \
//     tests/db-contract/run-with-gotrue.sh tests/browser/brainCompletion.browser.test.ts
//
// Same real stack as brainMemory.browser.test.ts: GoTrue, PostgREST, Postgres
// with the app schema, the ACTUAL generate-company-brain-draft and
// company-brain-memory handlers, the app's real providers and
// CompanyBrainDashboard served by Vite, headless Chrome over CDP with real
// mouse and key events. Fictional data; nothing leaves loopback; no provider,
// model or research call can be made (their keys are deleted below).
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { captured, restoreServe } from "../db-contract/lib/captureServe.ts";
import "../../supabase/functions/generate-company-brain-draft/index.ts";
import "../../supabase/functions/company-brain-memory/index.ts";
import { REST_URL, mintJwt, seedWorkspace, sql, uuid } from "../db-contract/lib/harness.ts";
import { compilerBrainContext, contractBrainInput } from "../../supabase/functions/_shared/leadPipeline/brainContext.ts";

const [draftHandler, memoryHandler] = captured;
restoreServe();
const AUTH_URL = Deno.env.get("BRAIN_E2E_AUTH_URL");
if (!AUTH_URL) throw new Error("run through tests/db-contract/run-with-gotrue.sh (real GoTrue)");
const CHROME = Deno.env.get("CHROME_BIN") ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = Deno.env.get("BRAIN_BROWSER_OUT") ?? await Deno.makeTempDir({ prefix: "brain-completion-" });
const PASSWORD = "Synthetic-offline-only-58213!";
const opts = { sanitizeResources: false, sanitizeOps: false };
const port = () => 20000 + Math.floor(Math.random() * 20000);

// ── gateway ──────────────────────────────────────────────────────────────────
const gwPort = port();
const GATEWAY = `http://127.0.0.1:${gwPort}`;
const fnLog: Array<{ fn: string; action: unknown; status: number }> = [];
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
      try { fnLog.push({ fn, action: JSON.parse(text).action, status: res.status }); } catch { /* non-JSON */ }
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
const profileDir = await Deno.makeTempDir({ prefix: "brain-completion-chrome-" });
// Tall window: the harness mounts the page without the app shell's scroll container.
new Deno.Command(CHROME, {
  args: ["--headless=new", `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profileDir}`, "--window-size=1280,6000",
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
/** Screenshot of one element (the completion panel), 2× for people to read. */
async function shot(name: string, selector = "#brain-completion") {
  const box = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return r ? { x: r.x, y: r.y + window.scrollY, width: r.width, height: r.height } : null; })()`) as
    { x: number; y: number; width: number; height: number } | null;
  const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true,
    ...(box ? { clip: { x: Math.max(0, box.x - 16), y: Math.max(0, box.y - 16), width: box.width + 32, height: box.height + 32, scale: 2 } } : {}) });
  await Deno.writeFile(`${OUT}/${name}.png`, Uint8Array.from(atob(r.result?.data ?? ""), (c) => c.charCodeAt(0)));
}
async function click(js: string): Promise<boolean> {
  const box = await evaluate(`(() => { const el = ${js}; if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`) as { x: number; y: number } | null;
  if (!box) return false;
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
    await send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1, pointerType: "mouse" });
  }
  return true;
}
async function typeInto(js: string, text: string, enter = false) {
  assert(await click(js), `focus ${js}`);
  await send("Input.insertText", { text });
  if (enter) for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
}
const button = (text: string, scope = "document") =>
  `[...${scope}.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === ${JSON.stringify(text)})`;
const row = (title: string) => `[...document.querySelectorAll('.bcp-row')].find((r) => r.querySelector('.bcp-row-title')?.textContent === ${JSON.stringify(title)})`;
const rowStatus = (title: string) => evaluate(`(${row(title)})?.querySelector('.bcp-row-flags .brain-status:last-child')?.textContent ?? null`);
const card = (label: string) => `[...document.querySelectorAll('.bcp-sug')].find((a) => a.getAttribute('aria-label') === ${JSON.stringify(`Suggestion for ${label}`)})`;
const profile = async () => (await sql`select profile, updated_at from public.company_brain where workspace_id = ${ws}`)[0] as { profile: Record<string, unknown>; updated_at: string };
/** The page applies a save optimistically; wait for the SERVER's row, which is what counts. */
async function savedInDb(check: (p: Record<string, unknown>) => boolean, ms = 10000): Promise<Record<string, unknown>> {
  const end = Date.now() + ms;
  let last: Record<string, unknown> = {};
  while (Date.now() < end) { last = (await profile()).profile; if (check(last)) return last; await sleep(250); }
  throw new Error(`not saved in the database: ${JSON.stringify(last).slice(0, 400)} · calls ${JSON.stringify(fnLog)}`);
}
await send("Page.enable"); await send("Runtime.enable");

// ── fixture: the production Brain's SHAPE with fictional values ──────────────
async function signUp() {
  const email = `completion-browser-${uuid()}@synthetic.example`;
  const r = await fetch(AUTH_URL + "/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }) });
  const b = await r.json() as { access_token: string };
  assertEquals(r.status, 200);
  const c = JSON.parse(atob(b.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as { sub: string };
  return { id: c.sub, email };
}
const FIX = JSON.parse(await Deno.readTextFile(new URL("../fixtures/company-brain/atlas-contract-profiles.json", import.meta.url))).profiles;
const LIVE = {
  ...FIX.live_shape,
  goals: { gtm: "", content: "", competitor_tracking: "", outreach: "", hiring: "" },
  gtm: { motion: "", primary_channel: "", preferred_channels: [], biggest_bottleneck: "", current_tools: [], thirty_day_goal: "" },
  positioning: { promise: "", differentiators: [], use_cases: [], proof_points: [], offer: "", pricing: "", avoid_positioning: [] },
  brand_voice: { tone: "", tags: [], style_rules: [], avoid: [], example_message: "" },
  evidence: { source_pages: [], linkedin_sources: [], confidence_notes: [] },
};
const ws = await seedWorkspace();
const EDITOR = await signUp(); const VIEWER = await signUp();
await sql`insert into public.workspace_members (workspace_id, user_id, role) values (${ws}, ${EDITOR.id}, 'editor'), (${ws}, ${VIEWER.id}, 'viewer')`;
await sql`insert into public.company_brain (workspace_id, profile, onboarding_completed) values (${ws}, ${sql.json(LIVE as never)}, true)`;
// Onboarding research already on record (fictional): read only by the page — never re-run.
await sql`insert into public.company_brain_research_runs (workspace_id, source_type, provider, status, output, created_at) values
  (${ws}, 'company_website', 'firecrawl', 'completed', ${sql.json({
    description: "AI workforce for small B2B teams",
    positioning_claims: ["Your AI sales team", "Human approval on every send"],
    proof_points: ["Used by 3 pilot teams"], integrations: ["HubSpot"],
    source_pages: ["https://northwind.example/", "https://northwind.example/pricing"],
    understanding: { main_promise: "Your AI sales team", competitors_or_tools_mentioned: ["Clay", "HubSpot"], ambiguous: false },
  } as never)}, '2026-08-16T10:00:00Z')`;
const atlasBefore = { a: compilerBrainContext(LIVE), b: contractBrainInput(LIVE) };

async function signIn(email: string) {
  assertEquals(await evaluate(`window.__signIn(${JSON.stringify(email)}, ${JSON.stringify(PASSWORD)})`), "ok");
  assert(await waitFor(`!!document.querySelector('#signed-in')`), "signed in");
}
async function signOut() {
  await evaluate(`window.__signOut().then(() => true)`);
  assert(await waitFor(`!!document.querySelector('#signed-out')`), "signed out");
}
async function mount() {
  await send("Page.navigate", { url: `${APP}/tests/browser/brain-cache-session.html` });
  assert(await waitFor(`!!document.querySelector('#signed-out') || !!document.querySelector('#signed-in')`, 30000), "the real page mounted");
}

// ── steps ────────────────────────────────────────────────────────────────────
Deno.test("B2.0 · an editor sees the truthful state, fills goals, accepts and edits suggestions, and it persists across a reload", opts, async () => {
  await mount();
  await signIn(EDITOR.email);
  assert(await waitFor(`!!document.querySelector('#brain-completion')`, 30000), "the completion panel rendered");
  assert(await waitFor(`document.body.innerText.includes('Finish the essentials your AI team relies on')`));
  // Truthful: activation says complete, the panel does not. The 2 conflicts are B2.1's (this
  // fixture's size label disagrees with its bounds; its legacy persona copy is stale). A filled
  // section with an open conflict is "Needs review", not complete: only the company profile counts.
  assertEquals(await evaluate(`[...document.querySelectorAll('.bcp-metric')].map((m) => m.innerText.replace(/\\s+/g, ' ').trim())`),
    ["ESSENTIALS 1 of 7", "ENRICHMENT 0 of 5", "CONFLICTS 2", "NEEDS VERIFICATION 0"]);
  assertEquals(await rowStatus("Business goals"), "Missing");
  assertEquals(await rowStatus("Company profile"), "Complete");
  assertEquals(await rowStatus("Target customer (ICP)"), "Needs review");
  assertEquals(await rowStatus("Buyer personas"), "Needs review");
  assert(await waitFor(`document.querySelector('.brain-identity').innerText.includes('6 essentials to finish')`), "the identity ring counts essentials (7 − 1)");
  await shot("1-before-goals-open");

  // Goals: open it (a section with a conflict opens first), type two goals, save explicitly.
  if (!(await evaluate(`!!document.querySelector('#bcp-goals')`))) assert(await click(`(${row("Business goals")}).querySelector('.bcp-row-head')`));
  assert(await waitFor(`!!document.querySelector('#bcp-goals input[aria-label="Go-to-market goal"]')`));
  await typeInto(`document.querySelector('#bcp-goals input[aria-label="Go-to-market goal"]')`, "10 qualified meetings a month");
  await typeInto(`document.querySelector('#bcp-goals input[aria-label="Outreach goal"]')`, "50 replies a month");
  await shot("2-goals-typed");
  assert(await click(button("Save business goals")), "Save goals");
  assert(await waitFor(`document.body.innerText.includes('Saved to your Company Brain')`), "saved toast");
  assert(await waitFor(`(${row("Business goals")})?.querySelector('.bcp-row-flags .brain-status:last-child')?.textContent === 'Complete'`), "goals now complete");
  const g = (await savedInDb((x) => (x.goals as Record<string, unknown>)?.outreach === "50 replies a month")).goals as Record<string, unknown>;
  assertEquals(g.gtm, "10 qualified meetings a month");

  // Positioning: a suggestion from the STORED website research, with its pages. Accept.
  assert(await click(`(${row("Positioning & offer")}).querySelector('.bcp-row-head')`));
  assert(await waitFor(`!!(${card("Core promise")})`), "the promise suggestion is shown");
  assert(await waitFor(`(${card("Core promise")}).innerText.includes('Your website research (16 Aug 2026)') && (${card("Core promise")}).innerText.includes('northwind.example/pricing')`));
  await shot("3-suggestions");
  assert(await click(button("Accept", `(${card("Core promise")})`)), "Accept");
  assert(await waitFor(`!(${card("Core promise")})`), "an accepted suggestion leaves");
  await savedInDb((x) => (x.positioning as Record<string, unknown>)?.promise === "Your AI sales team");

  // Edit a suggestion before accepting it: the person's version is what is saved.
  assert(await click(button("Edit first", `(${card("Differentiators")})`)));
  await typeInto(`(${card("Differentiators")}).querySelector('input')`, "Built for founders", true);
  assert(await click(button("Save", `(${card("Differentiators")})`)));
  assert(await waitFor(`!(${card("Differentiators")})`));
  const pos = (await savedInDb((x) => Array.isArray((x.positioning as Record<string, unknown>)?.differentiators) && ((x.positioning as Record<string, string[]>).differentiators.length > 0))).positioning as Record<string, unknown>;
  assertEquals(pos.differentiators, ["Human approval on every send", "Built for founders"]);

  // "Not now" saves nothing.
  assert(await click(`(${row("Competitors")}).querySelector('.bcp-row-head')`));
  assert(await waitFor(`!!(${card("Competitors")})`));
  assert(await waitFor(`(${card("Competitors")}).innerText.includes('Confirm each is a competitor')`), "the competitor caution is shown");
  const before = (await profile()).updated_at;
  assert(await click(button("Not now", `(${card("Competitors")})`)));
  assert(await waitFor(`!(${card("Competitors")})`));
  await sleep(600);
  assertEquals((await profile()).updated_at, before, "dismissing writes nothing");

  // Reload: everything saved is still there; the assessment is recomputed from the server.
  await mount();
  assert(await waitFor(`!!document.querySelector('#brain-completion')`, 30000));
  assert(await waitFor(`(${row("Business goals")})?.querySelector('.bcp-row-flags .brain-status:last-child')?.textContent === 'Complete'`));
  assert(await waitFor(`document.body.innerText.includes('Your AI sales team')`), "the accepted promise shows on the page after reload");
  await shot("4-after-reload");

  // ATLAS reads exactly what it read before (the ICP was not touched).
  const after = (await profile()).profile;
  assertEquals({ a: compilerBrainContext(after), b: contractBrainInput(after) }, atlasBefore);
  // Every write went through the authorized update; no research, draft or model call.
  assert(fnLog.filter((c) => c.fn === "generate-company-brain-draft").every((c) => c.action === "update"), JSON.stringify(fnLog));
  await signOut();
});

Deno.test("B2.0 · a save built on an out-of-date version is refused, not silently overwritten", opts, async () => {
  await signIn(EDITOR.email);
  assert(await waitFor(`!!document.querySelector('#brain-completion')`, 30000));
  assert(await click(`(${row("Go-to-market")}).querySelector('.bcp-row-head')`));
  assert(await waitFor(`!!document.querySelector('#bcp-gtm input[aria-label="Sales motion"]')`));
  // Someone else changes the Brain (another tab / teammate): the row version moves.
  await sql`update public.company_brain set profile = jsonb_set(profile, '{gtm,primary_channel}', '"LinkedIn"'), updated_at = now() where workspace_id = ${ws}`;
  await typeInto(`document.querySelector('#bcp-gtm input[aria-label="Sales motion"]')`, "outbound");
  assert(await click(button("Save go-to-market")));
  assert(await waitFor(`document.body.innerText.includes('Company Brain was changed elsewhere')`), "conflict reported");
  const p = (await profile()).profile.gtm as Record<string, unknown>;
  assertEquals(p.primary_channel, "LinkedIn", "the other change is kept");
  assertEquals(p.motion, "", "the stale save did not land");
  await signOut();
});

// ── B2.1: a second workspace whose ICP copies disagree (fictional) ─────────────
const ws2 = await seedWorkspace();
const OWNER2 = await signUp();
await sql`insert into public.workspace_members (workspace_id, user_id, role) values (${ws2}, ${OWNER2.id}, 'owner')`;
await sql`insert into public.company_brain (workspace_id, profile, onboarding_completed) values (${ws2}, ${sql.json({
  ...FIX.contradictory_copies, company: { name: "Contoso Retail Tech", description: "Store analytics", business_model: "B2B SaaS" },
} as never)}, true)`;
const profile2 = async () => (await sql`select profile, updated_at from public.company_brain where workspace_id = ${ws2}`)[0] as { profile: Record<string, unknown>; updated_at: string };
const conflict = (id: string) => `document.querySelector('[data-conflict="${id}"]')`;

Deno.test("B2.1 · disagreeing ICP copies are shown with what each says, resolved in one click, and lead search then reads the ICP", opts, async () => {
  await signIn(OWNER2.email);
  assert(await waitFor(`!!document.querySelector('#brain-completion')`, 30000));
  assert(await waitFor(`[...document.querySelectorAll('.bcp-metric')].some((m) => m.innerText.replace(/\\s+/g, ' ').includes('CONFLICTS 8'))`), "eight conflicts counted");
  // The section with conflicts opens first, with the stale copy shown next to the ICP.
  assert(await waitFor(`!!(${conflict("mirror_industries")})`), "the stale industries conflict is shown");
  assert(await waitFor(`(${conflict("mirror_industries")}).innerText.includes('Manufacturing') && (${conflict("mirror_industries")}).innerText.includes('Retail')`));
  // Layout: the open section's text and conflict cards line up with the row title.
  const xs = await evaluate(`(() => { const r = document.querySelector('.bcp-row.is-open'); const x = (sel) => Math.round(r.querySelector(sel).getBoundingClientRect().x); return [x('.bcp-row-title'), x('.bcp-row-body > .bcp-missing'), x('.bcp-conflict')]; })()`) as number[];
  console.log("[layout] title / body text / conflict card x:", JSON.stringify(xs));
  assert(Math.abs(xs[0] - xs[1]) <= 1 && Math.abs(xs[0] - xs[2]) <= 1, `open section aligned with its title: ${JSON.stringify(xs)}`);
  await shot("6-conflicts");
  const before = compilerBrainContext((await profile2()).profile);
  assertEquals([before.industries, before.locations], [["Manufacturing"], ["Japan"]], "lead search reads the stale copy");

  // One click: the copy lead search reads is rewritten from the ICP (through the authorized update).
  assert(await click(button("Update the copy lead search reads to match your target industries", `(${conflict("mirror_industries")})`)));
  assert(await waitFor(`!(${conflict("mirror_industries")})`), "the resolved conflict leaves");
  const end = Date.now() + 10000;
  let after = compilerBrainContext((await profile2()).profile);
  while (Date.now() < end && after.industries?.[0] !== "Retail") { await sleep(250); after = compilerBrainContext((await profile2()).profile); }
  assertEquals(after.industries, ["Retail"], "lead search now reads the ICP's industries");
  assertEquals(after.locations, ["France"], "and the ICP's geography (one resync writes every copy)");

  // A contradiction is resolved by choosing a side.
  assert(await click(`(${row("Qualification rules")}).querySelector('.bcp-row-head')`));
  assert(await waitFor(`!!(${conflict("industry_targeted_and_excluded")})`));
  assert(await click(button("Keep as a target industry", `(${conflict("industry_targeted_and_excluded")})`)));
  assert(await waitFor(`!(${conflict("industry_targeted_and_excluded")})`));
  const e2 = Date.now() + 10000;
  let disq: unknown = null;
  while (Date.now() < e2) {
    disq = (((await profile2()).profile.target_customer as Record<string, unknown>).disqualifiers as Record<string, unknown>).industries;
    if (Array.isArray(disq) && disq.length === 0) break;
    await sleep(250);
  }
  assertEquals(disq, []);
  await shot("7-after-resolve");

  // A write that would CREATE a contradiction is refused by the server, from this page, with the reason.
  const stamp = (await profile2()).updated_at;
  const refused = await evaluate(`(async () => {
    const { supabase } = await import('/src/integrations/supabase/client.ts');
    const { data: { session } } = await supabase.auth.getSession();
    // The CURRENT version, as the server sees it (PostgREST's format).
    const { data: row } = await supabase.from('company_brain').select('updated_at').eq('workspace_id', ${JSON.stringify(ws2)}).single();
    const r = await fetch('/functions/v1/generate-company-brain-draft', { method: 'POST',
      headers: { Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update', workspace_id: ${JSON.stringify(ws2)}, expected_updated_at: row.updated_at,
        patch: { buyer_personas: ['VP Operations', 'Intern'], target_customer: { disqualifiers: { industries: [], company_types: [], domains: [], keywords: [], titles: ['Intern'] } } } }) });
    return { status: r.status, body: await r.json() };
  })()`) as { status: number; body: { rejected_reason?: string; detail?: string } };
  assertEquals(refused.status, 400);
  assertEquals(refused.body.rejected_reason, "icp_contradiction");
  assert((refused.body.detail ?? "").includes("both a buyer persona and an excluded title"));
  assertEquals((await profile2()).updated_at, stamp, "nothing was written");
  await signOut();
});

Deno.test("B2.0 · a viewer sees the state read-only; the server refuses a viewer's completion write", opts, async () => {
  await signIn(VIEWER.email);
  assert(await waitFor(`!!document.querySelector('#brain-completion')`, 30000));
  assert(await waitFor(`document.querySelector('#brain-completion').innerText.includes('View only')`), "view-only notice");
  assertEquals(await evaluate(`!!(${button("Accept")})`), false);
  assertEquals(await evaluate(`!!document.querySelector('#brain-completion form')`), false, "no editor for a viewer");
  await shot("5-viewer");
  const before = (await profile()).updated_at;
  const status = await evaluate(`(async () => {
    const { supabase } = await import('/src/integrations/supabase/client.ts');
    const { data: { session } } = await supabase.auth.getSession();
    const r = await fetch('/functions/v1/generate-company-brain-draft', { method: 'POST',
      headers: { Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update', workspace_id: ${JSON.stringify(ws)}, expected_updated_at: ${JSON.stringify(before)}, patch: { goals: { hiring: 'viewer was here' } } }) });
    return r.status;
  })()`);
  assertEquals(status, 403);
  assertEquals((await profile()).updated_at, before);
  await signOut();
  assertEquals(pageErrors, [], "no uncaught page errors");
  console.log(JSON.stringify({ screenshots: OUT, calls: fnLog.map((c) => `${c.fn}:${c.action}:${c.status}`) }));
});

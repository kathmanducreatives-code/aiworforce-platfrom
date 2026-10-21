// deno-lint-ignore-file no-import-prefix
import { assert, assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { WorkspaceSelection, StaleClientSelection, clientCacheKey, scopeIdentity, type ClientChoice } from '../../src/lib/workspaceSelection.ts';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const A: ClientChoice = { workspace_id: id(1), client_binding_id: id(11), version: 1, mode: 'draft_only', label: 'A' };
const B: ClientChoice = { workspace_id: id(2), client_binding_id: id(12), version: 1, mode: 'draft_only', label: 'B' };
const packet = (scope: ClientChoice, task_id: unknown = null) => ({ scope, brain: { workspace_id: scope.workspace_id, marker: scope.label }, records: [{ workspace_id: scope.workspace_id, marker: scope.label }], context_key: scope.label, task_id });
function fixture() {
  const values = new Map<string, string>(); let invalidations = 0;
  const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k,v); }, removeItem: (k: string) => { values.delete(k); } };
  const calls: Record<string, unknown>[] = [];
  let choices = [A,B]; let fail = false;
  let override: ((body: Record<string, unknown>) => Promise<unknown>) | null = null;
  const controller = new WorkspaceSelection('user-A', async (body) => {
    calls.push(body);
    if (fail) throw Error('revoked');
    if (override) return override(body);
    if (body.action==='list_workspaces') return { choices };
    return packet(body.workspace_id===A.workspace_id ? A : B, body.task_id ?? null);
  }, () => { invalidations++; }, storage);
  return { controller, calls, values, storage, invalidations: () => invalidations,
    choices: (v: ClientChoice[]) => { choices=v; }, fail: () => { fail=true; },
    override: (v: typeof override) => { override=v; } };
}
Deno.test('P2 no first-client fallback; selection triggers fresh server reads and no content persistence', async () => {
  const f=fixture(); await f.controller.loadChoices(); assertEquals(f.controller.snapshot().selected,null);
  await f.controller.select(scopeIdentity(A)); assertEquals(f.controller.snapshot().context?.brain.marker,'A');
  assertEquals(f.calls.map((c) => c.action), ['list_workspaces','read_context']);
  assert(!JSON.stringify([...f.values]).includes('marker')); assert(f.invalidations()>=2);
});
Deno.test('P2 switch synchronously clears content, advances cache generation and invalidates legacy cache', async () => {
  const f=fixture(); await f.controller.loadChoices(); await f.controller.select(scopeIdentity(A));
  const epoch=f.controller.snapshot().revision, count=f.invalidations();
  const pending=f.controller.select(scopeIdentity(B));
  assertEquals(f.controller.snapshot().context,null); assert(f.controller.snapshot().revision>epoch); assert(f.invalidations()>count);
  await pending; assertEquals(f.controller.snapshot().context?.brain.marker,'B');
  assert(JSON.stringify(clientCacheKey('user-A',A,1))!==JSON.stringify(clientCacheKey('user-A',B,1)));
  assert(JSON.stringify(clientCacheKey('user-A',A,1))!==JSON.stringify(clientCacheKey('user-B',A,1)));
  assert(JSON.stringify(clientCacheKey('user-A',A,1))!==JSON.stringify(clientCacheKey('user-A',A,2)));
});
for (const scenario of ['A-B','A-B-A','logout','newer-request'] as const) {
  Deno.test(`P2 stale replies cannot repopulate context: ${scenario}`, async () => {
    const f=fixture(); await f.controller.loadChoices(); await f.controller.select(scopeIdentity(A));
    let resolve!: (v: unknown) => void;
    f.override(() => new Promise((r) => { resolve=r; }));
    const pending=f.controller.read([{ kind:'memory',id:id(100) }]);
    const rejected=assertRejects(() => pending, StaleClientSelection);
    f.override(null);
    if (scenario==='logout') { f.controller.stop(); assertEquals(f.values.size,0); }
    else if (scenario==='newer-request') await f.controller.read([]);
    else { await f.controller.select(scopeIdentity(B)); if(scenario==='A-B-A') await f.controller.select(scopeIdentity(A)); }
    resolve(packet(A)); await rejected;
    assertEquals(f.controller.snapshot().context?.brain.marker, scenario==='logout' ? undefined : scenario==='A-B' ? 'B' : 'A');
  });
}
Deno.test('P2 restored hints are per user and reauthorized; revoked/malformed/version-old hints cannot select', async () => {
  for (const hint of [null, '{broken', JSON.stringify({...A,version:0}), JSON.stringify({...A,workspace_id:id(88)})]) {
    const f=fixture(); if(hint) f.values.set('outpost.client.v1:user-A',hint);
    await f.controller.loadChoices(); assertEquals(f.controller.snapshot().selected,null);
  }
  const f=fixture(); f.values.set('outpost.client.v1:user-A',JSON.stringify(A)); await f.controller.loadChoices();
  assertEquals(f.controller.snapshot().context?.brain.marker,'A');
  f.choices([B]); await f.controller.loadChoices(); assertEquals(f.controller.snapshot().context,null);
  assertEquals(f.controller.snapshot().selected,null);
  const other=new WorkspaceSelection('user-B',async()=>({ choices:[A,B] }),()=>{},f.storage); await other.loadChoices();
  assertEquals(other.snapshot().selected,null);
});
Deno.test('P2 revoked authorization or substituted response clears all selected context and hint', async () => {
  const f=fixture(); await f.controller.loadChoices(); await f.controller.select(scopeIdentity(A)); f.fail();
  await assertRejects(()=>f.controller.resume(id(301),[])); assertEquals(f.controller.snapshot().selected,null); assertEquals(f.controller.snapshot().context,null); assertEquals(f.values.size,0);
  const g=fixture(); await g.controller.loadChoices(); await g.controller.select(scopeIdentity(A));
  g.override(async()=>packet(B)); await assertRejects(()=>g.controller.read([])); assertEquals(g.controller.snapshot().context,null);
});
Deno.test('P2 task requests capture exact current identity, never authorize from cache', async () => {
  const f=fixture(); await f.controller.loadChoices(); await f.controller.select(scopeIdentity(A));
  await f.controller.prepare(id(301),[]); await f.controller.resume(id(301),[]);
  assertEquals(f.calls.slice(-2).map((c)=>[c.action,c.workspace_id,c.client_binding_id,c.task_id]), [['prepare_task',A.workspace_id,A.client_binding_id,id(301)],['resume_task',A.workspace_id,A.client_binding_id,id(301)]]);
  await f.controller.select(null); await assertRejects(()=>f.controller.resume(id(301),[]));
});
Deno.test('P2 cannot choose unknown clients; blocked tab storage never causes fallback', async () => {
  const f=fixture(); await f.controller.loadChoices(); await f.controller.select('foreign'); assertEquals(f.controller.snapshot().selected,null);
  const c=new WorkspaceSelection('u',async()=>({ choices:[A] }),()=>{}, { getItem:()=>{throw Error();},setItem:()=>{throw Error();},removeItem:()=>{throw Error();} });
  await c.loadChoices(); assertEquals(c.snapshot().selected,null);
});
Deno.test('P2 isolated route excludes legacy chat/executors and suppresses automatic workspace provisioning', async () => {
  const page=await Deno.readTextFile('src/pages/OutpostWorkspace.tsx');
  const ws=await Deno.readTextFile('src/contexts/WorkspaceContext.tsx');
  const app=await Deno.readTextFile('src/App.tsx');
  assert(page.includes("VITE_OUTPOST_PILOT_CONTEXT_ENABLED !== 'true'")); assert(page.includes('state.revision'));
  assert(!page.includes('MainLayout') && !page.includes('ChatWorkspace') && !page.includes('run-agent'));
  assert(ws.includes("useMatch('/outpost')"), 'use the router matcher, including case/encoded/trailing-slash variants');
  assert(ws.indexOf('if (pilotRoute)')<ws.indexOf('resolveWithRetry()\n')); assert(app.includes('path="/outpost"'));
});

Deno.test('P2 correct envelope cannot conceal a foreign Brain or record', async () => {
  for (const field of ['brain','records']) {
    const f=fixture(); await f.controller.loadChoices(); await f.controller.select(scopeIdentity(A));
    f.override(async()=>({ ...packet(A), [field]: field==='brain' ? packet(B).brain : packet(B).records }));
    await assertRejects(()=>f.controller.read([])); assertEquals(f.controller.snapshot().context,null);
  }
});

Deno.test('P2 cache invalidation failure clears content before cleanup and cannot authorize another client', async () => {
  let fail=false, requests=0;
  const c=new WorkspaceSelection('u',async body=>{
    requests++;return body.action==='list_workspaces'?{choices:[A,B]}:packet(A);
  },()=>{if(fail)throw Error('cache cleanup failed');});
  await c.loadChoices();await c.select(scopeIdentity(A));assert(c.snapshot().context);
  const before=requests;fail=true;await c.select(scopeIdentity(B));
  assertEquals(c.snapshot().context,null);assertEquals(c.snapshot().selected,null);assertEquals(requests,before);assert(c.snapshot().error);
});

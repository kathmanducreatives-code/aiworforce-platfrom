// CACHE-SESSION at the cache boundary (Codex #185; owner fix on #178).
// Loads the ACTUAL key exports the way Codex's tests/outpost-native/
// cache-session-audit.test.cjs does (esbuild; every '@/' import except
// '@/lib/brainScope' stubbed and never executed) and drives the ACTUAL
// @tanstack QueryClient. Codex's steps, with the denial caught so the outcome
// is counted rather than thrown: a new principal must reach authorization; the
// same session must keep its cache.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { build } = require('esbuild');
const { QueryClient } = require('@tanstack/react-query');

async function actualKeys() {
  const root = path.resolve(__dirname, '../..');
  const result = await build({
    stdin: { contents: `export {companyBrainKey} from './src/hooks/useCompanyBrain'; export {brainClientsKey} from './src/hooks/useBrainScope'; export {principalOfSession, brainStorageKeysToPurge, brainScopeKey, AGENCY_SCOPE} from './src/lib/brainScope';`, resolveDir: root },
    bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'silent',
    external: ['react', '@tanstack/react-query'],
    plugins: [{ name: 'unused-hook-dependencies', setup(b) {
      b.onResolve({ filter: /^@\// }, (a) => a.path === '@/lib/brainScope'
        ? { path: path.join(root, 'src/lib/brainScope.ts') }
        : { path: a.path, namespace: 'unused', sideEffects: false });
      b.onLoad({ filter: /.*/, namespace: 'unused' }, () => ({ loader: 'js', contents:
        "const no=()=>{throw Error('must not run')}; export const useWorkspace=no, supabase={}, loadClientBrain=no, invokeBrain=no, listBrainClients=no;" }));
    } }],
  });
  const m = new Module(path.join(__dirname, 'brain-cache-keys.cjs'), module);
  m.paths = module.paths; m.filename = path.join(__dirname, 'brain-cache-keys.cjs');
  m._compile(result.outputFiles[0].text, m.filename);
  return m.exports;
}
const ws = 'same-agency', client = '11111111-1111-4111-8111-111111111111';
const A = { userId: 'user-a', sessionId: 'session-a1' };
const B = { userId: 'user-b', sessionId: 'session-b1' };
const A2 = { userId: 'user-a', sessionId: 'session-a2' };
const scope = { kind: 'client', clientId: client };
async function attempt(qc, key, staleTime) {
  let calls = 0;
  try {
    const data = await qc.fetchQuery({ queryKey: key, staleTime, queryFn: async () => { calls++; throw Error('no grant'); } });
    return { calls, served: data };
  } catch { return { calls, served: null }; }
}

test('a different login reaches authorization; A\'s cached client list and Brain are never served to B', async () => {
  const { companyBrainKey, brainClientsKey } = await actualKeys();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  qc.setQueryData(companyBrainKey(ws, scope, A), { profile: { private_offer: 'Client A confidential' } });
  qc.setQueryData(brainClientsKey(ws, A), [{ clientId: client, name: 'Confidential client name' }]);
  const brain = await attempt(qc, companyBrainKey(ws, scope, B), 5 * 60_000);
  const list = await attempt(qc, brainClientsKey(ws, B), 60_000);
  console.log(JSON.stringify({ scenario: 'same_workspace_new_principal', authorization_requests: brain.calls + list.calls,
    prior_brain_visible: !!brain.served, prior_client_name_visible: !!list.served }));
  assert.equal(brain.calls + list.calls, 2, 'each request went to the authorization boundary');
  assert.equal(brain.served, null); assert.equal(list.served, null);
  qc.clear();
});

test('a new session of the same user also reauthorizes; the same session keeps its cache (no needless refetch)', async () => {
  const { companyBrainKey } = await actualKeys();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  qc.setQueryData(companyBrainKey(ws, scope, A), { profile: { x: 1 } });
  assert.equal((await attempt(qc, companyBrainKey(ws, scope, A2), 300_000)).calls, 1, 'new session → server');
  const same = await attempt(qc, companyBrainKey(ws, scope, A), 300_000);
  assert.equal(same.calls, 0, 'same session → cache');
  assert.deepEqual(same.served, { profile: { x: 1 } });
  qc.clear();
});

test('Codex\'s exact call shape (no principal) never shares a cache entry: fail closed', async () => {
  const { companyBrainKey, brainClientsKey } = await actualKeys();
  assert.notDeepEqual(companyBrainKey(ws, scope), companyBrainKey(ws, scope));
  assert.notDeepEqual(brainClientsKey(ws), brainClientsKey(ws));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  qc.setQueryData(companyBrainKey(ws, scope), { profile: { secret: 1 } });
  assert.equal((await attempt(qc, companyBrainKey(ws, scope), 300_000)).calls, 1);
  qc.clear();
});

test('principal, storage purge and per-session Brain identity', async () => {
  const { principalOfSession, brainStorageKeysToPurge, brainScopeKey, AGENCY_SCOPE } = await actualKeys();
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const token = (claims) => `${b64({ alg: 'HS256' })}.${b64(claims)}.sig`;
  assert.deepEqual(principalOfSession({ access_token: token({ sub: 'u1', session_id: 's1' }), user: { id: 'u1' } }), { userId: 'u1', sessionId: 's1' });
  assert.equal(principalOfSession({ access_token: token({ sub: 'u2', session_id: 's1' }), user: { id: 'u1' } }), null, 'token of another user');
  assert.equal(principalOfSession({ access_token: token({ sub: 'u1' }), user: { id: 'u1' } }), null, 'no session id');
  assert.equal(principalOfSession(null), null);
  assert.deepEqual(brainStorageKeysToPurge([
    'agentory.brainScope.u1.ws', 'agentory.brainScope.ws',
    'agentory.company-brain-draft.v1:u1:ws:client:c1:targeting', 'agentory.company-brain-draft.v1:u1:ws:targeting',
    'agentory:guided-setup:ws', 'agentory:guided-setup:u1:ws', 'sidebar.collapsed',
  ]).sort(), ['agentory.brainScope.u1.ws', 'agentory.brainScope.ws', 'agentory.company-brain-draft.v1:u1:ws:client:c1:targeting', 'agentory:guided-setup:ws'].sort());
  assert.notEqual(brainScopeKey('ws', AGENCY_SCOPE, A), brainScopeKey('ws', AGENCY_SCOPE, B), 'a save answered for A is not B\'s');
});

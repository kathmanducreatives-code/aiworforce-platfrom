// Offline regression: actual #178 query-key exports + the actual QueryClient.
// No hook body or authorization implementation is replaced. Unexecuted hook
// dependencies are stubbed solely so the pure exported keys load in Node.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { build } = require('esbuild');
const { QueryClient } = require('@tanstack/react-query');
async function actualKeys() {
  const root = path.resolve(__dirname, '../..');
  const result = await build({
    stdin: { contents: `export {companyBrainKey} from './src/hooks/useCompanyBrain'; export {brainClientsKey} from './src/hooks/useBrainScope';`, resolveDir: root },
    bundle: true, format: 'cjs', platform: 'node', write: false,
    external: ['react', '@tanstack/react-query'],
    plugins: [{ name: 'unused-hook-dependencies', setup(b) {
      b.onResolve({ filter: /^@\// }, a => a.path === '@/lib/brainScope'
        ? {path:path.join(root,'src/lib/brainScope.ts')}
        : {path:a.path,namespace:'unused-hook-dependency',sideEffects:false});
      b.onLoad({filter:/.*/,namespace:'unused-hook-dependency'},()=>({contents:`export const useWorkspace=()=>{throw Error('must not run')}; export const supabase={}; export const loadClientBrain=()=>{throw Error('must not run')}; export const invokeBrain=()=>{throw Error('must not run')}; export const listBrainClients=()=>{throw Error('must not run')};`,loader:'js'}));
    }}],
  });
  const compiled = new Module(path.join(__dirname, 'actual-cache-keys.cjs'), module);
  compiled.paths = module.paths;
  compiled.filename = path.join(__dirname, 'actual-cache-keys.cjs');
  compiled._compile(result.outputFiles[0].text, compiled.filename);
  return compiled.exports;
}
test('CACHE-SESSION: a different login must not receive the prior principal client list/Brain without authorization', async () => {
  const {companyBrainKey,brainClientsKey} = await actualKeys();
  const qc = new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});
  const workspace='same-agency', client='11111111-1111-4111-8111-111111111111';
  const key=companyBrainKey(workspace,{kind:'client',clientId:client});
  const listKey=brainClientsKey(workspace);
  // Principal A's authorized response. The app singleton survives sign-out;
  // The corrected harness catches expected denials; the original count assertion
  // is retained and no-prior-data assertions are added below.
  qc.setQueryData(key,{profile:{private_offer:'Client A confidential'}});
  qc.setQueryData(listKey,[{clientId:client,name:'Confidential client name'}]);
  let checks=0;
  const denied = async () => {checks++;throw Error('new principal has no grant');};
  const seenBrain=await qc.fetchQuery({queryKey:companyBrainKey(workspace,{kind:'client',clientId:client}),staleTime:5*60_000,queryFn:denied}).catch((error)=>{assert.match(error.message,/new principal has no grant/);return undefined;});
  const seenList=await qc.fetchQuery({queryKey:brainClientsKey(workspace),staleTime:60_000,queryFn:denied}).catch((error)=>{assert.match(error.message,/new principal has no grant/);return undefined;});
  console.log(JSON.stringify({scenario:'same_workspace_new_principal',authorization_requests:checks,prior_brain_visible:!!seenBrain?.profile?.private_offer,prior_client_name_visible:!!seenList?.[0]?.name}));
  qc.clear();
  assert.equal(checks,2,'each new principal must reauthorize rather than reuse another login cache');
  assert.equal(seenBrain,undefined,'no prior principal Brain is returned');
  assert.equal(seenList,undefined,'no prior principal client list is returned');
});
test('CACHE positive: an empty cache reaches the authorization boundary and surfaces denial',async()=>{
  const {companyBrainKey}=await actualKeys();
  const qc=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});
  let checks=0;
  await assert.rejects(qc.fetchQuery({queryKey:companyBrainKey('ws',{kind:'client',clientId:'11111111-1111-4111-8111-111111111111'}),staleTime:300_000,queryFn:async()=>{checks++;throw Error('no grant');}}),/no grant/);
  assert.equal(checks,1);qc.clear();
});

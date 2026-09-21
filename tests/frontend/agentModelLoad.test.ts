import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { loadModelBytes } from '../../src/lib/agent3d/loadModel.ts';
import { MODEL_BUDGET_BYTES } from '../../src/lib/agent3d/registry.ts';

Deno.test('GLB loader preserves bytes and rejects missing, HTML, corrupt and oversized responses', async () => {
  const original = globalThis.fetch;
  const bytes = new Uint8Array(24);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.length, true);
  const run = () => loadModelBytes('/agents/lyra/lyra.glb', new AbortController().signal);
  try {
    globalThis.fetch = () => Promise.resolve(new Response(bytes));
    assertEquals(new Uint8Array(await run()), bytes);
    globalThis.fetch = () => Promise.resolve(new Response('missing', { status: 404 }));
    await assertRejects(run, Error, '404');
    globalThis.fetch = () => Promise.resolve(new Response('<html>Vite fallback page</html>'));
    await assertRejects(run, Error, 'Invalid GLB');
    globalThis.fetch = () => Promise.resolve(new Response(bytes, { headers: { 'content-length': String(MODEL_BUDGET_BYTES + 1) } }));
    await assertRejects(run, Error, 'size budget');
    globalThis.fetch = () => Promise.resolve(new Response(new Uint8Array(MODEL_BUDGET_BYTES + 1)));
    await assertRejects(run, Error, 'size budget');
    view.setUint32(8, 999, true);
    globalThis.fetch = () => Promise.resolve(new Response(bytes));
    await assertRejects(run, Error, 'Invalid GLB');
  } finally { globalThis.fetch = original; }
});

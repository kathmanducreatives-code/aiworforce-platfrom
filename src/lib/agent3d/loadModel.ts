import { MODEL_BUDGET_BYTES } from './registry.ts';

/** Bound the actual transfer, not just the manifest. HTML fallback pages are rejected. */
export async function loadModelBytes(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`GLB request failed (${response.status})`);
  if (Number(response.headers.get('content-length')) > MODEL_BUDGET_BYTES) throw new Error('GLB exceeds size budget');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('GLB response has no body');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MODEL_BUDGET_BYTES) throw new Error('GLB exceeds size budget');
      chunks.push(value);
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  if (size < 20) throw new Error('GLB is truncated');
  const header = new DataView(bytes.buffer);
  if (header.getUint32(0, true) !== 0x46546c67 || header.getUint32(4, true) !== 2 || header.getUint32(8, true) !== size) throw new Error('Invalid GLB v2 header');
  return bytes.buffer;
}

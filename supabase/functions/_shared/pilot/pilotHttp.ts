import { object, PilotRefusal } from "./pilotPolicy.ts";
export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
export const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      ...CORS,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
const MAX_BODY_BYTES = 16384;
export async function bodyOf(req: Request): Promise<Record<string, unknown>> {
  if (!req.body) throw new PilotRefusal("invalid_request", 400);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let count = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      count += value.length;
      if (count > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new PilotRefusal("request_too_large", 413);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(count);
    let offset = 0;
    for (const c of chunks) {
      bytes.set(c, offset);
      offset += c.length;
    }
    return object(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
  } catch (e) {
    if (e instanceof PilotRefusal) throw e;
    throw new PilotRefusal("invalid_request", 400);
  } finally {
    reader.releaseLock();
  }
}

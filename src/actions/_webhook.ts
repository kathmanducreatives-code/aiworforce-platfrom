/**
 * Browser-safe helper for posting webhooks to n8n.
 * Note: HMAC signing must happen server-side (e.g. in a Supabase Edge Function),
 * since secrets cannot be exposed to the browser.
 */

export interface N8nPayload {
  event: string;
  timestamp: string;
  [key: string]: any;
}

export async function signAndPostWebhook(
  url: string,
  payload: N8nPayload,
): Promise<void> {
  const body = JSON.stringify(payload);

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  if (!res.ok) {
    throw new Error(`Webhook failed with status ${res.status}: ${await res.text()}`);
  }
}

/**
 * Internal helper for signing and posting webhooks to n8n.
 * Implements HMAC-SHA256 signature for security.
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
  const secret = process.env.N8N_WEBHOOK_SECRET;
  
  if (!secret) {
    console.warn('[signAndPostWebhook] N8N_WEBHOOK_SECRET not set. Posting without signature.');
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    return;
  }

  // Node.js crypto for server-side signing
  const crypto = await import('crypto');
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(body);
  const sigHex = hmac.digest('hex');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-ScreeningPilot-Signature': sigHex,
    },
    body,
  });

  if (!res.ok) {
    throw new Error(`Webhook failed with status ${res.status}: ${await res.text()}`);
  }
}

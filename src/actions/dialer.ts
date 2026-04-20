/**
 * PowerDialer Server Actions
 * Aligns with the Hub & Spoke architecture: Frontend -> Action -> n8n/Supabase
 */

'use server'

import { signAndPostWebhook } from './_webhook';

// These should move to a shared constants file eventually
const N8N_BASE_URL = process.env.N8N_BASE_URL || 'https://n8n.prasidha.me';
const DIALER_START_URL = `${N8N_BASE_URL}/webhook/power-dialer-start`;
const DIALER_STOP_URL = `${N8N_BASE_URL}/webhook/power-dialer-stop`;

/**
 * Initiates the PowerDialer loop for a workspace.
 */
export async function startDialer(workspaceId: string, agentId?: string) {
  console.log(`[startDialer] Initiating for workspace: ${workspaceId}`);
  
  const payload = {
    event: 'dialer.start',
    workspace_id: workspaceId,
    agent_id: agentId || 'power-dialer-system',
    timestamp: new Date().toISOString(),
  };

  try {
    await signAndPostWebhook(DIALER_START_URL, payload);
    return { success: true, message: 'Dialer initiated successfully.' };
  } catch (error: any) {
    console.error('[startDialer] Error:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Halts the PowerDialer loop.
 */
export async function stopDialer(workspaceId: string) {
  console.log(`[stopDialer] Halting for workspace: ${workspaceId}`);
  
  const payload = {
    event: 'dialer.stop',
    workspace_id: workspaceId,
    timestamp: new Date().toISOString(),
  };

  try {
    await signAndPostWebhook(DIALER_STOP_URL, payload);
    return { success: true, message: 'Halt signal sent to dialer.' };
  } catch (error: any) {
    console.error('[stopDialer] Error:', error.message);
    return { success: false, error: error.message };
  }
}
